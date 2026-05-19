#!/usr/bin/env tsx
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FtLoopArgs, HumanFeedbackDoc, RunMeta } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

function parseArgs(argv: string[]): FtLoopArgs {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (key === 'dry-run' || next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  const interviewer = String(args['interviewer'] ?? '');
  const examinee = String(args['examinee'] ?? '');
  if (!interviewer || !examinee) {
    throw new Error('Required: --interviewer <id> --examinee <id>');
  }
  return {
    interviewer,
    examinee,
    turns: Number.parseInt(String(args['turns'] ?? '10'), 10),
    output: String(args['output'] ?? defaultOutputPath()),
    dryRun: Boolean(args['dry-run']),
  };
}

function defaultOutputPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  const id = Math.random().toString(36).slice(2, 10);
  return join(REPO_ROOT, 'data/training/sample-sessions', date, `session-${id}`);
}

async function loadPersona(kind: 'interviewer' | 'examinee', id: string): Promise<string> {
  const path = join(REPO_ROOT, `data/general/persona/${kind}/${id}.md`);
  try {
    await access(path);
  } catch {
    throw new Error(`Persona not found: ${path}`);
  }
  return readFile(path, 'utf8');
}

function emptyHumanFeedback(sessionId: string): HumanFeedbackDoc {
  return {
    session_id: sessionId,
    reviewed_by: null,
    reviewed_at: null,
    summary_blocks: {
      headline:         { action: 'skip' },
      highlights:       { action: 'skip', per_item: [] },
      axes_summary:     { action: 'skip' },
      growth_points:    { action: 'skip', per_item: [] },
      carry_over:       { action: 'skip', per_item: [] },
      interviewer_note: { action: 'skip' },
    },
    ai_critique: { action: 'skip', per_turn: [] },
    notes: '',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('[ft-loop] args:', args);

  // 1. ペルソナ読み込み (md → text、 LLM への持ち回し用に保持)
  const interviewerMd = await loadPersona('interviewer', args.interviewer);
  const examineeMd = await loadPersona('examinee', args.examinee);
  console.log('[ft-loop] personas loaded');

  if (args.dryRun) {
    console.log('[ft-loop] dry-run: persona ファイル読み込みのみ完了');
    return;
  }

  // 2. 出力ディレクトリ準備
  await mkdir(args.output, { recursive: true });

  const meta: RunMeta = {
    interviewer_id: args.interviewer,
    examinee_id: args.examinee,
    turns_requested: args.turns,
    turns_completed: 0,
    models: {
      interviewer: 'claude-sonnet-4-6',
      examinee: 'claude-haiku-4-5-20251001',
      evaluator: 'claude-opus-4-7',
      summarizer: 'claude-opus-4-7',
      critic: 'claude-opus-4-7',
    },
    started_at: new Date().toISOString(),
    ended_at: null,
    status: 'running',
  };
  await writeFile(join(args.output, 'meta.json'), JSON.stringify(meta, null, 2));

  // 3. 会話シミュレーション (TODO: LLM 呼び出し実装)
  // TODO(impl): packages/llm/orchestrator.ts に下記を呼べる API を用意する:
  //   const interviewer = new InterviewerRuntime({ personaMd: interviewerMd })
  //   const examinee    = new ExamineeSimulator({ personaMd: examineeMd })
  //   for t in turns: q = await interviewer.askNext(history); a = await examinee.respond(q, history)
  //   毎 5-7 turn で Opus evaluator.evaluate(history) を回す
  console.log('[ft-loop] TODO: conversation simulation 未実装。 scaffold のみ。');

  // 4. サマリ生成 (TODO)
  // TODO(impl): packages/llm/summarizer.generate(turns, evaluations) -> SummaryDoc
  console.log('[ft-loop] TODO: summary generation 未実装。');

  // 5. AI critique (TODO)
  // TODO(impl): packages/llm/critic.critiqueGrowthPoints(turns, summary) -> AiCritiqueDoc
  console.log('[ft-loop] TODO: AI critique 未実装。');

  // 6. human-feedback.json テンプレを置く
  const sessionId = args.output.split(/[/\\]/).pop() ?? 'unknown';
  await writeFile(
    join(args.output, 'human-feedback.json'),
    JSON.stringify(emptyHumanFeedback(sessionId), null, 2),
  );

  // 7. meta を完了状態に
  meta.ended_at = new Date().toISOString();
  meta.status = 'completed';
  await writeFile(join(args.output, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log(`[ft-loop] scaffold 完了: ${args.output}`);
  console.log('[ft-loop] 次は LLM 呼び出しの実装 (packages/llm/*) を別 PR で。');
}

main().catch((err) => {
  console.error('[ft-loop] error:', err.message);
  process.exit(1);
});
