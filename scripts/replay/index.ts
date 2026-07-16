#!/usr/bin/env tsx
// リプレイ CLI (spec/feature/inference/interviewer-reproduction.md §7 表 8)。
// 過去セッションのブリーフ + seed から質問プランを決定的に再構築し、
// StubBrain で一巡再生する。--judge で記録済み Q&A の判定を差し替え比較 (A/B) する。
//
//   npx tsx scripts/replay -- --session <uuid>
//   npx tsx scripts/replay -- --session <uuid> --judge llm     # stub vs llm の A/B
//   npx tsx scripts/replay -- --session <uuid> --db data/tirocinium.sqlite --out replay.md
//
// 出力は markdown (stdout、--out でファイルにも)。

import { writeFile } from 'node:fs/promises';
import {
  AXIS_KEYS,
  LlmBrain,
  StubBrain,
  compileQuestionPlan,
  initialPhaseState,
  mulberry32,
  nextPhase,
  nextSlot,
  type AxisKey,
  type InterviewerBrain,
  type PhaseState,
  type Turn,
} from '@tirocinium/llm';
import { config } from '../../apps/server/src/config.js';
import { initSql, sql } from '../../apps/server/src/db/index.js';
import { getBrief } from '../../apps/server/src/brief/repo.js';
import { planBriefFromSourceMeta } from '../../apps/server/src/brief/brief-builder.js';
import { judgeFeatures } from '../../apps/server/src/judge-blackbox/features.js';

type Args = { session: string; judge: 'none' | 'stub' | 'llm'; db: string | null; out: string | null };

