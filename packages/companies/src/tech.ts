// 技術スタックの正規化と傾向分類。 純粋関数 (LLM 不使用)。
// 生のタグ/採用ページ抽出語 → 正準 tech トークン (engine/language/dcc/cloud) + グラフィック傾向。
// spec/companies/game-graph.md (tech レイヤー)。

export type TechCategory = 'engine' | 'language' | 'dcc' | 'cloud' | 'style' | 'other';

export type TechToken = { name: string; category: TechCategory };

// 正準化テーブル: [マッチ正規表現, 正準名, カテゴリ]。 上から順に最初の一致を採る。
const TECH_RULES: [RegExp, string, TechCategory][] = [
  // engine
  [/unreal|\bue\s?[45]\b|ue4|ue5/i, 'Unreal Engine', 'engine'],
  [/\bunity\b/i, 'Unity', 'engine'],
  [/cocos/i, 'Cocos', 'engine'],
  [/godot/i, 'Godot', 'engine'],
  [/自社エンジン|独自エンジン|internal engine|proprietary engine/i, '自社エンジン', 'engine'],
  // language
  [/\bc\+\+|\bc\/c\+\+|cpp/i, 'C++', 'language'],
  [/c#|ｃ＃|c\s?sharp/i, 'C#', 'language'],
  [/typescript|\bts\b/i, 'TypeScript', 'language'],
  [/javascript|\bjs\b|node\.?js/i, 'JavaScript', 'language'],
  [/python/i, 'Python', 'language'],
  [/\bgo(lang)?\b/i, 'Go', 'language'],
  [/\bphp\b/i, 'PHP', 'language'],
  [/\brust\b/i, 'Rust', 'language'],
  [/\bkotlin\b/i, 'Kotlin', 'language'],
  [/\bswift\b/i, 'Swift', 'language'],
  [/\bjava\b/i, 'Java', 'language'],
  // dcc / art tools
  [/\bmaya\b/i, 'Maya', 'dcc'],
  [/blender/i, 'Blender', 'dcc'],
  [/houdini/i, 'Houdini', 'dcc'],
  [/substance/i, 'Substance', 'dcc'],
  [/zbrush/i, 'ZBrush', 'dcc'],
  [/photoshop|\bps\b/i, 'Photoshop', 'dcc'],
  [/3ds\s?max|3dsmax/i, '3ds Max', 'dcc'],
  [/spine/i, 'Spine', 'dcc'],
  [/live2d/i, 'Live2D', 'dcc'],
  // cloud / infra
  [/\baws\b|amazon web/i, 'AWS', 'cloud'],
  [/\bgcp\b|google cloud/i, 'GCP', 'cloud'],
  [/azure/i, 'Azure', 'cloud'],
  [/kubernetes|\bk8s\b/i, 'Kubernetes', 'cloud'],
  [/docker/i, 'Docker', 'cloud'],
];

/** dedup キー (lower + 記号除去)。 */
export function normalizeTechName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[\s　.・/\\()（）]/g, '').trim();
}

/** 生トークン 1 個を正準 tech に寄せる。 既知パターンに当たらなければ null (ノイズ除外)。 */
export function normalizeTechToken(raw: string): TechToken | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  for (const [re, name, category] of TECH_RULES) {
    if (re.test(t)) return { name, category };
  }
  return null;
}

/** タグ列 / tech_stack 列 → 正準 tech トークン (重複排除)。 */
export function parseTechStack(values: (string | undefined)[]): TechToken[] {
  const seen = new Set<string>();
  const out: TechToken[] = [];
  for (const v of values) {
    const tok = normalizeTechToken(v ?? '');
    if (!tok) continue;
    const key = normalizeTechName(tok.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tok);
  }
  return out;
}

const CASUAL_GENRE = /パズル|カジュアル|ハイパーカジュアル|放置|クリッカー|マージ|casual|puzzle|hyper.?casual/i;
const HIGH_GENRE = /アクション|rpg|オープンワールド|fps|tps|格闘|アドベンチャー|action|open.?world|fighting/i;

/**
 * グラフィック傾向 (ハイグラ↔カジュアル) を engine × 機種 × ジャンルから導出する。
 * - Unreal / コンシューマ / ハイグラ系ジャンル → 'high' (ハイグラ寄り)
 * - Unity + モバイル + カジュアル系ジャンル → 'casual'
 * - 判定材料が弱ければ '' (不明)。
 */
export function deriveGraphicsStyle(
  engines: string[],
  platformClasses: string[],
  genres: string[],
): '' | 'high' | 'casual' {
  const eng = engines.join(' ').toLowerCase();
  const plats = platformClasses.join(' ').toLowerCase();
  const genre = genres.join(' ');
  let high = 0;
  let casual = 0;
  if (/unreal/.test(eng)) high += 2;
  if (/自社エンジン/.test(eng)) high += 1;
  if (plats.includes('console')) high += 1;
  if (HIGH_GENRE.test(genre)) high += 1;
  if (plats.includes('mobile')) casual += 1;
  if (CASUAL_GENRE.test(genre)) casual += 2;
  if (/unity/.test(eng) && plats.includes('mobile') && !/unreal/.test(eng)) casual += 1;
  if (high === 0 && casual === 0) return '';
  return high >= casual ? 'high' : 'casual';
}

export const GRAPHICS_STYLE_LABEL: Record<'high' | 'casual', string> = {
  high: 'ハイグラ',
  casual: 'カジュアル',
};
