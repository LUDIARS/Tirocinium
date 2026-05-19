import { Hono } from 'hono';
import { sql } from '../db/index.js';

export const health = new Hono();

health.get('/', async (c) => {
  let dbOk = false;
  try {
    const rows = await sql<{ ok: number }[]>`SELECT 1 AS ok`;
    dbOk = rows[0]?.ok === 1;
  } catch {
    dbOk = false;
  }
  return c.json({ service: 'tirocinium', ok: true, db: dbOk });
});
