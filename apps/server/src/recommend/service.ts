// ES → おすすめ企業のオーケストレーション。
// プロファイル組み立て (request es_text / Memoria RAG / 弱点プロファイル) → recommend (LLM or heuristic)。
// ES 本文は request scope / Memoria 由来のみで、 Tirocinium DB には保存しない (DESIGN §6)。

import { createAnthropicClient, MODEL } from '@tirocinium/llm';
import {
  createMemoriaClient,
  renderRagBlock,
  type RagResult,
} from '@tirocinium/training';
import {
  recommend,
  recommendHeuristic,
  type ApplicantProfile,
  type RecommendationResult,
} from '@tirocinium/companies';
import { config } from '../config.js';
import { sql } from '../db/index.js';
import { allCompaniesForScoring } from '../companies/repo.js';

export type RecommendRequest = {
  userId: string;
  targetRole?: string;
  targetCompany?: string;
  tags?: string[];
  /** request scope の ES 本文 (永続化しない)。 未指定なら Memoria RAG を試みる。 */
  esText?: string;
  topK?: number;
};

export type RecommendOutcome = {
  result: RecommendationResult;
  query: { target_role?: string; target_company?: string; tags?: string[]; weak_axes?: string[] };
  /** プロファイルに ES 素材が乗ったか (空なら tags/role のみの弱い推薦) */
  hasEsMaterial: boolean;
};

/** ユーザの弱点軸 top3 を読む (system prompt 注入と同じ情報源)。 */
async function fetchWeakAxes(userId: string): Promise<string[]> {
  const rows = await sql<{ weak_top3: string[] }[]>`
    SELECT weak_top3 FROM weakness_profiles WHERE user_id = ${userId}
  `;
  return rows[0]?.weak_top3 ?? [];
}

/** Memoria RAG から ES / portfolio 素材を引いて excerpt を結合する。 失敗 / 未設定なら空。 */
async function fetchEsMaterialFromMemoria(
  userId: string,
  query: string,
  tags: string[],
): Promise<string> {
  const memoria = createMemoriaClient();
  if (!memoria) return '';
  try {
    const res: RagResult = await memoria.rag({
      user_id: userId,
      query: query || 'ES 強み 志望',
      filter: { kinds: ['es', 'portfolio', 'self_intro'], tags: tags.length > 0 ? tags : undefined },
      topK: 6,
    });
    return renderRagBlock(res);
  } catch (err) {
    console.warn('[recommend] memoria rag failed:', (err as Error).message);
    return '';
  }
}

export async function runRecommend(req: RecommendRequest): Promise<RecommendOutcome> {
  const tags = (req.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const weakAxes = await fetchWeakAxes(req.userId);

  let esText = (req.esText ?? '').trim();
  if (!esText) {
    const ragQuery = [req.targetRole, req.targetCompany, ...tags, ...weakAxes]
      .filter(Boolean)
      .join(' ');
    esText = await fetchEsMaterialFromMemoria(req.userId, ragQuery, tags);
  }

  const profile: ApplicantProfile = {
    esText,
    targetRole: req.targetRole,
    targetCompany: req.targetCompany,
    tags,
    weakAxes,
  };

  const companies = await allCompaniesForScoring();
  const topK = req.topK;

  let result: RecommendationResult;
  let client: ReturnType<typeof createAnthropicClient> | null = null;
  if (config.llmBackend === 'api') {
    try {
      client = createAnthropicClient();
    } catch {
      client = null;
    }
  }

  if (client) {
    try {
      result = await recommend(client, MODEL.RECOMMENDER, profile, companies, { topK });
    } catch (err) {
      console.warn('[recommend] llm rerank failed, fallback to heuristic:', (err as Error).message);
      result = recommendHeuristic(profile, companies, { topK });
    }
  } else {
    result = recommendHeuristic(profile, companies, { topK });
  }

  return {
    result,
    query: {
      target_role: req.targetRole,
      target_company: req.targetCompany,
      tags,
      weak_axes: weakAxes,
    },
    hasEsMaterial: esText.length > 0,
  };
}
