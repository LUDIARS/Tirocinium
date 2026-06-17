// 英⇔カナ社名の自動マージ — DB 非依存コア (deps 注入・テスト可能)。
// corporate_number が同じ重複行を 1 行に集約する。実 DB 配線は company-merge-wire.ts に置く。
// spec/companies/game-graph.md §5.5。

import { selectSurvivor, mergeCompanyFields } from '@tirocinium/companies';
import type { MergeCandidate, SurvivorFieldPatch } from '@tirocinium/companies';
import type { Company } from '@tirocinium/companies';

/** 1 重複グループ (corporate_number 単位) の情報。 */
export type DuplicateGroup = {
  corporateNumber: string;
  /** グループ内の全行 (candidates + スコア算出用集計値)。 */
  candidates: (MergeCandidate & { company: Company })[];
};

/** マージ実行のサマリ。 */
export type MergeSummary = {
  /** 処理した重複グループ数。 */
  groups: number;
  /** マージされた企業ペア数 (= Σ (グループ loser 数))。 */
  merged: number;
  /** repoint 処理した子テーブル行の合計。 */
  repointed: number;
  /** 削除した loser 企業行数。 */
  deleted: number;
  /** dry-run か (true なら DB 反映なし)。 */
  dryRun: boolean;
};

/** runDuplicateMerge に注入する依存。 テストでは全て fake に差し替える。 */
export type DuplicateMergeDeps = {
  /** corporate_number が同じ複数行を返す (1 件のみのグループは除外済みが望ましい)。 */
  getDuplicateGroups(): Promise<DuplicateGroup[]>;
  /**
   * dupId を survivorId に repoint する (子テーブル全件 + companies UPDATE)。
   * @returns repoint した子テーブル行数の合計。
   */
  repointAll(dupId: string, survivorId: string): Promise<number>;
  /** survivor 行に差分パッチを適用する。 */
  applySurvivorFields(survivorId: string, patch: SurvivorFieldPatch): Promise<void>;
  /** loser の companies 行を削除する (子テーブルは repointAll 後)。 */
  deleteCompany(id: string): Promise<void>;
  /** true なら DB 反映せず差分算出のみ。 */
  dryRun?: boolean;
};

/**
 * 重複グループを取得し、グループごとに survivor を選定→フィールドマージ→repoint→dup削除 する。
 * DB を import しない (deps 注入)。
 */
export async function runDuplicateMerge(deps: DuplicateMergeDeps): Promise<MergeSummary> {
  const dryRun = deps.dryRun ?? false;
  const groups = await deps.getDuplicateGroups();

  let merged = 0;
  let repointed = 0;
  let deleted = 0;

  for (const group of groups) {
    if (group.candidates.length < 2) continue; // 重複なし (念のため)

    const survivorId = selectSurvivor(group.candidates);
    const survivorEntry = group.candidates.find((c) => c.id === survivorId)!;
    const losers = group.candidates.filter((c) => c.id !== survivorId);

    const patch = mergeCompanyFields(
      survivorEntry.company,
      losers.map((l) => l.company),
    );

    if (!dryRun) {
      // loser ごとに子テーブルを repoint してから companies 行を削除する
      for (const loser of losers) {
        const rp = await deps.repointAll(loser.id, survivorId);
        repointed += rp;
        await deps.deleteCompany(loser.id);
        deleted++;
      }
      await deps.applySurvivorFields(survivorId, patch);
    }

    merged += losers.length;
  }

  return { groups: groups.length, merged, repointed, deleted, dryRun };
}
