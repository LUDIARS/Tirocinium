import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicClient, extractText } from './anthropic.js';
import { streamResponse } from './response.js';

// Portus のクライアントは標準 fetch を使うので、global fetch を偽物に差し替える (外部には繋がない)。
type Call = { url: string; init: RequestInit };

function stubFetch(...responses: (() => Response)[]): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  });
  return calls;
}

const json = (body: unknown, status = 200) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createAnthropicClient (Portus)', () => {
  it('messages.create は system / temperature も含めてそのまま送り、応答の text を読める', async () => {
    const calls = stubFetch(
      json({ id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: '了解' }, { type: 'tool_use', id: 't' }, { type: 'text', text: 'です' }] }),
    );
    const client = createAnthropicClient({ apiKey: 'test-key' });
    const params = { model: 'claude-test', max_tokens: 32, system: '面接官', temperature: 0.2, messages: [{ role: 'user' as const, content: 'こんにちは' }] };
    const res = await client.messages.create(params);
    expect(extractText(res.content)).toBe('了解です');
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.init.redirect).toBe('error');
    expect((call.init.headers as Record<string, string>)['x-api-key']).toBe('test-key');
    expect(JSON.parse(call.init.body as string)).toEqual(params);
  });

  it('content の無い応答は例外にする', async () => {
    stubFetch(json({ type: 'message' }));
    const client = createAnthropicClient({ apiKey: 'k' });
    await expect(client.messages.create({ model: 'm', max_tokens: 1, messages: [] })).rejects.toThrow('unexpected message');
  });

  it('400 は再試行せずに投げる (ステータスが分かる)', async () => {
    const calls = stubFetch(json({ type: 'error' }, 400));
    const client = createAnthropicClient({ apiKey: 'k' });
    await expect(client.messages.create({ model: 'm', max_tokens: 1, messages: [] })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });

  it('鍵が無ければ作らない', () => {
    const saved = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    try {
      expect(() => createAnthropicClient()).toThrow('ANTHROPIC_API_KEY is required');
    } finally {
      if (saved !== undefined) process.env['ANTHROPIC_API_KEY'] = saved;
    }
  });

  it('streamResponse は text_delta だけを順に返す', async () => {
    const sse = [
      'event: message_start\ndata: {"type":"message_start","message":{}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"志望"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"動機は?"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join('');
    const calls = stubFetch(() => new Response(sse, { status: 200 }));
    const client = createAnthropicClient({ apiKey: 'k' });
    const out: string[] = [];
    for await (const token of streamResponse(client, {
      systemPrompt: 's',
      turns: [{ turn_no: 1, role: 'user', text: 'よろしくお願いします' }],
    })) {
      out.push(token);
    }
    expect(out).toEqual(['志望', '動機は?']);
    expect(JSON.parse(calls[0]!.init.body as string).stream).toBe(true);
  });
});
