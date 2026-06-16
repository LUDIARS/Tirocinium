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

/** 従業員数の 1 マッチ。 consolidated = 連結 (グループ全体) 規模か。 at = 出現位置。 */
type EmployeeMatch = { value: number; consolidated: boolean; at: number };

// 「従業員/社員(数)」アンカー。 ここから後方ウィンドウの図表を読む。
const EMP_ANCHOR_RE = /(?:従業員|社員)\s*数?\s*[:：]?/g;
// アンカー後方の「(連結/単体 等のラベル)数値(範囲)?(万)?名/人(（注記）)?」を 1 件ずつ拾う。
// ラベルは数値直前の非数字 8 文字 (連結/単独/グループ/約 等)。 末尾の （連結）/（単体）注記も拾う。
const EMP_FIGURE_RE =
  /([^\d名人]{0,8})([\d,，.]+)\s*(?:[〜～\-‐−]\s*[約]*\s*([\d,，.]+))?\s*(万)?\s*[名人]\s*(?:[（(]\s*([^）)]{0,12}?)\s*[）)])?/g;
const CONSOLIDATED_RE = /連結|グループ|全社|全体/;
const NONCONSOLIDATED_RE = /単体|単独/;
// 1 アンカーから読む後方ウィンドウ長 (「連結X名 単体Y名」併記を 1 アンカーで拾える程度)。
const FIGURE_WINDOW = 48;

/**
 * テキスト中の「従業員/社員」アンカー付き従業員数を全て収集する (出現順)。
 * 各アンカーの後方ウィンドウ内の「ラベル+数値+名/人」を順に拾い、 範囲は上限を採る。
 * 直前ラベル or 末尾注記の「連結/グループ/全体」で consolidated を立て、「単体/単独」は連結扱いしない。
 * 別アンカーを跨いだ数値はそのアンカー側に任せて打ち切る。 anchor 必須で資本金等の誤検出を防ぐ。 純粋・決定論。
 */
function collectEmployeeMatches(text: string | undefined): EmployeeMatch[] {
  const t = (text ?? '').replace(/\s+/g, ' ');
  const out: EmployeeMatch[] = [];
  if (!t) return out;
  EMP_ANCHOR_RE.lastIndex = 0;
  let a: RegExpExecArray | null;
  while ((a = EMP_ANCHOR_RE.exec(t)) !== null) {
    const start = a.index + a[0].length;
    const window = t.slice(start, start + FIGURE_WINDOW);
    EMP_FIGURE_RE.lastIndex = 0;
    let f: RegExpExecArray | null;
    while ((f = EMP_FIGURE_RE.exec(window)) !== null) {
      const label = f[1] ?? '';
      // 別アンカー (従業員/社員) を跨いだ数値は、 そのアンカーの iteration に任せて打ち切る。
      if (/従業員|社員/.test(label)) break;
      const unit = f[4] === '万' ? 10000 : 1;
      const lo = num(f[2]!);
      const hi = f[3] ? num(f[3]) : lo;
      const v = Math.max(lo, hi) * unit; // 範囲は上限を採用 (中小判定で過小評価しない)
      if (!Number.isFinite(v) || v <= 0) continue;
      const marker = `${label} ${f[5] ?? ''}`;
      const consolidated = CONSOLIDATED_RE.test(marker) && !NONCONSOLIDATED_RE.test(marker);
      const at = start + f.index;
      if (!out.some((o) => o.at === at)) out.push({ value: Math.round(v), consolidated, at });
    }
  }
  out.sort((p, q) => p.at - q.at);
  return out;
}

/**
 * 日本語テキストから従業員数を抽出する。 抽出できなければ 0 (不明)。
 * 例: "従業員数128名" → 128 / "従業員数約4〜6名" → 6 (範囲は上限) /
 *     "社員数 1,200名" → 1200 / "従業員数 約1.2万人" → 12000。
 * 「従業員/社員」の語に近い数値のみを採る (資本金等の誤検出を避ける)。 最初の 1 件を採用。
 */
export function extractEmployeeCount(text: string | undefined): number {
  return collectEmployeeMatches(text)[0]?.value ?? 0;
}

/**
 * IR / 会社情報ページ本文から従業員数を裏取り抽出する (game-graph §5.4 Phase4)。
 * {@link extractEmployeeCount} と同じ anchor 規則だが、 IR 文に頻出する「連結 / 単体(単独)」
 * 併記に対応し、 企業グループ全体の規模である**連結 (consolidated) を優先**する。
 * 連結マーカーが無ければ全候補の最大値を採る。 純粋・決定論 (LLM 不使用)。 抽出不可は 0。
 * 例: "従業員数 連結12,345名 単体3,400名" → 12345 /
 *     "従業員数 8,900名（連結）" → 8900 / "従業員数 540名" → 540。
 */
export function extractEmployeeFromIR(irText: string | undefined): number {
  const candidates = collectEmployeeMatches(irText);
  if (candidates.length === 0) return 0;
  const consolidated = candidates.filter((c) => c.consolidated);
  const pool = consolidated.length > 0 ? consolidated : candidates;
  return pool.reduce((max, c) => Math.max(max, c.value), 0);
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
