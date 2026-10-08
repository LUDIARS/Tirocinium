// 専門面接を 1 本シミュレーションする。面接官の指示は本番と同じ部品
// (specialistPersona / buildSystemPrompt / 聞きたい要点 / 逆質問ルール) で組み、
// 面接官と受験者の発話を claude CLI で生成する。DB・サーバ・音声経路は使わない。
// パネル面接: 現場とシニアの 2 人が質問を受け渡し、聞き役の 1 人は話さない。
import { buildSystemPrompt } from '../../packages/llm/src/response.js';
import { examineeSystemPrompt } from '../../packages/llm/src/examinee-simulator.js';
import { SUMMARY_INSTRUCTION } from '../../packages/llm/src/prompts.js';
import type { Phase } from '../../packages/llm/src/phase.js';
import { specialistPersona, type SpecialistInterviewer } from '../../packages/llm/src/specialist-profile.js';
import { specialistEvaluationPrompt } from '../../packages/llm/src/specialist-prompts.js';
import {
  fallbackFocusPoints,
  focusPointsPrompt,
  parseFocusPoints,
  renderFocusBlock,
  type FocusPoints,
} from '../../packages/llm/src/specialist-focus.js';
import type { PanelInterviewer, SimScenario } from './scenarios.js';

export type SimTurn = {
  turn_no: number;
  role: 'interviewer' | 'user';
  /** 面接官の発話なら話した人の id (scenario.panel)。受験者は 'candidate'。 */
  speaker: string;
  phase: Phase;
  text: string;
};

export type SimResult = {
  scenario: SimScenario;
  focusPoints: FocusPoints;
  focusSource: 'llm' | 'fallback';
  turns: SimTurn[];
  summary: Record<string, unknown> | null;
};

export type Ask = (prompt: string) => Promise<string>;

/** 面接官の発話ごとの進行フェーズ。closing は逆質問の促し → 回答 → 回答して締め。 */
export const INTERVIEWER_SCHEDULE: Phase[] = [
  'opening', 'probe', 'probe', 'probe', 'probe', 'pressure', 'pressure', 'closing', 'closing', 'closing',
];

/**
 * 発話ごとの話し手。議長 (senior) があいさつと締めを持ち、深掘りは職種の担当 (primary) が多めに受け持つ。
 * 逆質問の 1 つ目は現場の話題なので現場が答える。
 */
export function speakerSchedule(primary: SpecialistInterviewer): SpecialistInterviewer[] {
  const other: SpecialistInterviewer = primary === 'senior' ? 'field' : 'senior';
  return ['senior', primary, primary, other, primary, primary, other, 'senior', 'field', 'senior'];
}

const label = (sc: SimScenario, t: SimTurn) => {
  if (t.role === 'user') return '受験者';
  const p = sc.panel.find((x) => x.id === t.speaker);
  return p ? `面接官 ${p.name}` : '面接官';
};