function parseArgs(argv: string[]): Args {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (!k.startsWith('--')) continue;
    a[k.slice(2)] = argv[i + 1] ?? '';
    i++;
  }
  if (!a['session']) {
    console.error('usage: replay --session <uuid> [--judge stub|llm] [--db <url>] [--out <md>]');
    process.exit(1);
  }
  const judge = (a['judge'] ?? 'none') as Args['judge'];
  if (!['none', 'stub', 'llm'].includes(judge)) {
    console.error(`--judge が不正: ${judge} (stub | llm)`);
    process.exit(1);
  }
  return { session: a['session'], judge, db: a['db'] ?? null, out: a['out'] ?? null };
}

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const t of iter) out += t;
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.db) config.databaseUrl = args.db;
  initSql();

  const stored = await getBrief(args.session);
  if (!stored) {
    console.error(`[fatal] session ${args.session} に interview_briefs が無い (P2 プラン面接のみ再生可)`);
    process.exit(1);
  }
  const planBrief = planBriefFromSourceMeta(stored.source_meta);
  if (!planBrief) {
    console.error('[fatal] source_meta に候補 snapshot (candidates) が無い');
    process.exit(1);
  }
  const weakTop3 = (
    Array.isArray(stored.source_meta['weak_top3'])
      ? (stored.source_meta['weak_top3'] as unknown[]).filter((a): a is string => typeof a === 'string')
      : []
  ).filter((a): a is AxisKey => (AXIS_KEYS as string[]).includes(a));

  // 決定的再構築: 同 seed + 同候補 + 同弱点 = 同プラン (§4)
  const plan = compileQuestionPlan(planBrief, weakTop3, mulberry32(stored.seed));

  const lines: string[] = [];
  lines.push(`# リプレイ: session ${args.session}`);
  lines.push('');
  lines.push(`- seed: ${stored.seed} / 企業: ${planBrief.companyName ?? '(なし)'} / stage: ${planBrief.stage} / 弱点: ${weakTop3.join(', ') || '(なし)'}`);
  lines.push(`- 充足: ${String(stored.source_meta['sufficiency'] ?? '?')} — ${String(stored.source_meta['sufficiency_reason'] ?? '')}`);
  lines.push('');
  lines.push('## 質問プラン (決定的再構築)');
  lines.push('');
  lines.push('| # | phase | origin | theme | question |');
  lines.push('|---|-------|--------|-------|----------|');
  plan.forEach((s, i) => {
    lines.push(`| ${i + 1} | ${s.phase} | ${s.origin} | ${s.theme} | ${s.question} |`);
  });

  // StubBrain 一巡再生 (golden transcript と同じ決定的ウォーク)
  const stub = new StubBrain();
  const cursor: Record<string, number> = {};
  let state: PhaseState = initialPhaseState(4);
  lines.push('');
  lines.push('## StubBrain 一巡再生');
  lines.push('');
  let guard = 0;
  while (state.phase !== 'ended' && guard++ < 40) {
    const slot = nextSlot(plan, state.phase, cursor);
    const utterance = await collect(stub.composeUtterance({ systemPrompt: '', turns: [], slot }));
    if (slot) cursor[state.phase] = (cursor[state.phase] ?? 0) + 1;
    lines.push(`- [${state.phase}] ${utterance}`);
    const signals = await stub.assessAnswer({ question: utterance, answer: '(再生用回答)' });
    state = nextPhase(state, {
      synthesisReached: signals.synthesisReached,
      contradictionOpen: signals.contradictionOpen,
    });
  }

  // 記録済み turn との突合 + judge A/B
  const turns = await sql<{ turn_no: number; role: 'interviewer' | 'user'; stt_text: string | null; text_uri: string }[]>`
    SELECT turn_no, role, stt_text, text_uri FROM session_turns
    WHERE session_id = ${args.session} ORDER BY turn_no ASC
  `;
  if (turns.length > 0) {
    lines.push('');
    lines.push(`## 記録済みトランスクリプト (${turns.length} turns)`);
    lines.push('');
    for (const t of turns) {
      const text = (t.stt_text ?? t.text_uri).replace(/\n/g, ' ');
      lines.push(`- [${t.turn_no}] ${t.role === 'interviewer' ? '面接官' : '受験者'}: ${text}`);
    }

    if (args.judge !== 'none') {
      const brains: [string, InterviewerBrain][] = [['stub', new StubBrain()]];
      if (args.judge === 'llm') {
        const llm = new LlmBrain({ llmBackend: 'api' });
        if (!llm.canAssess()) {
          console.error('[fatal] --judge llm には ANTHROPIC_API_KEY が必要');
          process.exit(1);
        }
        brains.push(['llm', llm]);
      }
      lines.push('');
      lines.push(`## judge 差し替え比較 (${brains.map(([n]) => n).join(' vs ')})`);
      lines.push('');
      lines.push(`| Q turn | A turn | ${brains.map(([n]) => `${n}: syn/contra/spec`).join(' | ')} | answer_len |`);
      lines.push(`|--------|--------|${brains.map(() => '---').join('|')}|---|`);

      const asTurn = (t: (typeof turns)[number]): Turn => ({
        turn_no: t.turn_no,
        role: t.role,
        text: t.stt_text ?? t.text_uri,
      });
      for (let i = 0; i + 1 < turns.length; i++) {
        const q = turns[i]!;
        const a = turns[i + 1]!;
        if (q.role !== 'interviewer' || a.role !== 'user') continue;
        const question = q.stt_text ?? q.text_uri;
        const answer = a.stt_text ?? a.text_uri;
        const cells: string[] = [];
        for (const [, brain] of brains) {
          const s = await brain.assessAnswer({
            question,
            answer,
            recent: turns.slice(Math.max(0, i - 2), i + 2).map(asTurn),
          });
          cells.push(`${s.synthesisReached ? '✓' : '—'}/${s.contradictionOpen ? '✓' : '—'}/${s.specificity}`);
        }
        const feats = judgeFeatures(question, answer);
        lines.push(`| ${q.turn_no} | ${a.turn_no} | ${cells.join(' | ')} | ${String(feats['answer_len'])} |`);
      }
    }
  } else {
    lines.push('');
    lines.push('(記録済み turn なし — プラン再構築と StubBrain 再生のみ)');
  }

  const md = lines.join('\n');
  console.log(md);
  if (args.out) {
    await writeFile(args.out, md, 'utf8');
    console.error(`\n[out] ${args.out}`);
  }
  await sql.end();
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
