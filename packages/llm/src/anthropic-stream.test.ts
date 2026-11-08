import { HttpError } from '@ludiars/portus/net';
import { describe, expect, it } from 'vitest';
import { MAX_EVENT_CHARS, parseSseEvents, streamMessages } from './anthropic-stream.js';
import type { MessageStreamEvent } from './anthropic-types.js';

const encoder = new TextEncoder();

async function* chunks(...parts: (string | Uint8Array)[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield typeof p === 'string' ? encoder.encode(p) : p;
}

async function collect(it: AsyncIterable<MessageStreamEvent>): Promise<MessageStreamEvent[]> {
  const out: MessageStreamEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const delta = (text: string) =>
  `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })}\n\n`;

const SAMPLE = [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n',
  'event: ping\ndata: {"type":"ping"}\n\n',
  delta('こんにちは'),
  delta('、元気?'),
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
].join('');

describe('parseSseEvents', () => {
  it('空行区切りのイベントを順に JSON で返す', async () => {
    const events = await collect(parseSseEvents(chunks(SAMPLE)));
    expect(events.map((e) => e.type)).toEqual([
      'message_start',
      'ping',
      'content_block_delta',
      'content_block_delta',
      'message_stop',
    ]);
    expect(events[2]?.delta).toEqual({ type: 'text_delta', text: 'こんにちは' });
  });

  it('どのバイト位置で分割されても同じ結果 (マルチバイト文字の途中を含む)', async () => {
    const bytes = encoder.encode(SAMPLE);
    const whole = await collect(parseSseEvents(chunks(bytes)));
    for (let cut = 1; cut < bytes.length; cut++) {
      const split = await collect(parseSseEvents(chunks(bytes.slice(0, cut), bytes.slice(cut))));
      expect(split).toEqual(whole);
    }
  });

  it('CRLF と単独の CR も区切りとして読む (チャンク境界で CR と LF が分かれても)', async () => {
    const crlf = SAMPLE.replace(/\n/g, '\r\n');
    const lf = await collect(parseSseEvents(chunks(SAMPLE)));
    expect(await collect(parseSseEvents(chunks(crlf)))).toEqual(lf);
    const bytes = encoder.encode(crlf);
    for (let cut = 1; cut < bytes.length; cut++) {
      expect(await collect(parseSseEvents(chunks(bytes.slice(0, cut), bytes.slice(cut))))).toEqual(lf);
    }
    expect(await collect(parseSseEvents(chunks(SAMPLE.replace(/\n/g, '\r'))))).toEqual(lf);
  });

  it('コメント行・data の無いイベントは捨て、複数行の data はつなぐ', async () => {
    const text = ': keep-alive\n\nevent: x\n\ndata: {"type":\ndata: "multi"}\n\n';
    expect(await collect(parseSseEvents(chunks(text)))).toEqual([{ type: 'multi' }]);
  });

  it('末尾に空行が無い最後のイベントも返す', async () => {
    const text = 'data: {"type":"message_stop"}';
    expect(await collect(parseSseEvents(chunks(text)))).toEqual([{ type: 'message_stop' }]);
  });

  it('event: error は例外にする', async () => {
    const text = 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"x"}}\n\n';
    await expect(collect(parseSseEvents(chunks(delta('a'), text)))).rejects.toThrow('overloaded_error');
  });

  it('JSON でない・オブジェクトでない data は例外にする', async () => {
    await expect(collect(parseSseEvents(chunks('data: {broken\n\n')))).rejects.toThrow();
    await expect(collect(parseSseEvents(chunks('data: [1,2]\n\n')))).rejects.toThrow('not an object');
  });

  it('区切りの来ない入力は上限ちょうどまで受け、上限 + 1 で打ち切る', async () => {
    const atLimit = 'x'.repeat(MAX_EVENT_CHARS);
    await expect(collect(parseSseEvents(chunks(atLimit)))).resolves.toEqual([]);
    const over = 'x'.repeat(MAX_EVENT_CHARS + 1);
    await expect(collect(parseSseEvents(chunks(over)))).rejects.toThrow('size limit');
  });

  it('上限を超える 1 イベントが細切れで届いても打ち切る', async () => {
    const piece = 'data: ' + 'y'.repeat(64 * 1024);
    const parts = Array.from({ length: Math.ceil(MAX_EVENT_CHARS / piece.length) + 1 }, () => piece);
    await expect(collect(parseSseEvents(chunks(...parts)))).rejects.toThrow('size limit');
  });
});

type FetchCall = { url: string; init: RequestInit };

function fakeFetch(responses: (() => Response)[]): { fetchImpl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const params = { model: 'claude-test', max_tokens: 16, system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }] };
const noSleep = async () => {};

describe('streamMessages', () => {
  it('stream: true を付けて Messages API へ送り、リダイレクトを禁止する', async () => {
    const { fetchImpl, calls } = fakeFetch([() => new Response(SAMPLE, { status: 200 })]);
    const events = await collect(streamMessages('test-key', params, { fetchImpl }));
    expect(events).toHaveLength(5);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.init.method).toBe('POST');
    expect(call.init.redirect).toBe('error');
    const headers = call.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(call.init.body as string)).toEqual({ ...params, stream: true });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('エラー応答は HttpError (本文は 500 文字まで)。400 は再試行しない', async () => {
    const { fetchImpl, calls } = fakeFetch([() => new Response('e'.repeat(2000), { status: 400 })]);
    const err = await collect(streamMessages('k', params, { fetchImpl, sleep: noSleep })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(400);
    expect((err as HttpError).body).toHaveLength(500);
    expect(calls).toHaveLength(1);
  });

  it('529 は再試行してから stream を返す', async () => {
    const { fetchImpl, calls } = fakeFetch([
      () => new Response('{"type":"error"}', { status: 529 }),
      () => new Response(SAMPLE, { status: 200 }),
    ]);
    const events = await collect(streamMessages('k', params, { fetchImpl, sleep: noSleep }));
    expect(events).toHaveLength(5);
    expect(calls).toHaveLength(2);
  });

  it('呼び出し側の signal を中断すると、それ以上進まない', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      init?.signal?.throwIfAborted();
      return new Response(SAMPLE);
    }) as typeof fetch;
    await expect(collect(streamMessages('k', params, { fetchImpl, signal: controller.signal, sleep: noSleep }))).rejects.toThrow();
  });
});
