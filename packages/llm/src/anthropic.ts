import { AnthropicClient } from '@ludiars/portus/ai';
import { streamMessages } from './anthropic-stream.js';
import type { AnthropicApi, ContentBlock, Message, TextBlock } from './anthropic-types.js';
import { resolveRequestModel } from './model-resolution.js';
import { withRetry } from './api-retry.js';

export type AnthropicConfig = {
  apiKey?: string;
};

/**
 * 直接 API (鍵必須) のクライアント。通信は Portus の AnthropicClient (標準 fetch・リダイレクト禁止・
 * タイムアウト付き) で、旧 @anthropic-ai/sdk の `messages.create` / `messages.stream` の形を保つ。
 */
export function createAnthropicClient(opts: AnthropicConfig = {}): AnthropicApi {
  const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required');
  }
  const client = new AnthropicClient(apiKey);
  return {
    messages: {
      create: async (params) => {
        const request = { ...params, model: resolveRequestModel(params.model, 'claude') };
        return asMessage(await withRetry(() => client.createMessage(request)));
      },
      stream: (params, options) => streamMessages(apiKey, { ...params, model: resolveRequestModel(params.model, 'claude') }, { signal: options?.signal }),
    },
  };
}

function asMessage(res: unknown): Message {
  if (!res || typeof res !== 'object' || !Array.isArray((res as { content?: unknown }).content)) {
    throw new Error('api.anthropic.com returned an unexpected message');
  }
  return res as Message;
}

export function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}
