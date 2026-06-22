// 裏口 (卒業生/OB の自己投稿面) API + view 配信。 spec/feature/web/backdoor.md。
// 認証は本体/面接と同じ Cernere に統一 (PASETO Bearer)。 本人アンカーは Cernere の sub。
// 旧マジックリンク (Bot B 発行 session token) は migration 021 / PR で撤去した。

import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cernereAuth } from '../auth/cernere.js';
import {
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
import { pushNotification } from '../notifications/nuntius.js';

const VIEWER_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../backdoor-viewer');
const OB_JOBS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../ob-jobs-viewer');

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

// 全エンドポイント Cernere 認証。 c.get('user').id が本人の Cernere sub。

// 自分のエントリ取得 (未登録なら null。 表示名は本人が設定したエントリ値)。
backdoor.get('/me', cernereAuth, async (c) => {
  const user = c.get('user');
  const entry = await getEntry(user.id);
  return c.json({ entry, displayName: entry?.display_name ?? '' });
});

// 自分のエントリを部分更新する。
backdoor.put('/me', cernereAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const entry = await upsertEntry(user.id, '', readPatch(body));
  return c.json({ entry });
});

// 自分のエントリを削除する。
backdoor.delete('/me', cernereAuth, async (c) => {
  const user = c.get('user');
  await deleteEntry(user.id);
  return c.json({ ok: true });
});

// 業界内向けメッセージ + 在籍ロスター (裏口面の閲覧、 卒業生本人のみ)。
backdoor.get('/industry', cernereAuth, async (c) => {
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
backdoor.get('/job-postings', cernereAuth, async (c) => {
  const user = c.get('user');
  const postings = await listObJobPostingsForOb(user.id);
  return c.json({ postings });
});

// OB向け: 自分の投稿のみ (アクティブ/非アクティブ含む)
backdoor.get('/job-postings/mine', cernereAuth, async (c) => {
  const user = c.get('user');
  const postings = await listMyObJobPostings(user.id);
  return c.json({ postings });
});

// 求人を新規投稿する
backdoor.post('/job-postings', cernereAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const patch = readJobPatch(body);
  if (!patch.title?.trim()) return c.json({ error: 'title_required' }, 400);
  const posting = await insertObJobPosting(user.id, patch);
  return c.json({ posting }, 201);
});

// 投稿者のみ更新できる
backdoor.put('/job-postings/:id', cernereAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const posting = await updateObJobPosting(id, user.id, readJobPatch(body));
  if (!posting) return c.json({ error: 'not_found_or_forbidden' }, 404);
  return c.json({ posting });
});

// 投稿者のみ削除できる
backdoor.delete('/job-postings/:id', cernereAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const ok = await deleteObJobPosting(id, user.id);
  if (!ok) return c.json({ error: 'not_found_or_forbidden' }, 404);
  return c.json({ ok: true });
});

// ---- ES 添削相談 API (OB側) ----

// 自分の会社宛て pending リクエスト一覧
backdoor.get('/es-requests', cernereAuth, async (c) => {
  const user = c.get('user');
  const entry = await getEntry(user.id);
  const requests = await listPendingEsRequestsForOb(
    entry?.current_company_id ?? null,
    entry?.current_company ?? '',
  );
  return c.json({ requests });
});

// リクエストを引き受ける (Web UI 経由)
backdoor.post('/es-requests/:id/accept', cernereAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const me = await getEntry(user.id);
  const request = await acceptEsRequest(id, user.id, me?.display_name ?? '');
  if (!request) return c.json({ error: 'not_found_or_already_matched' }, 404);

  // 学生本人へ Nuntius で「引き受けられた」通知 (Cernere user id 宛、 fire-and-forget)。
  const discordHint = request.student_discord_handle
    ? `\n相手の連絡先 (Discord): ${request.student_discord_handle}`
    : '';
  void pushNotification({
    user_id: request.student_cernere_user_id,
    title: 'ES 添削相談が引き受けられました',
    body:
      `${request.target_company_name} の OB (${request.matched_ob_display_name || '卒業生'}) が` +
      `あなたの ES 添削相談を引き受けました。${discordHint}`,
    data: { kind: 'es_request_matched', request_id: request.id },
  });

  return c.json({ request });
});

// 裏口 view (静的 HTML)。 認証なしで開けるが、 操作には Cernere ログイン (Bearer) が要る。
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
