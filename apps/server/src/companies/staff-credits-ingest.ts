// スタッフロール本文 1 ページ分の取り込み (DB 非依存の純 IO)。
// パースは parseStaffCredits (決定論)、 DB 反映 (game/company 解決・link) は deps 注入。
// game-graph §5.2。 DB 配線 (実 deps + クロール) は staff-credits-crawl.ts。

import { parseStaffCredits, type StaffCreditRole } from '@tirocinium/companies';

export type StaffCreditsSummary = {
  sources: string[];
  pagesFetched: number;
  /** 解決できたゲーム数 */
  games: number;
  /** 張った company_game edge 数 */
  edges: number;
  /** 新規発見した企業数 (未検知企業の自動発見) */
  newCompanies: number;
  robotsBlocked: number;
  errors: { url: string; message: string }[];
};

export const emptyStaffCreditsSummary = (): StaffCreditsSummary => ({
  sources: [], pagesFetched: 0, games: 0, edges: 0, newCompanies: 0, robotsBlocked: 0, errors: [],
});

/** ingest の外部依存 (DB を注入。 テストで差し替え可能)。 */
export type StaffCreditsDeps = {
  /** ゲーム名 → game_id (upsert して返す)。 不正タイトルは null。 */
  resolveGameId(title: string): Promise<string | null>;
  /** 社名 → company_id (upsert して返す)。 isNew=新規発見。 不正名は null。 */
  resolveCompanyId(name: string): Promise<{ id: string; isNew: boolean } | null>;
  /** company_game edge を張る。 */
  link(companyId: string, gameId: string, role: StaffCreditRole): Promise<void>;
};

/**
 * クレジット本文 1 ページ分を取り込む (DB 非依存・テスト可能)。
 * parseStaffCredits でゲーム + 関与企業群を抽出し、 ゲームを解決して各企業を role 付きで張る。
 * 未知企業は deps.resolveCompanyId 側で upsert され (source='staff-credits')、 自動発見になる。
 */
export async function ingestStaffCredits(
  text: string,
  deps: StaffCreditsDeps,
  summary: StaffCreditsSummary,
): Promise<void> {
  const parsed = parseStaffCredits(text);
  if (!parsed.game || parsed.credits.length === 0) return;
  const gameId = await deps.resolveGameId(parsed.game);
  if (!gameId) return;
  summary.games++;
  for (const c of parsed.credits) {
    const company = await deps.resolveCompanyId(c.company);
    if (!company) continue;
    if (company.isNew) summary.newCompanies++;
    await deps.link(company.id, gameId, c.role);
    summary.edges++;
  }
}
