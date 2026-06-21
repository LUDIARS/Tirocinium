// 裏口 (卒業生の自己投稿面) API + マジックリンク認証 + view 配信。 spec/feature/companies/backdoor.md。
// 認証は Cernere ではなく Bot B 発行の session token (Bearer)。 本体/面接 (Cernere) とは別系統。

import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MiddlewareHandler } from 'hono';
import { config } from '../config.js';
import {
  exchangeLinkToken,
  verifySession,
  getEntry,
  upsertEntry,
  deleteEntry,
  listIndustryMessages,
  type BackdoorPatch,
} from '../companies/backdoor-repo.js';
import {
  insertObJobPosting,
  updateObJobPosting,
  deleteObJobPosting,
  listObJobPostingsForOb,
  listMyObJobPostings,
  type ObJobPatch,
} from '../companies/ob-job-postings-repo.js';
import {
  listPendingEsRequestsForOb,
  acceptEsRequest,
} from '../companies/ob-es-requests-repo.js';

const VIEWER_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../backdoor-viewer');
const OB_JOBS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../ob-jobs-viewer');

declare module 'hono' {
  interface ContextVariableMap {
    backdoorUser: { discordUserId: string; displayName: string };
  }
}

// Bearer session token を検証して本人を context に載せる。
const backdoorAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('authorization');
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const session = await verifySession(header.slice(7).trim());
  if (!session) return c.json({ error: 'invalid_session' }, 401);
  c.set('backdoorUser', session);
  await next();
};

/** POST/PUT /job-postings のリクエスト body を安全な ObJobPatch に絞り込む。 */
function readJobPatch(body: Record<string, unknown>): ObJobPatch {
  const patch: ObJobPatch = {};
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
  if (str(body.title) !== undefined) patch.title = str(body.title);
  if (str(body.role) !== undefined) patch.role = str(body.role);
  if (str(body.description) !== undefined) patch.description = str(body.description);
  if (str(body.company_name) !== undefined) patch.company_name = str(body.company_name);
  if (str(body.location) !== undefined) patch.location = str(body.location);
  if (str(body.employment_type) !== undefined) patch.employment_type = str(body.employment_type);
  if (str(body.deadline) !== undefined) patch.deadline = str(body.deadline);
  if (bool(body.is_active) !== undefined) patch.is_active = bool(body.is_active);
  return patch;
}

/** PUT /me のリクエスト body を安全な BackdoorPatch に絞り込む。 */
function readPatch(body: Record<string, unknown>): BackdoorPatch {
  const patch: BackdoorPatch = {};
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
  if (str(body.display_name) !== undefined) patch.display_name = str(body.display_name);
  if (str(body.current_company) !== undefined) patch.current_company = str(body.current_company);
  if (str(body.message_to_students) !== undefined) patch.message_to_students = str(body.message_to_students);
  if (str(body.message_to_industry) !== undefined) patch.message_to_industry = str(body.message_to_industry);
  if (bool(body.students_published) !== undefined) patch.students_published = bool(body.students_published);
  if (bool(body.industry_published) !== undefined) patch.industry_published = bool(body.industry_published);
  return patch;
}

export const backdoor = new Hono();

// link token を session token に交換する (裏口 view 起動時に 1 回)。
backdoor.post('/auth', async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return c.json({ error: 'missing_token' }, 400);
  const result = await exchangeLinkToken(token, config.discordBackdoor.sessionTtlMin);
  if (!result) return c.json({ error: 'invalid_or_expired' }, 401);
  return c.json({ session: result.session, entry: result.entry });
});

// 自分のエントリ取得 (未登録なら identity だけの空テンプレート)。
backdoor.get('/me', backdoorAuth, async (c) => {
  const me = c.get('backdoorUser');
  const entry = await getEntry(me.discordUserId);
  return c.json({ entry, displayName: me.displayName });
});

// 自分のエントリを部分更新する。
backdoor.put('/me', backdoorAuth, async (c) => {
  const me = c.get('backdoorUser');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const entry = await upsertEntry(me.discordUserId, me.displayName, readPatch(body));
  return c.json({ entry });
});

