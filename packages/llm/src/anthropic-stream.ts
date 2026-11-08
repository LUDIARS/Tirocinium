import { HttpError } from '@ludiars/portus/net';
import type { MessageCreateParams, MessageStreamEvent } from './anthropic-types.js';
import { withRetry, type RetryOptions } from './api-retry.js';

// Anthropic Messages API の stream (SSE)。Portus (v0.1.0) の AnthropicClient は stream を持たないので、
// 同じ方針 (標準 fetch・リダイレクト禁止・タイムアウト・エラー本文の切り詰め) でここに置く。
// Portus に stream が入ったら置き換える。

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
/** 1 回の stream 全体の期限 (旧 SDK の既定と同じ 10 分) */
export const STREAM_TIMEOUT_MS = 10 * 60 * 1000;
/** 1 イベント (区切りの空行まで) の上限。超えたら打ち切る */
export const MAX_EVENT_CHARS = 1024 * 1024;

export type StreamOptions = RetryOptions & {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export async function* streamMessages(
  apiKey: string,
  params: MessageCreateParams,
  opts: StreamOptions = {},
): AsyncGenerator<MessageStreamEvent, void, unknown> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = JSON.stringify({ ...params, stream: true });
  // 再試行は応答の先頭 (ステータス) まで。イベントを返し始めた後は再試行しない。
  const res = await withRetry(async () => {
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? STREAM_TIMEOUT_MS);
    const r = await fetchImpl(MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body,
      redirect: 'error',
      signal: opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
    if (!r.ok) {
      const text = await r.text();
      throw new HttpError(`api.anthropic.com responded ${r.status}`, r.status, text.substring(0, 500));
    }
    return r;
  }, opts);
  if (!res.body) throw new Error('api.anthropic.com returned no stream body');
  yield* parseSseEvents(res.body);
}

/** SSE のバイト列をイベント (data の JSON) に分ける。区切りは空行。event: error は例外にする */
export async function* parseSseEvents(
  body: AsyncIterable<Uint8Array>,
): AsyncGenerator<MessageStreamEvent, void, unknown> {
  const decoder = new TextDecoder();
  const newlines = newlineNormalizer();
  let buffer = '';
  for await (const chunk of body) {
    buffer += newlines.push(decoder.decode(chunk, { stream: true }));
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const event = parseEvent(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (event) yield event;
    }
    // 区切りの来ないまま膨らむ入力は打ち切る (未消化分だけを数える)
    if (buffer.length > MAX_EVENT_CHARS) throw new Error('Anthropic stream event exceeds the size limit');
  }
  buffer += newlines.push(decoder.decode()) + newlines.end();
  const event = parseEvent(buffer);
  if (event) yield event;
}

/** \r\n と単独の \r を \n にそろえる。チャンク末尾の \r は次のチャンクの \n と組になりうるので持ち越す */
function newlineNormalizer() {
  let pendingCr = false;
  return {
    push(text: string): string {
      let s = text;
      if (pendingCr) {
        s = '\r' + s;
        pendingCr = false;
      }
      if (s.endsWith('\r')) {
        pendingCr = true;
        s = s.slice(0, -1);
      }
      return s.replace(/\r\n?/g, '\n');
    },
    end(): string {
      const tail = pendingCr ? '\n' : '';
      pendingCr = false;
      return tail;
    },
  };
}

function parseEvent(raw: string): MessageStreamEvent | null {
  let name = '';
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') name = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return null;
  const parsed: unknown = JSON.parse(data.join('\n'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Anthropic stream event is not an object');
  }
  const event = parsed as MessageStreamEvent;
  if (name === 'error' || event.type === 'error') {
    const detail = (event['error'] as { type?: unknown } | undefined)?.type;
    throw new Error(`Anthropic stream error: ${typeof detail === 'string' ? detail.substring(0, 100) : 'unknown'}`);
  }
  return event;
}
