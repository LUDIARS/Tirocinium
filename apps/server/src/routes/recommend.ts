import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import { runRecommend } from '../recommend/service.js';
import { saveRecommendation, listRecommendations } from '../recommend/repo.js';
import { sql } from '../db/index.js';

/**
 * ES からおすすめ企業を返す (DESIGN §3.1 / spec/companies/README.md)。
 * ES 本文は request scope の es_text か Memoria RAG 経由のみ参照し、 DB には保存しない。
 * 結果 (導出ガイダンス) は company_recommendations に保存して履歴化する。
 */
export const recommendRoute = new Hono();
recommendRoute.use('*', cernereAuth);

/** POST /api/v1/recommend — おすすめ企業を生成 */
recommendRoute.post('/', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => null)) as {
    target_role?: string;
    target_company?: string;
    tags?: string[];
    es_text?: string;
    topK?: number;
  } | null;

  // users 行を遅延作成 (FK)。
  await sql`INSERT INTO users (id) VALUES (${user.id}) ON CONFLICT (id) DO NOTHING`;

  const outcome = await runRecommend({
    userId: user.id,
    targetRole: typeof body?.target_role === 'string' ? body.target_role : undefined,
    targetCompany: typeof body?.target_company === 'string' ? body.target_company : undefined,
    tags: Array.isArray(body?.tags) ? body!.tags.filter((t) => typeof t === 'string') : [],
    esText: typeof body?.es_text === 'string' ? body.es_text : undefined,
    topK: typeof body?.topK === 'number' ? body.topK : undefined,
  });

  const saved = await saveRecommendation(user.id, outcome.query, outcome.result);
  return c.json(
    {
      recommendation: saved,
      method: outcome.result.method,
      has_es_material: outcome.hasEsMaterial,
    },
    201,
  );
});

/** GET /api/v1/recommend — 自分の過去のおすすめ履歴 */
recommendRoute.get('/', async (c) => {
  const user = c.get('user');
  const limit = c.req.query('limit');
  const rows = await listRecommendations(user.id, limit ? Number.parseInt(limit, 10) : undefined);
  return c.json({ recommendations: rows });
});
