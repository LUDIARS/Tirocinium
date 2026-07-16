// judge の卒業 — @ludiars/blackbox で判例を蓄積し、規則化した判定は LLM をショートサーキットする。
// spec/feature/inference/interviewer-reproduction.md §7.1 (Pagus fate-blackbox 方式)。
//
// - 永続化は専用 sidecar SQLite (data/judge-blackbox.sqlite)。本体 DB が Postgres でも動く。
// - domain = 'judge-signals'。出力は構造化 3 値のみ (followupHint は自由文なので LLM 経路のみ)。
// - seed ルールは candidate で投入 — 発火せず影評価で LLM (教師) との一致を蓄積し、
//   閾値到達で trial へ自動昇格 → 人間 OK (scripts/judge-blackbox CLI) で auto = 卒業。

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as NodeSqlite from 'node:sqlite';
import {
  makeSqliteBlackBox,
  type BlackBox,
  type RuleDraft,
} from '@ludiars/blackbox';
import type { AnswerSignals } from '@tirocinium/llm';
import { judgeFeatures } from './features.js';

// sqlite-driver.ts と同じ理由 (vitest が experimental builtin を transform できない) で
// node:sqlite は createRequire で runtime 解決する。
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof NodeSqlite;

const _dir = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(_dir, '../../../..');
const DEFAULT_DB_PATH = resolve(PROJECT_ROOT, 'data', 'judge-blackbox.sqlite');

export const JUDGE_DOMAIN = 'judge-signals';

/** blackbox が扱う構造化出力 (followupHint は含めない — 自由文は規則化できない)。 */
export type JudgeOutput = {
  specificity: number;
  synthesis_reached: boolean;
  contradiction_open: boolean;
};

export function toJudgeOutput(s: AnswerSignals): JudgeOutput {
  return {
    specificity: s.specificity,
    synthesis_reached: s.synthesisReached,
    contradiction_open: s.contradictionOpen,
  };
}

/** seed ルール (spec §7.1 の例をそのまま初期判例に)。candidate なので発火せず影評価で育つ。 */
const SEED_RULES: Omit<RuleDraft, 'domain'>[] = [
  {
    description: '極端に短い回答 (40 字未満・具体化マーカーなし) は synthesis 不成立',
    when: {
      op: 'and',
      clauses: [
        { op: 'cmp', feature: 'answer_len', cmp: '<', value: 40 },
        { op: 'cmp', feature: 'has_concrete_marker', cmp: '==', value: false },
      ],
    },
    output: { specificity: 0, synthesis_reached: false, contradiction_open: true } satisfies JudgeOutput,
    confidence: 0.6,
    state: 'candidate',
    source: 'seed',
  },
  {
    description: '長い回答 + 数字 + 具体化マーカーは高い具体性',
    when: {
      op: 'and',
      clauses: [
        { op: 'cmp', feature: 'answer_len', cmp: '>=', value: 200 },
        { op: 'cmp', feature: 'has_digits', cmp: '==', value: true },
        { op: 'cmp', feature: 'has_concrete_marker', cmp: '==', value: true },
      ],
    },
    output: { specificity: 3, synthesis_reached: true, contradiction_open: false } satisfies JudgeOutput,
    confidence: 0.6,
    state: 'candidate',
    source: 'seed',
  },
];

export function judgeBlackboxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env['TIROCINIUM_JUDGE_BLACKBOX'] ?? '0';
  if (raw !== '0' && raw !== '1') {
    throw new Error(`TIROCINIUM_JUDGE_BLACKBOX が不正: "${raw}" (0 | 1 のみ)`);
  }
  return raw === '1';
}

/** seed ルールを未登録なら投入する (description で冪等)。 */
export function seedJudgeRules(bb: BlackBox): number {
  const existing = new Set(bb.rules.listByDomain(JUDGE_DOMAIN).map((r) => r.description));
  let added = 0;
  for (const draft of SEED_RULES) {
    if (existing.has(draft.description)) continue;
    bb.rules.insert({ ...draft, domain: JUDGE_DOMAIN });
    added += 1;
  }
  return added;
}

let _singleton: BlackBox | null = null;

/** sidecar SQLite で judge blackbox を開く (プロセス内 singleton)。 */
export function getJudgeBlackbox(dbPath: string = DEFAULT_DB_PATH): BlackBox {
  if (_singleton) return _singleton;
  const db = new DatabaseSync(dbPath);
  const bb = makeSqliteBlackBox(db, { reviewLlmDecisions: false });
  seedJudgeRules(bb);
  _singleton = bb;
  return _singleton;
}

export type JudgeDecision = {
  signals: AnswerSignals;
  source: 'rule' | 'llm';
  decisionId: number;
};

/**
 * blackbox 経由の judge 判定。live ルール (trial/auto) が hit すれば LLM を呼ばない。
 * LLM 経路では followupHint も返す (規則経路には無い — 構造外)。
 */
export async function decideJudgeSignals(
  bb: BlackBox,
  question: string,
  answer: string,
  llmAssess: () => Promise<AnswerSignals>,
): Promise<JudgeDecision> {
  let hint: string | undefined;
  const { decision, decisionId } = await bb.engine.decide<
    { question: string; answer: string },
    JudgeOutput
  >(JUDGE_DOMAIN, { question, answer }, judgeFeatures(question, answer), async () => {
    const s = await llmAssess();
    hint = s.followupHint;
    return { output: toJudgeOutput(s), confidence: 0.7, rationale: 'llm judge (assessAnswer)' };
  });
  return {
    signals: {
      specificity: decision.output.specificity,
      synthesisReached: decision.output.synthesis_reached,
      contradictionOpen: decision.output.contradiction_open,
      followupHint: decision.source === 'llm' ? hint : undefined,
    },
    source: decision.source,
    decisionId,
  };
}
