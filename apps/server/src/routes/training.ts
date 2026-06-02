import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import { createMemoriaClient, type TrainingDocKind } from '@tirocinium/training';
import { createRef, deleteRef, listRefs } from '../training/repo.js';
import { sql } from '../db/index.js';

const KINDS: TrainingDocKind[] = ['es', 'portfolio', 'past_qa', 'self_intro'];

/**
 * 本人特化の教師データ参照 (training_data_refs) の管理。
 * 本文 + embedding は Memoria 側 (個人データ非保管)、Tr は ref のみ握る (DESIGN §3.2.1)。
 * MEMORIA_URL 未設定の dev では本文を投入せず local placeholder の ref を作る。
 */
export const training = new Hono();
training.use('*', cernereAuth);

/** GET /api/v1/training — 自分の ref 一覧 */
training.get('/', async (c) => {
  const user = c.get('user');
  return c.json({ refs: await listRefs(user.id) });
});

/** POST /api/v1/training — ES/portfolio 等を登録 (body があれば Memoria へ投入) */
training.post('/', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => null)) as {
    kind?: string;
    body?: string;
    tags?: string[];
    memoria_uri?: string;
  } | null;

  if (!body || !body.kind || !KINDS.includes(body.kind as TrainingDocKind)) {
    return c.json({ error: 'invalid_kind' }, 400);
  }
  const kind = body.kind as TrainingDocKind;
  const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string') : [];

  // users 行を遅延作成 (Cernere user_id mirror)
  await sql`INSERT INTO users (id) VALUES (${user.id}) ON CONFLICT (id) DO NOTHING`;

  let memoriaUri = typeof body.memoria_uri === 'string' ? body.memoria_uri : '';
  let embeddingId = '';

  const memoria = createMemoriaClient();
  if (memoria && body.body) {
    try {
      const ref = await memoria.upsertTrainingDoc({ user_id: user.id, kind, body: body.body, tags });
      memoriaUri = ref.memoria_uri;
      embeddingId = ref.embedding_id;
    } catch (err) {
      return c.json({ error: 'memoria_upsert_failed', detail: (err as Error).message }, 502);
    }
  }

  if (!memoriaUri) {
    // dev: Memoria 無し → 本文は保持せず placeholder ref のみ
    memoriaUri = `local:training:${kind}:${crypto.randomUUID()}`;
  }

  const created = await createRef({ userId: user.id, kind, memoriaUri, embeddingId, tags });
  return c.json({ ref: created }, 201);
});

/** DELETE /api/v1/training/:id — 自分の ref を削除 */
training.delete('/:id', async (c) => {
  const user = c.get('user');
  const ok = await deleteRef(user.id, c.req.param('id'));
  return ok ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});
