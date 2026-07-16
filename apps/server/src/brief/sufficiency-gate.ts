// 充足ゲート — 面接開始前の 1 回、ブリーフ材料の充足を決定的カウントで判定する。
// spec/feature/inference/interviewer-reproduction.md §6.4 (Discutere information-gate の縮小版)。
// sparse なら一般解シード (qa-seed) へ明示的に退避し、ブリーフに明記する。
// 「企業面接のふりをした一般面接を無言でやらない」(無言フォールバック禁止の面接版)。

export type Sufficiency = 'rich' | 'moderate' | 'sparse';

export type SufficiencyCounts = {
  companyResolved: boolean;
  hasNewgradImage: boolean;
  companyQuestionCount: number;
  obPatternCount: number;
};

export type SufficiencyResult = {
  level: Sufficiency;
  /** ブリーフ / ログに書く判定理由 (日本語 1 文) */
  reason: string;
  counts: SufficiencyCounts;
};

/** 判定は決定的カウントを一次とする (LLM ゲートは P3)。 */
export function assessSufficiency(counts: SufficiencyCounts): SufficiencyResult {
  const pool = counts.companyQuestionCount + counts.obPatternCount;
  if (!counts.companyResolved) {
    return {
      level: 'sparse',
      reason: '志望企業が企業 DB に見つからないため、一般面接として実施する',
      counts,
    };
  }
  if (counts.hasNewgradImage && pool >= 3) {
    return {
      level: 'rich',
      reason: `新卒像あり + 質問プール ${pool} 件 — 企業固有面接として実施する`,
      counts,
    };
  }
  if (counts.hasNewgradImage || pool >= 1) {
    return {
      level: 'moderate',
      reason: `企業固有データが部分的 (新卒像 ${counts.hasNewgradImage ? 'あり' : 'なし'} / 質問プール ${pool} 件) — 不足分は一般解シードで補う`,
      counts,
    };
  }
  return {
    level: 'sparse',
    reason: '企業固有データ不足 (一般面接として実施)',
    counts,
  };
}
