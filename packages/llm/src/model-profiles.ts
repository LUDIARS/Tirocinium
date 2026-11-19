import { contract } from './contracts/runtime.js'; /* augur-inject:import:a1946a4d */
import augurContract_6a5ed622 from './contracts/model-profiles.contract.js'; /* augur-inject:contract-predicate:6c3f28a6 */
// 役割ごとの既定モデル (3 機種分担)。spec/feature/inference/model-profiles.md。
const MODEL_DEFAULTS = {
  RESPONSE: 'sonnet',
  EVALUATOR: 'opus',
  SUMMARIZER: 'opus',
  CRITIC: 'opus',
  EXAMINEE: 'haiku',
  JUDGE: 'haiku',
  // 企業ページからの構造化抽出 (安価・大量) は Haiku。
  EXTRACTOR: 'haiku',
  // ES × 企業の適合判断 (要推論) は Sonnet。
  RECOMMENDER: 'sonnet',
} as const;

export type ModelRole = keyof typeof MODEL_DEFAULTS;

// プロファイル: 3 機種分担を collapse する preset。
const MODEL_PROFILES: Record<string, Partial<Record<ModelRole, string>>> = {
  // 既定 (Sonnet 応答 / Opus 評価 / Haiku judge の 3 機種分担)
  default: {},
  // Opus 一本化: 応答・受験者・judge も Opus に寄せる (最高品質・高コスト)
  'opus-only': {
    RESPONSE: 'opus',
    EXAMINEE: 'opus',
    JUDGE: 'opus',
    EXTRACTOR: 'opus',
    RECOMMENDER: 'opus',
  },
  // 倹約: 上位 LLM (評価/サマリ/critic) を Sonnet に寄せる (低コスト)
  economy: {
    EVALUATOR: 'sonnet',
    SUMMARIZER: 'sonnet',
    CRITIC: 'sonnet',
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
// @ts-expect-error augur-inject
resolveModels = contract(resolveModels, { ...augurContract_6a5ed622, contractId: 'C-4', mode: 'observe', sample: 1, where: 'packages/llm/src/model-profiles.ts:41', rule: 'contract-wrap', id: '6a5ed622' }); /* augur-inject:contract-wrap:6a5ed622 */

export const MODEL = resolveModels();
