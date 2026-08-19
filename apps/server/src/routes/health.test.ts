import { describe, expect, it } from 'vitest';
import { health, readiness } from './health.js';

describe('service runtime routes', () => {
  it('returns the lightweight health contract without database initialization', async () => {
    const response = await health.request('http://localhost/');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'tirocinium',
      version: expect.any(String),
    });
  });

  it('reports an unavailable database as not ready', async () => {
    const response = await readiness.request('http://localhost/');

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      service: 'tirocinium',
      version: expect.any(String),
      db: false,
    });
  });
});
