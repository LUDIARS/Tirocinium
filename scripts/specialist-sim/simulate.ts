// 専門面接を 1 本シミュレーションする。面接官の指示は本番と同じ部品
// (specialistPersona / buildSystemPrompt / 聞きたい要点 / 逆質問ルール) で組み、
// 面接官と受験者の発話を claude CLI で生成する。DB・サーバ・音声経路は使わない。
import { buildSystemPrompt } from '../../packages/llm/src/response.js';
import { examineeSystemPrompt } from '../../packages/llm/src/examinee-simulator.js';
import { SUMMARY_INSTRUCTION } from '../../packages/llm/src/prompts.js';
import type { Phase } from '../../packages/llm/src/phase.js';
import { specialistPersona } from '../../packages/llm/src/specialist-profile.js';
import { specialistEvaluationPrompt } from '../../packages/llm/src/specialist-prompts.js';
import {
  fallbackFocusPoints,
  focusPointsPrompt,
  parseFocusPoints,
  renderFocusBlock,
  type FocusPoints,
} from '../../packages/llm/src/specialist-focus.js';
import type { SimScenario } from './scenarios.js';

export type SimTurn = { turn_no: number; role: 'interviewer' | 'user'; phase: Phase; text: string };

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

function history(turns: SimTurn[]): string {
  return turns.map((t) => `${t.role === 'interviewer' ? '面接官' : '受験者'}: ${t.text}`).join('\n');
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

function interviewerPrompt(sc: SimScenario, focusBlock: string, phase: Phase, turns: SimTurn[], last: boolean): string {
  const system = buildSystemPrompt({
    interviewer: specialistPersona(sc.profile),
    specialist: sc.profile,
    phase,
    ragBlock: `志望企業: ${sc.companyName}\n企業が求める新卒像: ${sc.newgrad.summary}\n\nES:\n${sc.es}`,
    focusBlock,
  });
  const ending = last ? '\nこれが最後の発話です。逆質問に答えたうえで、面接を短く締めてください。' : '';
  return `${system}\n\n## これまでの面接\n${history(turns) || '(まだ発話なし)'}\n\n面接官として、次の発話を 1 つだけ出力してください。発話文のみを出力してください。${ending}`;
}

function examineePrompt(sc: SimScenario, turns: SimTurn[], reverseQuestion: string | null): string {
  const task = reverseQuestion
    ? `面接官の発言に一言応じてから、次の逆質問を自分の言葉で 1 つだけ聞いてください: 「${reverseQuestion}」`
    : '面接官の直前の質問に答えてください。最初の質問なら、次の自己紹介を基に話してください。';
  return `${examineeSystemPrompt(sc.examinee)}\n\n${sc.examinee.bio}\n\n## 自分の ES\n${sc.es}\n\n## これまでの面接\n${history(turns)}\n\n${task}\n受験者の発話文のみを出力してください。`;
}

async function summarize(sc: SimScenario, turns: SimTurn[], ask: Ask): Promise<Record<string, unknown> | null> {
  const transcript = turns.map((t) => `turn ${t.turn_no} ${t.role === 'interviewer' ? '面接官' : '受験者'}: ${t.text}`).join('\n');
  return parseJsonObject(await ask(`${SUMMARY_INSTRUCTION}\n${specialistEvaluationPrompt(sc.profile, true)}\n\n## 面接の全 turn\n${transcript}`));
}

export async function simulate(sc: SimScenario, ask: Ask, log: (msg: string) => void = () => {}): Promise<SimResult> {
  const focus = await prepareFocus(sc, ask);
  log(`focus points: ${focus.source}`);
  const focusBlock = renderFocusBlock(focus.points, sc.profile);
  const turns: SimTurn[] = [];
  let closingCount = 0;
  for (let i = 0; i < INTERVIEWER_SCHEDULE.length; i += 1) {
    const phase = INTERVIEWER_SCHEDULE[i]!;
    const last = i === INTERVIEWER_SCHEDULE.length - 1;
    const said = await ask(interviewerPrompt(sc, focusBlock, phase, turns, last));
    turns.push({ turn_no: turns.length + 1, role: 'interviewer', phase, text: said });
    log(`interviewer ${phase}: ${said.slice(0, 40)}`);
    if (last) break;
    const reverse = phase === 'closing' ? sc.reverseQuestions[closingCount++] ?? null : null;
    const answer = await ask(examineePrompt(sc, turns, reverse));
    turns.push({ turn_no: turns.length + 1, role: 'user', phase, text: answer });
    log(`examinee: ${answer.slice(0, 40)}`);
  }
  const summary = await summarize(sc, turns, ask);
  return { scenario: sc, focusPoints: focus.points, focusSource: focus.source, turns, summary };
}
