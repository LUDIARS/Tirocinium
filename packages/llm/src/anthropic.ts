import { AnthropicClient } from '@ludiars/portus/ai';
import { streamMessages } from './anthropic-stream.js';
import type { AnthropicApi, ContentBlock, Message, TextBlock } from './anthropic-types.js';
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
      create: async (params) => asMessage(await withRetry(() => client.createMessage(params))),
      stream: (params, options) => streamMessages(apiKey, params, { signal: options?.signal }),
    },
  };
}

function asMessage(res: unknown): Message {
  if (!res || typeof res !== 'object' || !Array.isArray((res as { content?: unknown }).content)) {
    throw new Error('api.anthropic.com returned an unexpected message');
  }
  return res as Message;
}

// 役割ごとの既定モデル (3 機種分担)。spec/feature/inference/model-profiles.md。
const MODEL_DEFAULTS = {
  RESPONSE: 'claude-sonnet-4-6',
  EVALUATOR: 'claude-opus-4-7',
  SUMMARIZER: 'claude-opus-4-7',
  CRITIC: 'claude-opus-4-7',
  EXAMINEE: 'claude-haiku-4-5-20251001',
  JUDGE: 'claude-haiku-4-5-20251001',
  // 企業ページからの構造化抽出 (安価・大量) は Haiku。
  EXTRACTOR: 'claude-haiku-4-5-20251001',
  // ES × 企業の適合判断 (要推論) は Sonnet。
  RECOMMENDER: 'claude-sonnet-4-6',
} as const;

export type ModelRole = keyof typeof MODEL_DEFAULTS;

// プロファイル: 3 機種分担を collapse する preset。
const MODEL_PROFILES: Record<string, Partial<Record<ModelRole, string>>> = {
  // 既定 (Sonnet 応答 / Opus 評価 / Haiku judge の 3 機種分担)
  default: {},
  // Opus 一本化: 応答・受験者・judge も Opus に寄せる (最高品質・高コスト)
  'opus-only': {
    RESPONSE: 'claude-opus-4-7',
    EXAMINEE: 'claude-opus-4-7',
    JUDGE: 'claude-opus-4-7',
    EXTRACTOR: 'claude-opus-4-7',
    RECOMMENDER: 'claude-opus-4-7',
  },
  // 倹約: 上位 LLM (評価/サマリ/critic) を Sonnet に寄せる (低コスト)
  economy: {
    EVALUATOR: 'claude-sonnet-4-6',
    SUMMARIZER: 'claude-sonnet-4-6',
    CRITIC: 'claude-sonnet-4-6',
  },
};

/**
 * モデル割当を解決する。優先順位: 役割別 env (TIROCINIUM_MODEL_<ROLE>) >
 * プロファイル (TIROCINIUM_MODEL_PROFILE) > 既定。
 */
export function resolveModels(env: NodeJS.ProcessEnv = process.env): Record<ModelRole, string> {
  const profileName = (env['TIROCINIUM_MODEL_PROFILE'] ?? 'default').toLowerCase();
  const profile = MODEL_PROFILES[profileName] ?? {};
  const out = {} as Record<ModelRole, string>;
  for (const role of Object.keys(MODEL_DEFAULTS) as ModelRole[]) {
    out[role] = env[`TIROCINIUM_MODEL_${role}`] || profile[role] || MODEL_DEFAULTS[role];
  }
  return out;
}

export const MODEL = resolveModels();

export function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is TextBlock => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('');
}
