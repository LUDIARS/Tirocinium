// OB 仮名化 serializer (spec/feature/inference/interviewer-reproduction.md §6.2)。
// Discutere §6 と同じ「出所は透明 / 個人は仮名」— ブリーフ・UI に出るのは OB#xxxx のみ。
// cernere_user_id からの決定的ハッシュ短縮 (同じ OB は常に同じ別名 = 出所の一貫性は保つ)。
// 生 ID の参照は admin (DB 直接参照) のみ。
//
// 旧実装は無塩 SHA-256 を 24bit (6 hex) に切り詰めていた — cernere_user_id は形式が
// 既知 (UUID 等) なため、無塩ハッシュは総当りで逆引きされ得る (列挙攻撃)。
// pepper (env 未設定時は built-in 既定値) を鍵として混ぜ、出力も 48bit (12 hex) に拡張する。

import { createHash } from 'node:crypto';

// 本番運用では TIROCINIUM_OB_ALIAS_SALT を必ず設定すること (未設定時のみ既定値を使う縮退)。
const DEFAULT_SALT = 'tirocinium-ob-alias-v1';

/** cernere_user_id → 'OB#' + salted-sha256 先頭 12 hex。決定的・不可逆。
 *  salt は既定で env TIROCINIUM_OB_ALIAS_SALT (未設定時は DEFAULT_SALT)。 */
export function obAlias(
  cernereUserId: string,
  salt: string = process.env['TIROCINIUM_OB_ALIAS_SALT'] || DEFAULT_SALT,
): string {
  const hex = createHash('sha256').update(`${salt}:${cernereUserId}`, 'utf8').digest('hex');
  return `OB#${hex.slice(0, 12)}`;
}
