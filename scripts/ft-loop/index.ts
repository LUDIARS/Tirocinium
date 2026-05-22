#!/usr/bin/env tsx
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import matter from 'gray-matter';
import {
  buildSystemPrompt,
  createAnthropicClient,
  createOpenAIClient,
  critique,
  evaluate,
  examineeSystemPrompt,
  refine,
  serializeHistory,
  summarize,
  type ExamineePersonaInput,
  type InterviewerPersonaInput,
  type Turn,
} from '@tirocinium/llm';
import { runClaudeCli } from './claude-cli.js';
import type {
  AiCritiqueDoc,
  EvaluationRecord,
  FtLoopArgs,
  HumanFeedbackDoc,
  RunMeta,
  SummaryDoc,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');

const EVAL_EVERY_N_TURNS = 5;
const REFINE_EVERY_N_TURNS = 10;

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

async function loadPersonaFrontmatter<T>(kind: 'interviewer' | 'examinee', id: string): Promise<T> {
  const path = join(REPO_ROOT, `data/general/persona/${kind}/${id}.md`);
  try {
    await access(path);
  } catch {
    throw new Error(`Persona not found: ${path}`);
  }
  const text = await readFile(path, 'utf8');
  return matter(text).data as T;
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

/** 面接の口火 (cold-open)。 stage によって質問を変える */
function coldOpenForStage(stage: string): string {
  switch (stage) {
    case 'hr':
      return 'まず、 自己紹介を 1 分くらいでお願いします。';
    case 'peer-tech':
      return '直近のプロジェクトで担当した範囲を教えてください。';
    case 'lead-tech':
      return '3-5 年単位で見た仕事の全体像を、 3-4 分で聞かせてください。';
    case 'final':
      return 'あなたの人生の中で、 ゲームはどんな位置付けですか。';
    default:
      return 'まず、 自己紹介をお願いします。';
  }
}

/** jsonl 書き出し helper */
async function writeJsonl(path: string, items: unknown[]): Promise<void> {
  const body = items.map((x) => JSON.stringify(x)).join('\n') + '\n';
  await writeFile(path, body);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('[ft-loop] args:', args);

  const interviewerFm = await loadPersonaFrontmatter<InterviewerPersonaInput & { id: string }>(
    'interviewer',
    args.interviewer,
  );
  const examineeFm = await loadPersonaFrontmatter<ExamineePersonaInput & { id: string }>(
    'examinee',
    args.examinee,
  );
  console.log('[ft-loop] personas loaded');

  if (args.dryRun) {
    console.log('[ft-loop] dry-run: persona フロントマター読み込みのみ完了');
    return;
  }

  if (!process.env['ANTHROPIC_API_KEY']) {
    throw new Error('ANTHROPIC_API_KEY required for ft-loop run');
  }
  const refineEnabled = Boolean(process.env['OPENAI_API_KEY']);

  await mkdir(args.output, { recursive: true });
  const sessionId = args.output.split(/[/\\]/).pop() ?? 'unknown';

  const meta: RunMeta = {
    interviewer_id: args.interviewer,
    examinee_id: args.examinee,
    turns_requested: args.turns,
    turns_completed: 0,
    models: {
      interviewer: 'claude-cli (sonnet)',
      examinee: 'claude-cli (haiku)',
      evaluator: 'claude-opus-4-7',
      summarizer: 'claude-opus-4-7',
      critic: 'claude-opus-4-7',
    },
    started_at: new Date().toISOString(),
    ended_at: null,
    status: 'running',
  };
  await writeFile(join(args.output, 'meta.json'), JSON.stringify(meta, null, 2));

  const anthropic = createAnthropicClient();
  const openai = refineEnabled ? createOpenAIClient() : null;

  const turns: Turn[] = [];
  const evaluations: EvaluationRecord[] = [];
  let refineBlock = '';
  let turnNo = 0;

  // 1. cold-open: interviewer が最初の質問を投げる
  turnNo += 1;
  const opener: Turn = {
    turn_no: turnNo,
    role: 'interviewer',
    text: coldOpenForStage(interviewerFm.stage),
    ts: new Date().toISOString(),
  };
  turns.push(opener);
  console.log(`[ft-loop] turn ${turnNo} (interviewer cold-open): ${opener.text}`);

  // 2. 交互に turn を回す
  while (turnNo < args.turns) {
    // examinee 応答 (Claude Code CLI 経由)
    const examineePrompt = [
      examineeSystemPrompt(examineeFm),
      '',
      '## これまでの面接',
      serializeHistory(turns),
      '',
      '## 面接官の最新質問',
      turns[turns.length - 1]!.text,
      '',
      '上記の質問に、 ペルソナの癖を反映した形で答えてください。 回答文のみを出力してください。',
    ].join('\n');
    const examineeText = await runClaudeCli(examineePrompt, 'haiku');
    turnNo += 1;
    const u: Turn = {
      turn_no: turnNo,
      role: 'user',
      text: examineeText,
      ts: new Date().toISOString(),
    };
    turns.push(u);
    console.log(`[ft-loop] turn ${turnNo} (examinee): ${examineeText.slice(0, 60)}…`);

    if (turnNo >= args.turns) break;

    // interviewer 応答 (Claude Code CLI 経由)
    const systemPrompt = buildSystemPrompt({
      interviewer: interviewerFm,
      refineBlock: refineBlock || undefined,
    });
    const interviewerPrompt = [
      systemPrompt,
      '',
      '## これまでの面接',
      serializeHistory(turns),
      '',
      '面接官として、 次の発話 (質問) を 1 つだけ出力してください。 発話文のみを出力してください。',
    ].join('\n');
    const interviewerText = await runClaudeCli(interviewerPrompt, 'sonnet');
    turnNo += 1;
    const i: Turn = {
      turn_no: turnNo,
      role: 'interviewer',
      text: interviewerText,
      ts: new Date().toISOString(),
    };
    turns.push(i);
    console.log(`[ft-loop] turn ${turnNo} (interviewer): ${interviewerText.slice(0, 60)}…`);

    // 5 turn ごとに評価
    if (turnNo % EVAL_EVERY_N_TURNS === 0) {
      const window = Math.max(0, turnNo - EVAL_EVERY_N_TURNS);
      const slice = turns.filter((t) => t.turn_no > window && t.turn_no <= turnNo);
      try {
        const ev = await evaluate(anthropic, { turns: slice, turnRange: [window + 1, turnNo] });
        evaluations.push({ ...ev });
        console.log(`[ft-loop] eval @${turnNo}: comment="${ev.comment.slice(0, 40)}…"`);
      } catch (err) {
        console.warn('[ft-loop] eval failed', (err as Error).message);
      }
    }

    // 10 turn ごとに refine
    if (refineEnabled && openai && turnNo % REFINE_EVERY_N_TURNS === 0) {
      try {
        const block = await refine(openai, { turns });
        if (block) {
          refineBlock = block;
          console.log(`[ft-loop] refine @${turnNo}: ${block.slice(0, 60)}…`);
        }
      } catch (err) {
        console.warn('[ft-loop] refine failed', (err as Error).message);
      }
    }
  }

  meta.turns_completed = turnNo;

  // 3. 永続化: conversation.jsonl + opus-evaluations.jsonl
  await writeJsonl(join(args.output, 'conversation.jsonl'), turns);
  await writeJsonl(join(args.output, 'opus-evaluations.jsonl'), evaluations);

  // 4. summary 生成
  let summaryDoc: SummaryDoc | null = null;
  try {
    summaryDoc = (await summarize(anthropic, {
      turns,
      evaluations: evaluations.map((e) => ({ ...e })),
    })) as SummaryDoc;
    await writeFile(
      join(args.output, 'summary.md'),
      renderSummaryMarkdown(sessionId, summaryDoc, args, meta),
    );
    console.log('[ft-loop] summary generated');
  } catch (err) {
    console.warn('[ft-loop] summary failed', (err as Error).message);
  }

  // 5. AI critique (growth_points に紐づく user turn を focus)
  if (summaryDoc) {
    try {
      const focusTurnNos = pickFocusTurns(turns, summaryDoc);
      const cri = (await critique(anthropic, { turns, focusTurnNos })) as AiCritiqueDoc;
      await writeFile(
        join(args.output, 'ai-critique.md'),
        renderCritiqueMarkdown(sessionId, cri),
      );
      console.log(`[ft-loop] critique generated (${cri.per_turn.length} turns)`);
    } catch (err) {
      console.warn('[ft-loop] critique failed', (err as Error).message);
    }
  }

  // 6. human-feedback.json テンプレ
  await writeFile(
    join(args.output, 'human-feedback.json'),
    JSON.stringify(emptyHumanFeedback(sessionId), null, 2),
  );

  // 7. meta を completed に
  meta.ended_at = new Date().toISOString();
  meta.status = 'completed';
  await writeFile(join(args.output, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log(`[ft-loop] done. output=${args.output}`);
}

function pickFocusTurns(turns: Turn[], summary: SummaryDoc): number[] {
  // highlights の turn_no を使う、 無ければ最後の user turn 3 件
  if (summary.highlights.length > 0) {
    return summary.highlights.map((h) => h.turn_no);
  }
  return turns
    .filter((t) => t.role === 'user')
    .slice(-3)
    .map((t) => t.turn_no);
}

function renderSummaryMarkdown(
  sessionId: string,
  s: SummaryDoc,
  args: FtLoopArgs,
  meta: RunMeta,
): string {
  return [
    '---',
    `session_id: ${sessionId}`,
    `interviewer: ${args.interviewer}`,
    `examinee: ${args.examinee}`,
    `generated_at: ${new Date().toISOString()}`,
    `model: ${meta.models.summarizer}`,
    '---',
    '',
    `# ${sessionId} サマリ`,
    '',
    '## headline',
    '',
    s.headline,
    '',
    '## highlights',
    '',
    ...s.highlights.map((h) => `- **turn ${h.turn_no}**: ${h.comment}`),
    '',
    '## axes_summary',
    '',
    '```json',
    JSON.stringify(s.axes_summary, null, 2),
    '```',
    '',
    '## growth_points',
    '',
    ...s.growth_points.map((g, i) => `${i + 1}. ${g}`),
    '',
    '## carry_over',
    '',
    ...s.carry_over.map((c) => `- ${c}`),
    '',
    '## interviewer_note',
    '',
    s.interviewer_note,
    '',
  ].join('\n');
}

function renderCritiqueMarkdown(sessionId: string, doc: AiCritiqueDoc): string {
  const parts: string[] = [
    '---',
    `session_id: ${sessionId}`,
    `generated_at: ${new Date().toISOString()}`,
    '---',
    '',
    '# AI セルフ critique',
    '',
  ];
  for (const t of doc.per_turn) {
    parts.push(`## turn ${t.turn_no}`);
    parts.push('');
    parts.push('**実際の回答**:');
    parts.push('> ' + t.examinee_answer.replace(/\n/g, '\n> '));
    parts.push('');
    parts.push('**より良い答え方**:');
    parts.push('> ' + t.better_answer.replace(/\n/g, '\n> '));
    parts.push('');
    parts.push(`**axes_lifted**: ${t.axes_lifted.join(', ')}`);
    parts.push('');
    parts.push(`**rationale**: ${t.rationale}`);
    parts.push('');
    parts.push('---');
    parts.push('');
  }
  return parts.join('\n');
}

main().catch((err) => {
  console.error('[ft-loop] error:', err.message);
  process.exit(1);
});
