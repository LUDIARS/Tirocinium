// 裏口 (卒業生の自己投稿面) API + マジックリンク認証 + view 配信。 spec/companies/backdoor.md。
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

const VIEWER_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../backdoor-viewer');

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
