// OB 仮名化 serializer (spec/feature/inference/interviewer-reproduction.md §6.2)。
// Discutere §6 と同じ「出所は透明 / 個人は仮名」— ブリーフ・UI に出るのは OB#xxxx のみ。
// cernere_user_id からの決定的ハッシュ短縮 (同じ OB は常に同じ別名 = 出所の一貫性は保つ)。
// 生 ID の参照は admin (DB 直接参照) のみ。

import { createHash } from 'node:crypto';

/** cernere_user_id → 'OB#' + sha256 先頭 6 hex。決定的・不可逆。 */
export function obAlias(cernereUserId: string): string {
  const hex = createHash('sha256').update(cernereUserId, 'utf8').digest('hex');
  return `OB#${hex.slice(0, 6)}`;
}
