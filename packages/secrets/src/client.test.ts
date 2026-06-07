import { describe, it, expect } from 'vitest';
import { parseResolveResponse, resolveSecrets } from './client.js';
import { SecretAgentError } from './types.js';

describe('parseResolveResponse', () => {
  it('extracts string secrets', () => {
    expect(parseResolveResponse({ secrets: { A: '1', B: '2' } })).toEqual({ A: '1', B: '2' });
  });
  it('drops non-string values', () => {
    expect(parseResolveResponse({ secrets: { A: '1', N: 2, X: null } })).toEqual({ A: '1' });
  });
  it('throws on missing secrets', () => {
    expect(() => parseResolveResponse({})).toThrow(SecretAgentError);
  });
});

describe('resolveSecrets', () => {
  const okFetch = (body: unknown): typeof fetch =>
    (async () =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  it('posts to the agent and returns secrets (memory-only)', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ secrets: { NOTION_TOKEN: 'secret_x' } }), { status: 200 });
    }) as unknown as typeof fetch;

    const out = await resolveSecrets('tirocinium', {
      baseUrl: 'http://127.0.0.1:17332',
      token: 'tok',
      keys: ['NOTION_TOKEN'],
      fetchImpl,
    });
    expect(out).toEqual({ NOTION_TOKEN: 'secret_x' });
    expect(captured!.url).toBe('http://127.0.0.1:17332/api/v1/secrets/resolve');
    expect((captured!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(captured!.init.body as string)).toEqual({ service: 'tirocinium', keys: ['NOTION_TOKEN'] });
  });

  it('throws no_token when token missing', async () => {
    await expect(
      resolveSecrets('tirocinium', { baseUrl: 'http://x', token: '', fetchImpl: okFetch({ secrets: {} }) }),
    ).rejects.toMatchObject({ code: 'no_token' });
  });

  it('maps 401 to unauthorized', async () => {
    const fetchImpl = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    await expect(
      resolveSecrets('tirocinium', { baseUrl: 'http://x', token: 't', fetchImpl }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('maps network error to unreachable', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(
      resolveSecrets('tirocinium', { baseUrl: 'http://x', token: 't', fetchImpl }),
    ).rejects.toMatchObject({ code: 'unreachable' });
  });
});
