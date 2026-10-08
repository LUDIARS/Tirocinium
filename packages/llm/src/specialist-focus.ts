// 専門面接の「聞きたい要点」(シニア / 現場)。spec/feature/inference/specialist-interviews.md
// ES (受験者の素材) と企業が求める新卒像から、面接官が事前に持つ確認項目を作る。
// 要点は受験者本人の ES に由来するため、呼び出し側は in-memory のみで扱い永続化しない。
import {
  SPECIALIST_INTERVIEWERS,
  SPECIALIST_ROLES,
  type SpecialistInterviewer,
  type SpecialistProfile,
} from './specialist-profile.js';

export type FocusPoints = Record<SpecialistInterviewer, string[]>;

export type NewgradFocusInput = { summary: string; themes: string[] };

export type FocusPromptInput = {
  profile: SpecialistProfile;
  newgrad: NewgradFocusInput | null;
  /** Memoria RAG 抜粋 (ES / ポートフォリオ / 自己紹介)。無ければ空。 */
  materials: string;
};

const MAX_POINTS = 6;
const MAX_POINT_CHARS = 160;

/** 立場ごとの既定の観点。ES / 新卒像が無いときもこの観点で面接できる。 */
const BASE_VIEWS: FocusPoints = {
  senior: [
    '判断の根拠とトレードオフ: 取り組みの中で何を選び、何を捨てたか',
    '品質と保守: 他人が触る・後から直す前提でどう作ったか',
    '学び方と伸びしろ: 新しい技術や手法をどう身につけ、どう確かめたか',
    'チームでの役割: 意見が割れたときの合意の作り方と自分の責任範囲',
  ],
  field: [
    '担当範囲: 自分の手で作った部分と、他人・既存資産に頼った部分の切り分け',
    '道具と工程: 使ったエンジン・ツール・ワークフローと、それを選んだ理由',
    '詰まった問題: 不具合や品質問題をどう再現し、どう切り分けて直したか',
    '具体的な数字: 処理時間・容量・工数・件数など、結果を測った値',
  ],
};

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > MAX_POINT_CHARS ? `${t.slice(0, MAX_POINT_CHARS - 1)}…` : t;
}

/** LLM を使わない決定的な要点。新卒像のテーマはシニア側の確認項目として足す。 */
export function fallbackFocusPoints(profile: SpecialistProfile, newgrad: NewgradFocusInput | null): FocusPoints {
  const role = SPECIALIST_ROLES[profile.role];
  const themes = (newgrad?.themes ?? []).map((t) => t.trim()).filter(Boolean);
  return {
    senior: [
      ...BASE_VIEWS.senior,
      ...themes.map((t) => `新卒像「${t}」: 自分の経験のどこにそれが表れているか`),
    ].slice(0, MAX_POINTS).map(clip),
    field: [
      ...BASE_VIEWS.field,
      `${role.label}の専門領域: ${role.topics} のうち、実際に経験したもの`,
    ].slice(0, MAX_POINTS).map(clip),
  };
}

/** 要点生成用の 1 回きりのプロンプト。出力は JSON のみを求める。 */
export function focusPointsPrompt(input: FocusPromptInput): string {
  const role = SPECIALIST_ROLES[input.profile.role];
  const newgrad = input.newgrad
    ? `${input.newgrad.summary}\nテーマ: ${input.newgrad.themes.join(' / ') || '(なし)'}`
    : '(企業固有データなし)';
  return `あなたはゲーム会社の技術面接の準備をしている。受験者の素材と、企業が求める新卒像から、
シニア (テックリード) と現場エンジニアがそれぞれ面接で確かめたい要点を書き出す。

## 職種と経験
職種: ${role.label}
経験: ${input.profile.level === 'entry' ? '学生・未経験 (自主制作・学習を含めて扱う)' : '実務経験者'}
出題領域: ${role.topics}
専門観点: ${role.criteria}

## 企業が求める新卒像
${newgrad}

## 受験者の素材 (ES など)
${input.materials.trim() || '(素材なし)'}

## 書き方
- senior: 判断の根拠、トレードオフ、品質と保守、学び方と伸びしろ、チームへの効き方、新卒像との接続を見る。
- field: 実際に手を動かした範囲、道具と工程、詰まった問題の切り分け、具体的な数字、一緒に働く場面を見る。
- 各 ${MAX_POINTS} 個以内。1 項目は「観点: ES のどの記述 / 新卒像のどのテーマについて何を確かめるか」の 1 文。
- 素材に無い経験や数字を事実として作らない。素材が薄い所は「〜を確認する」と書く。
- 出力は次の JSON のみ: {"senior": ["..."], "field": ["..."]}`;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, MAX_POINTS)
    .map(clip);
}

/** LLM 出力から要点を取り出す。形が崩れていれば null (呼び出し側が既定の要点へ戻す)。 */
export function parseFocusPoints(text: string): FocusPoints | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const senior = stringList(obj['senior']);
  const field = stringList(obj['field']);
  if (!senior.length || !field.length) return null;
  return { senior, field };
}

/** system prompt へ載せる準備メモ。今回の面接官の要点を先に置く。 */
export function renderFocusBlock(points: FocusPoints, profile: SpecialistProfile): string {
  const primary = profile.interviewer;
  const secondary: SpecialistInterviewer = primary === 'senior' ? 'field' : 'senior';
  const list = (who: SpecialistInterviewer) =>
    `### ${SPECIALIST_INTERVIEWERS[who].label}が聞きたい要点\n${points[who].map((p) => `- ${p}`).join('\n')}`;
  return [
    '## 聞きたい要点 (面接官の準備メモ。読み上げない)',
    `今回の面接官は${SPECIALIST_INTERVIEWERS[primary].label}。その要点を質問の中心にし、ES の記述に当てて一つずつ確かめる。`,
    `${SPECIALIST_INTERVIEWERS[secondary].label}の要点は別の段階で扱う想定。今回は時間が余れば一つだけ扱う。`,
    list(primary),
    list(secondary),
  ].join('\n');
}
