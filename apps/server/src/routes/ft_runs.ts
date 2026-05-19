import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import { getRun, listRecentRuns } from '../ft_loop/repo.js';

export const ftRuns = new Hono();
ftRuns.use('*', cernereAuth);

// GET /api/v1/ft-runs/:id
ftRuns.get('/:id', async (c) => {
  const run = await getRun(c.req.param('id'));
  if (!run) return c.json({ error: 'not_found' }, 404);
  return c.json({ run });
});

// GET /api/v1/ft-runs (admin 想定、 簡易には認証ユーザに公開)
ftRuns.get('/', async (c) => {
  const limit = Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);
  const runs = await listRecentRuns(limit);
  return c.json({ runs });
});

// POST /api/v1/ft-runs (start、 LLM 未実装で 501)
ftRuns.post('/', async (c) => {
  return c.json(
    { error: 'not_implemented', detail: 'FT loop の起動は PR-iii (LLM Orchestrator) と PR-iv で実装' },
    501,
  );
});
