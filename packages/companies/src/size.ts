// 会社規模 (従業員数) と上場区分の決定論パーサ。 純粋関数 (LLM 不使用)。
// 規模 = 従業員数。 不明 (抽出できない) は 0 とし、 中小企業として扱う (ユーザ定義)。
// 上場区分は東証の市場区分タグ (prime/growth/standard/other) を返す。

/**
 * 中小企業とみなす従業員数の上限。 中小企業基本法のソフトウェア業/情報サービス業
 * (従業員 300 人以下) に準拠。 これを超えると大手扱い。
 */
export const SMB_EMPLOYEE_MAX = 300;

/** 上場市場区分。 '' は非上場 or 不明。 */
export type ListingMarket = '' | 'prime' | 'growth' | 'standard' | 'other';

/** count===0 (不明) または SMB_EMPLOYEE_MAX 以下なら中小。 */
export function isSMBByEmployees(employeeCount: number): boolean {
  return employeeCount === 0 || employeeCount <= SMB_EMPLOYEE_MAX;
}

const num = (s: string): number => Number(s.replace(/[,，\s]/g, ''));

/**
 * 日本語テキストから従業員数を抽出する。 抽出できなければ 0 (不明)。
 * 例: "従業員数128名" → 128 / "従業員数約4〜6名" → 6 (範囲は上限) /
 *     "社員数 1,200名" → 1200 / "従業員数 約1.2万人" → 12000。
 * 「従業員/社員」の語に近い数値のみを採る (資本金等の誤検出を避ける)。
 */
export function extractEmployeeCount(text: string | undefined): number {
  const t = (text ?? '').replace(/\s+/g, ' ');
  if (!t) return 0;
  // 「従業員(数)/社員(数)」の後、 数値直前の語 (連結/単独/グループ全体/約 等) を 8 文字まで
  // 読み飛ばし、 最初の数値表現 (範囲は上限) を採る。 資本金など他フィールド誤検出を防ぐため anchor 必須。
  const m = t.match(/(?:従業員|社員)\s*数?\s*[:：]?\s*[^\d名人]{0,8}?([\d,，.]+)\s*(?:[〜～\-‐−]\s*[約]*\s*([\d,，.]+))?\s*(万)?\s*[名人]/);
  if (!m) return 0;
  const unit = m[3] === '万' ? 10000 : 1;
  const lo = num(m[1]!);
  const hi = m[2] ? num(m[2]) : lo;
  const v = Math.max(lo, hi) * unit; // 範囲は上限を採用 (中小判定で過小評価しない)
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}

/**
 * テキスト (IR 文 / タグ) から上場市場区分を判定する。
 * 一部上場/東証一部/プライム → prime、 マザーズ/グロース → growth、
 * 二部/スタンダード/JASDAQ → standard、 その他「上場」表記 → other、 非上場/不明 → ''。
 */
export function parseListingMarket(...texts: (string | undefined)[]): ListingMarket {
  const t = texts.filter(Boolean).join(' ');
  if (!t) return '';
  // 非上場が明示されていて他の上場語が無ければ非上場。
  if (/非上場|未上場|株式非公開/.test(t) && !/(プライム|グロース|スタンダード|マザーズ|東証[一二]部|上場)/.test(t.replace(/非上場|未上場/g, ''))) {
    return '';
  }
  if (/プライム市場|東証プライム|一部上場|東証一部|東証1部/.test(t)) return 'prime';
  if (/グロース市場|東証グロース|マザーズ/.test(t)) return 'growth';
  if (/スタンダード市場|東証スタンダード|二部上場|東証二部|東証2部|jasdaq/i.test(t)) return 'standard';
  if (/上場/.test(t.replace(/非上場|未上場/g, ''))) return 'other';
  return '';
}

/** 市場コード → 表示タグ (日本語)。 UI/タグ用。 */
export function listingLabel(market: ListingMarket): string {
  switch (market) {
    case 'prime': return '一部上場(プライム)';
    case 'growth': return 'マザーズ(グロース)';
    case 'standard': return '二部(スタンダード)';
    case 'other': return '上場(市場不明)';
    case '': return '';
  }
}
