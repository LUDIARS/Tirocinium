// ユーザ提供リンク (情報提供ウインドウ) の内容を LLM で分類・抽出する純パーサ。
// 取得本文を「企業情報 / ゲーム情報 / 新卒情報 / その他」に型分けし、 型ごとのフィールドを抜く。
// LLM 呼び出し自体は server 側 (completer) が行い、 ここは instruction と parse のみ (決定論)。
// spec/companies/game-graph.md / README §3 の発見経路をユーザ手動投入で補う。

import { extractJsonBlock } from '@tirocinium/llm';

/** リンク 1 本の分類結果 (type で分岐)。 */
export type LinkContribution = {
  type: 'company' | 'game' | 'newgrad' | 'other';
  /** company: 社名 / game: タイトル / newgrad: 記事の対象社名 */
  name: string;
  /** company の業界 */
  industry: string;
  /** company 概要 / game 概要 / newgrad 記事の要旨 */
  description: string;
  location: string;
  tags: string[];
  /** game: 開発元 */
  developers: string[];
  /** game: 発売元 */
  publishers: string[];
  /** game: シリーズ */
  series: string;
  /** 分類根拠 (短文) */
  reason: string;
};

export const LINK_CLASSIFY_INSTRUCTION = `あなたはゲーム業界の企業データベースのための情報分類アシスタントです。
与えられた Web ページ本文を読み、 次のいずれに該当するかを判定し、 JSON で返してください。

- "company": 企業の公式サイト・会社概要・IR・採用トップなど、 ある会社そのものの情報
- "game": あるゲーム作品の情報 (開発元/発売元/シリーズ等が読み取れるページ)
- "newgrad": 新卒採用・社員/内定者インタビュー・募集要項など、 新卒就職に関わる情報
- "other": 上記のいずれにも当てはまらない

出力 JSON (該当しないフィールドは空文字 "" または空配列 [] にする):
{
  "type": "company" | "game" | "newgrad" | "other",
  "name": "会社名(company/newgrad) または ゲームタイトル(game)",
  "industry": "業界 (company のみ)",
  "description": "120字以内の要約 (会社概要/ゲーム概要/記事要旨)",
  "location": "所在地 (company のみ、 分かれば)",
  "tags": ["技術/社風/ジャンル 等のキーワード"],
  "developers": ["開発元 (game のみ)"],
  "publishers": ["発売元 (game のみ)"],
  "series": "シリーズ名 (game のみ)",
  "reason": "判定理由 (40字以内)"
}
JSON 以外は出力しないでください。`;

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const TYPES = new Set(['company', 'game', 'newgrad', 'other']);

/** LLM 出力 (JSON) を LinkContribution に正規化する。 失敗時は type='other'。 */
export function parseLinkContribution(text: string): LinkContribution {
  const base: LinkContribution = {
    type: 'other', name: '', industry: '', description: '', location: '',
    tags: [], developers: [], publishers: [], series: '', reason: '',
  };
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(extractJsonBlock(text)) as Record<string, unknown>;
  } catch {
    return base;
  }
  const t = str(obj['type']).toLowerCase();
  return {
    type: (TYPES.has(t) ? t : 'other') as LinkContribution['type'],
    name: str(obj['name']).slice(0, 200),
    industry: str(obj['industry']).slice(0, 120),
    description: str(obj['description']).slice(0, 1000),
    location: str(obj['location']).slice(0, 120),
    tags: arr(obj['tags']).slice(0, 24),
    developers: arr(obj['developers']).slice(0, 24),
    publishers: arr(obj['publishers']).slice(0, 24),
    series: str(obj['series']).slice(0, 120),
    reason: str(obj['reason']).slice(0, 200),
  };
}
