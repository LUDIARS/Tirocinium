import { OpenAIClient } from '@ludiars/portus/ai';
import { withRetry } from './api-retry.js';

export type OpenAIConfig = {
  apiKey?: string;
};

// OpenAI Chat Completions のうち、Tirocinium が使う範囲だけの型 (旧 openai SDK の型の置き換え)。
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ChatCompletionParams = {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
};

export type ChatCompletion = {
  choices: { message?: { content?: string | null } }[];
};

/** createOpenAIClient が返すクライアント。旧 SDK の `OpenAI` インスタンスのうち使っていた部分 */
export interface OpenAIApi {
  chat: { completions: { create(params: ChatCompletionParams): Promise<ChatCompletion> } };
}

/** 通信は Portus の OpenAIClient (標準 fetch・リダイレクト禁止・タイムアウト付き)。再試行は旧 SDK と同じ条件 */
export function createOpenAIClient(opts: OpenAIConfig = {}): OpenAIApi {
  const apiKey = opts.apiKey ?? process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }
  const client = new OpenAIClient(apiKey);
  return {
    chat: {
      completions: {
        create: async (params) => asChatCompletion(await withRetry(() => client.chatCompletions(params))),
      },
    },
  };
}

function asChatCompletion(res: unknown): ChatCompletion {
  if (!res || typeof res !== 'object' || !Array.isArray((res as { choices?: unknown }).choices)) {
    throw new Error('api.openai.com returned an unexpected completion');
  }
  return res as ChatCompletion;
}

/** 既定モデル。 GPT-5.5 が公開されたら env で差し替える。 暫定は gpt-4o */
export const OPENAI_MODEL = {
  REFINE: process.env['OPENAI_MODEL_REFINE'] ?? 'gpt-4o',
} as const;
