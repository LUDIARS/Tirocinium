// 英⇔カナ社名の自動マージ — 純関数層 (DB 非依存・決定論)。
// corporate_number が同じ重複行から survivor を選び、survivor に適用すべき差分を計算する。
// spec/companies/game-graph.md §5.5。

import { mergeSources } from './provenance.js';
import type { Company, CompanySource } from './types.js';

// ── survivor 選定 ──────────────────────────────────────────────────────────

/** survivor スコア算出の入力 (company_id + スコアに使う集計値のみ)。 */
export type MergeCandidate = {
  id: string;
  url: string;
  description: string;
  crawled_at: string;
  /** company_game edge 数。 */
  gameCount: number;
  /** company_ob_placement 行数。 */
  obCount: number;
};

/**
 * 重複グループ (corporate_number 同一) から survivor を選ぶ。
 * スコア = (url非空?1:0) + (description非空?1:0) + gameCount + obCount。
 * 同点は crawled_at 昇順 (古い方) → id 昇順で決定論的に解決する。
 * @returns survivor の id
 */
export function selectSurvivor(group: MergeCandidate[]): string {
  if (group.length === 0) throw new Error('selectSurvivor: group must not be empty');
  const scored = group.map((c) => ({
    id: c.id,
    score:
      (c.url.trim() !== '' ? 1 : 0) +
      (c.description.trim() !== '' ? 1 : 0) +
      c.gameCount +
      c.obCount,
    crawled_at: c.crawled_at,
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // 同点: 古い方 (crawled_at 昇順) → id 昇順 (決定論)
    const ta = new Date(a.crawled_at).getTime();
    const tb = new Date(b.crawled_at).getTime();
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return scored[0]!.id;
}

// ── survivor フィールドマージ ──────────────────────────────────────────────

/** survivor 行に適用すべき差分 (loser の情報を survivor に補完する内容)。 */
export type SurvivorFieldPatch = {
  /** sources の union 結果。 */
  sources: CompanySource[];
  /** boolean フラグ — どれかが true なら true (OR)。 */
  is_newgrad: boolean;
  is_game: boolean;
  has_opening: boolean;
  is_smb: boolean;
  is_listed: boolean;
  /** scalar — survivor が空なら loser の非空値で補完 (COALESCE 相当)。 */
  url: string;
  description: string;
  industry: string;
  location: string;
  size: string;
  recruit_url: string;
  listing_market: string;
  corporate_number: string;
  stock_reason: string;
};

/**
 * survivor + losers の全行から「survivor に適用すべき差分」を計算する。
 * sources は全行の union。boolean フラグは OR。scalar は survivor が空なら loser で補完。
 * @param survivor DB から読んだ survivor 行。
 * @param losers   DB から読んだ loser 行群 (0 件も可)。
 */
export function mergeCompanyFields(
  survivor: Company,
  losers: Company[],
): SurvivorFieldPatch {
  const all = [survivor, ...losers];

  // sources: 全行 sources + (source/source_url) を union
  const allSources: CompanySource[] = all.flatMap((c) => [
    ...c.sources,
    ...(c.source.trim() ? [{ source: c.source, url: c.source_url }] : []),
  ]);
  const sources = mergeSources([], allSources);

  // boolean フラグ: OR
  const is_newgrad = all.some((c) => c.is_newgrad);
  const is_game = all.some((c) => c.is_game);
  const has_opening = all.some((c) => c.has_opening);
  const is_smb = all.some((c) => c.is_smb);
  const is_listed = all.some((c) => c.is_listed);

  // scalar: survivor が空ならloser で補完 (先着)
  const coalesce = (field: keyof Company): string => {
    const current = (survivor[field] as string | undefined) ?? '';
    if (current.trim() !== '') return current;
    for (const loser of losers) {
      const v = (loser[field] as string | undefined) ?? '';
      if (v.trim() !== '') return v;
    }
    return current;
  };

  return {
    sources,
    is_newgrad,
    is_game,
    has_opening,
    is_smb,
    is_listed,
    url: coalesce('url'),
    description: coalesce('description'),
    industry: coalesce('industry'),
    location: coalesce('location'),
    size: coalesce('size'),
    recruit_url: coalesce('recruit_url'),
    listing_market: coalesce('listing_market'),
    corporate_number: coalesce('corporate_number'),
    stock_reason: coalesce('stock_reason'),
  };
}