// 自分のエントリを削除する。
backdoor.delete('/me', backdoorAuth, async (c) => {
  const me = c.get('backdoorUser');
  await deleteEntry(me.discordUserId);
  return c.json({ ok: true });
});

// 業界内向けメッセージ + 在籍ロスター (裏口面の閲覧、 卒業生本人のみ)。
backdoor.get('/industry', backdoorAuth, async (c) => {
  const entries = await listIndustryMessages();
  const messages = entries.map((e) => ({
    display_name: e.display_name,
    current_company: e.current_company,
    message: e.message_to_industry,
    updated_at: e.updated_at,
  }));
  const roster = entries
    .filter((e) => e.current_company)
    .map((e) => ({ display_name: e.display_name, current_company: e.current_company }));
  return c.json({ messages, roster });
});

// ---- OB 求人 API ----

// OB向け: 全公開求人一覧 + 自分の投稿かどうかフラグ
backdoor.get('/job-postings', backdoorAuth, async (c) => {
  const me = c.get('backdoorUser');
  const postings = await listObJobPostingsForOb(me.discordUserId);
  return c.json({ postings });
});

// OB向け: 自分の投稿のみ (アクティブ/非アクティブ含む)
backdoor.get('/job-postings/mine', backdoorAuth, async (c) => {
  const me = c.get('backdoorUser');
  const postings = await listMyObJobPostings(me.discordUserId);
  return c.json({ postings });
});

// 求人を新規投稿する
backdoor.post('/job-postings', backdoorAuth, async (c) => {
  const me = c.get('backdoorUser');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const patch = readJobPatch(body);
  if (!patch.title?.trim()) return c.json({ error: 'title_required' }, 400);
  const posting = await insertObJobPosting(me.discordUserId, patch);
  return c.json({ posting }, 201);
});

// 投稿者のみ更新できる
backdoor.put('/job-postings/:id', backdoorAuth, async (c) => {
  const me = c.get('backdoorUser');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const posting = await updateObJobPosting(id, me.discordUserId, readJobPatch(body));
  if (!posting) return c.json({ error: 'not_found_or_forbidden' }, 404);
  return c.json({ posting });
});

// 投稿者のみ削除できる
backdoor.delete('/job-postings/:id', backdoorAuth, async (c) => {
  const me = c.get('backdoorUser');
  const id = c.req.param('id');
  const ok = await deleteObJobPosting(id, me.discordUserId);
  if (!ok) return c.json({ error: 'not_found_or_forbidden' }, 404);
  return c.json({ ok: true });
});

// ---- ES 添削相談 API (OB側) ----

// 自分の会社宛て pending リクエスト一覧
backdoor.get('/es-requests', backdoorAuth, async (c) => {
  const me = c.get('backdoorUser');
  const entry = await getEntry(me.discordUserId);
  const requests = await listPendingEsRequestsForOb(
    entry?.current_company_id ?? null,
    entry?.current_company ?? '',
  );
  return c.json({ requests });
});

// リクエストを引き受ける
backdoor.post('/es-requests/:id/accept', backdoorAuth, async (c) => {
  const me = c.get('backdoorUser');
  const id = c.req.param('id');
  const request = await acceptEsRequest(id, me.discordUserId, me.displayName);
  if (!request) return c.json({ error: 'not_found_or_already_matched' }, 404);
  return c.json({ request });
});

// 裏口 view (静的 HTML)。 認証なしで開けるが、 操作には URL の link token → session が要る。
export const backdoorPage = new Hono();
backdoorPage.get('/', (c) => {
  try {
    const html = readFileSync(join(VIEWER_DIR, 'index.html'), 'utf-8');
    return c.html(html);
  } catch {
    return c.text('backdoor viewer not found', 404);
  }
});

// OB求人ビューア (在校生向け静的 HTML)。 認証なし。
export const obJobsPage = new Hono();
obJobsPage.get('/', (c) => {
  try {
    const html = readFileSync(join(OB_JOBS_DIR, 'index.html'), 'utf-8');
    return c.html(html);
  } catch {
    return c.text('ob-jobs viewer not found', 404);
  }
});
