// 職種/技術の別名辞書 + 検索語の素朴分解。
// spec/feature/inference/interviewer-reproduction.md §6.3:
// Discutere game-aliases が略称未展開で検索 0 件を長期間見逃した教訓を先取りし、
// Memoria RAG / 質問プール検索の query を素の連結文字列にしない。

/** newgrad_role_images の role 粒度 (migration 006)。 */
export type CanonicalRole = 'general' | 'planner' | 'programmer' | 'designer' | 'sound';

/** 職種の canonical → 別名 (照合は小文字化して行う)。 */
const ROLE_ALIASES: Record<Exclude<CanonicalRole, 'general'>, string[]> = {
  programmer: [
    'programmer', 'プログラマ', 'プログラマー', 'エンジニア', 'engineer',
    'クライアントエンジニア', 'サーバーエンジニア', 'サーバエンジニア',
    'fe', 'フロントエンド', 'frontend', 'バックエンド', 'backend',
    'ゲームプログラマ', 'ゲームプログラマー', 'テクニカルアーティスト', 'ta',
  ],
  planner: [
    'planner', 'プランナー', '企画', 'ゲームプランナー', 'ゲームデザイナー',
    'game designer', 'レベルデザイナー', 'ディレクター志望',
  ],
  designer: [
    'designer', 'デザイナー', 'グラフィッカー', 'アーティスト', 'artist',
    '2d', '3d', 'モデラー', 'アニメーター', 'ui', 'uiデザイナー', 'イラストレーター',
  ],
  sound: [
    'sound', 'サウンド', 'コンポーザー', '作曲', 'サウンドクリエイター', 'se', '音響',
  ],
};

/** 技術用語の相互別名 (検索語展開用)。1 グループ = 同義扱い。 */
const TECH_ALIAS_GROUPS: string[][] = [
  ['ue', 'unreal engine', 'unreal', 'アンリアルエンジン', 'アンリアル'],
  ['unity', 'ユニティ'],
  ['fe', 'フロントエンド', 'frontend'],
  ['バックエンド', 'backend', 'サーバーサイド', 'サーバサイド'],
  ['c++', 'cpp', 'シープラスプラス'],
  ['c#', 'csharp', 'シーシャープ'],
  ['ts', 'typescript', 'タイプスクリプト'],
  ['gl', 'opengl'],
  ['ml', '機械学習', 'machine learning', 'ai'],
];

/** 自由入力の職種文字列を newgrad_role_images の role 粒度へ正規化する。
 *  どれにも該当しなければ 'general' (会社全体像) に落とす。 */
export function canonicalRole(input: string | null | undefined): CanonicalRole {
  if (!input) return 'general';
  const t = input.trim().toLowerCase();
  if (!t) return 'general';
  for (const [canon, aliases] of Object.entries(ROLE_ALIASES) as [CanonicalRole, string[]][]) {
    if (canon === t) return canon;
    // 2 文字以下の略称 (se/ta/ui 等) は誤爆しやすいので完全一致のみ、3 文字以上は部分一致も許す
    if (aliases.some((a) => t === a || (a.length >= 3 && t.includes(a)))) return canon;
  }
  return 'general';
}

/** 検索語リストを別名込みに展開する (順序保存 + 重複除去)。 */
export function expandTerms(terms: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const k = t.trim();
    if (k && !seen.has(k.toLowerCase())) {
      seen.add(k.toLowerCase());
      out.push(k);
    }
  };
  for (const term of terms) {
    push(term);
    const lower = term.trim().toLowerCase();
    for (const group of TECH_ALIAS_GROUPS) {
      if (group.includes(lower)) group.forEach(push);
    }
    for (const aliases of Object.values(ROLE_ALIASES)) {
      if (aliases.includes(lower)) aliases.slice(0, 4).forEach(push);
    }
  }
  return out;
}

/** 句読点/空白/助詞相当の区切りで素朴分解する (依存ゼロの keyword-terms 方式)。 */
export function splitKeywords(text: string): string[] {
  return text
    .split(/[\s、。,.\/・()（）「」\[\]【】]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}
