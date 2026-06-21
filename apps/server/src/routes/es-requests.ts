// ES 添削相談 (在校生向け公開エンドポイント + view 配信)。
// 在校生は Cernere 認証でリクエストを作成・確認できる。
// OB の引き受けは Discord Bot B 経由 (backdoor.ts の /es-requests に)。

import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cernereAuth } from '../auth/cernere.js';
import {
  insertEsRequest,
  listEsRequestsByStudent,
  closeEsRequestByStudent,
} from '../companies/ob-es-requests-repo.js';

const VIEWER_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../es-requests-viewer');

export const esRequests = new Hono();

/** GET /api/v1/es-requests — 自分のリクエスト一覧 (Cernere 認証済の在校生のみ) */
esRequests.get('/', cernereAuth, async (c) => {
  const user = c.get('user');
  const requests = await listEsRequestsByStudent(user.id);
  return c.json({ requests });
});

/** POST /api/v1/es-requests — ES 相談リクエストを作成 (Cernere 認証済の在校生のみ) */
esRequests.post('/', cernereAuth, async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const targetCompanyName = str(body.target_company_name);
  if (!targetCompanyName) return c.json({ error: 'target_company_name_required' }, 400);

  const request = await insertEsRequest(
    user.id,
    str(body.student_display_name) || user.id,
    str(body.student_discord_handle),
    targetCompanyName,
    str(body.request_note),
  );
  return c.json({ request }, 201);
});

/** DELETE /api/v1/es-requests/:id — 自分のリクエストをクローズ (Cernere 認証済の在校生のみ) */
esRequests.delete('/:id', cernereAuth, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const ok = await closeEsRequestByStudent(id, user.id);
  if (!ok) return c.json({ error: 'not_found_or_forbidden' }, 404);
  return c.json({ ok: true });
});

// ES 相談ビューア (在校生向け静的 HTML)。 Cernere 認証は JS 側で行う。
export const esRequestsPage = new Hono();
esRequestsPage.get('/', (c) => {
  try {
    const html = readFileSync(join(VIEWER_DIR, 'index.html'), 'utf-8');
    return c.html(html);
  } catch {
    return c.text('es-requests viewer not found', 404);
  }
});
