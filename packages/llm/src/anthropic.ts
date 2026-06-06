import Anthropic from '@anthropic-ai/sdk';

export type AnthropicConfig = {
  apiKey?: string;
};

export function createAnthropicClient(opts: AnthropicConfig = {}): Anthropic {
  const apiKey = opts.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required');
  }
  return new Anthropic({ apiKey });
}

// 役割ごとの既定モデル (3 機種分担)。spec/inference/model-profiles.md。
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

export function extractText(content: Anthropic.Messages.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