function history(sc: SimScenario, turns: SimTurn[]): string {
  return turns.map((t) => `${label(sc, t)}: ${t.text}`).join('\n');
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function prepareFocus(sc: SimScenario, ask: Ask): Promise<{ points: FocusPoints; source: 'llm' | 'fallback' }> {
  const parsed = parseFocusPoints(await ask(focusPointsPrompt({ profile: sc.profile, newgrad: sc.newgrad, materials: sc.es })));
  return parsed ? { points: parsed, source: 'llm' } : { points: fallbackFocusPoints(sc.profile, sc.newgrad), source: 'fallback' };
}

function panelBlock(sc: SimScenario, me: PanelInterviewer): string {
  const members = sc.panel.map((p) => `${p.name} (${p.title})`).join('、');
  const chair = sc.panel.find((p) => p.interviewer === 'senior');
  return [
    '## パネル面接',
    `同席の面接官: ${members}。あなたは ${me.name} (${me.title})。`,
    `進行役は ${chair?.name ?? '議長'}。冒頭のあいさつと同席者の紹介、最後の締めは進行役だけが行う。`,
    '前の面接官の質問と受験者の回答を踏まえ、自分の担当の観点から続ける。同じ質問を繰り返さない。名乗り直さない。',
  ].join('\n');
}

/** 逆質問の場面での役目。1 回目は促すだけ、2 回目以降は受験者の逆質問に答える (新しい質問はしない)。 */
function closingDuty(closingIndex: number, last: boolean): string {
  if (closingIndex === 0) return '\nいまは逆質問の時間に移るところです。ここまでの受け答えに一言触れてから、受験者に逆質問を促してください。新しい質問はしない。';
  const close = last ? '答えたうえで、面接を短く締めてください。' : '答えたら、ほかに質問があるか受験者に尋ねてください。';
  return `\n直前の受験者の逆質問に、面接官として具体的に答えてください。新しい質問や確認はしない。${close}`;
}

function interviewerPrompt(sc: SimScenario, focus: FocusPoints, me: PanelInterviewer, phase: Phase, turns: SimTurn[], last: boolean, closingIndex: number): string {
  const profile = { ...sc.profile, interviewer: me.interviewer ?? sc.profile.interviewer };
  const persona = { ...specialistPersona(profile), display_name: me.name };
  const system = buildSystemPrompt({
    interviewer: persona,
    specialist: profile,
    phase,
    ragBlock: `志望企業: ${sc.companyName}\n企業が求める新卒像: ${sc.newgrad.summary}\n\nES:\n${sc.es}`,
    focusBlock: renderFocusBlock(focus, profile),
  });
  const ending = phase === 'closing' ? closingDuty(closingIndex, last) : '';
  return `${system}\n\n${panelBlock(sc, me)}\n\n## これまでの面接\n${history(sc, turns) || '(まだ発話なし)'}\n\n面接官 ${me.name} として、次の発話を 1 つだけ出力してください。発話文のみを出力してください (名前の見出しは付けない)。${ending}`;
}

function examineePrompt(sc: SimScenario, turns: SimTurn[], reverseQuestion: string | null): string {
  const task = reverseQuestion
    ? `面接官の発言に一言応じてから、次の逆質問を自分の言葉で 1 つだけ聞いてください: 「${reverseQuestion}」`
    : '面接官の直前の質問に答えてください。最初の質問なら、次の自己紹介を基に話してください。';
  return `${examineeSystemPrompt(sc.examinee)}\n\n${sc.examinee.bio}\n\n## 自分の ES\n${sc.es}\n\n## これまでの面接\n${history(sc, turns)}\n\n${task}\n受験者の発話文のみを出力してください。`;
}

async function summarize(sc: SimScenario, turns: SimTurn[], ask: Ask): Promise<Record<string, unknown> | null> {
  const transcript = turns.map((t) => `turn ${t.turn_no} ${label(sc, t)}: ${t.text}`).join('\n');
  return parseJsonObject(await ask(`${SUMMARY_INSTRUCTION}\n${specialistEvaluationPrompt(sc.profile, true)}\n\n## 面接の全 turn\n${transcript}`));
}

function memberFor(sc: SimScenario, who: SpecialistInterviewer): PanelInterviewer {
  const m = sc.panel.find((p) => p.interviewer === who);
  if (!m) throw new Error(`panel has no ${who} interviewer`);
  return m;
}

export async function simulate(sc: SimScenario, ask: Ask, log: (msg: string) => void = () => {}): Promise<SimResult> {
  const focus = await prepareFocus(sc, ask);
  log(`focus points: ${focus.source}`);
  const speakers = speakerSchedule(sc.profile.interviewer);
  const turns: SimTurn[] = [];
  let closingCount = 0;
  let closingIndex = 0;
  for (let i = 0; i < INTERVIEWER_SCHEDULE.length; i += 1) {
    const phase = INTERVIEWER_SCHEDULE[i]!;
    const last = i === INTERVIEWER_SCHEDULE.length - 1;
    const me = memberFor(sc, speakers[i]!);
    const said = await ask(interviewerPrompt(sc, focus.points, me, phase, turns, last, closingIndex));
    if (phase === 'closing') closingIndex += 1;
    turns.push({ turn_no: turns.length + 1, role: 'interviewer', speaker: me.id, phase, text: said });
    log(`${me.name} ${phase}: ${said.slice(0, 40)}`);
    if (last) break;
    const reverse = phase === 'closing' ? sc.reverseQuestions[closingCount++] ?? null : null;
    const answer = await ask(examineePrompt(sc, turns, reverse));
    turns.push({ turn_no: turns.length + 1, role: 'user', speaker: 'candidate', phase, text: answer });
    log(`examinee: ${answer.slice(0, 40)}`);
  }
  const summary = await summarize(sc, turns, ask);
  return { scenario: sc, focusPoints: focus.points, focusSource: focus.source, turns, summary };
}
