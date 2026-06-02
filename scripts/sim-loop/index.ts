#!/usr/bin/env tsx
// 適応シミュレーションループ: AI 受験者 × AI 面接官の模擬面接を回し、
// 各ラウンドの FB(評価) から「面接官の聞き方の方針」を更新して次ラウンドに反映する。
// 鍵不要 (会話も評価も claude CLI 経由)。
//
//   npx tsx scripts/sim-loop --interviewer hr-warm-40f --examinee examinee-newgrad-programmer-shy --rounds 3 --turns 6
//
// 出力: data/training/sim-sessions/<date>/<interviewer>__<examinee>/sim-log.md (+ rounds.json)

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import {
  buildSystemPrompt,
  examineeSystemPrompt,
  serializeHistory,
  runClaudeCli,
  extractJsonBlock,
  parseEvaluation,
  EVAL_INSTRUCTION,
  type Axes,
  type InterviewerPersonaInput,
  type ExamineePersonaInput,
  type Turn,
} from '@tirocinium/llm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

type Args = { interviewer: string; examinee: string; rounds: number; turns: number; output: string };

function parseArgs(argv: string[]): Args {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (!k.startsWith('--')) continue;
    a[k.slice(2)] = argv[i + 1] ?? '';
    i++;
  }
  if (!a['interviewer'] || !a['examinee']) throw new Error('Required: --interviewer <id> --examinee <id>');
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  // ラン毎にユニークな dir (同ペアの再実行で上書きしない: HHMMSS + 乱数3桁)
  const stamp = now.toISOString().slice(11, 19).replace(/:/g, '') + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return {
    interviewer: a['interviewer'],
    examinee: a['examinee'],
    rounds: Number.parseInt(a['rounds'] ?? '3', 10),
    turns: Number.parseInt(a['turns'] ?? '6', 10),
    output:
      a['output'] ||
      join(REPO_ROOT, 'data/training/sim-sessions', date, `${a['interviewer']}__${a['examinee']}__${stamp}`),
  };
}

async function loadFm<T>(kind: 'interviewer' | 'examinee', id: string): Promise<T> {
  const path = join(REPO_ROOT, `data/general/persona/${kind}/${id}.md`);
  await access(path);
  return matter(await readFile(path, 'utf8')).data as T;
}

function coldOpen(stage: string): string {
  switch (stage) {
    case 'hr': return 'まず、自己紹介を 1 分くらいでお願いします。';
    case 'peer-tech': return '直近で取り組んだ制作や開発の概要を教えてください。';
    case 'lead-tech': return '3-5 年単位で見た、あなたの仕事の全体像を聞かせてください。';
    case 'final': return 'あなたにとって、この仕事はどんな位置づけですか。';
    default: return 'まず自己紹介をお願いします。';
  }
}

/** CLI で評価 (鍵不要)。 */
async function evaluateCli(turns: Turn[]): Promise<{ axes: Axes; comment: string; hints: string[] }> {
  const text = await runClaudeCli(`${EVAL_INSTRUCTION}\n\n${serializeHistory(turns)}`, 'sonnet');
  return parseEvaluation(extractJsonBlock(text));
}

/** FB から「次ラウンドの面接官の聞き方の方針」を 1-2 文で導く (CLI)。 */
async function deriveStyle(
  axes: Axes,
  comment: string,
  hints: string[],
): Promise<string> {
  const lowest = (Object.entries(axes) as [keyof Axes, number][])
    .sort((a, b) => a[1] - b[1])
    .slice(0, 2)
    .map(([k]) => k);
  const prompt = [
    'あなたは面接設計の補佐です。直前の模擬面接の評価を踏まえ、',
    '次の面接で「面接官の聞き方」をどう変えるべきかを 1-2 文で指示してください。',
    '出力は方針本文のみ (前置き不要)。',
    '',
    `弱かった軸: ${lowest.join(', ')}`,
    `所感: ${comment}`,
    `改善 hint: ${hints.join(' / ')}`,
    '',
    '例: 「depth_resilience が低いので "なぜ" を 3 段重ねて粘り、抽象的な回答で止めない」',
  ].join('\n');
  return (await runClaudeCli(prompt, 'sonnet')).trim();
}

async function runRound(
  interviewerFm: InterviewerPersonaInput,
  examineeFm: ExamineePersonaInput,
  turnsBudget: number,
  styleNotes: string[],
): Promise<Turn[]> {
  const turns: Turn[] = [];
  let n = 0;

  // cold-open
  n += 1;
  turns.push({ turn_no: n, role: 'interviewer', text: coldOpen(interviewerFm.stage) });

  const interviewerSystem = [
    buildSystemPrompt({ interviewer: interviewerFm }),
    styleNotes.length ? '\n## 今回の聞き方の方針 (前回までの FB より)\n' + styleNotes.map((s) => `- ${s}`).join('\n') : '',
  ].filter(Boolean).join('\n');

  while (n < turnsBudget) {
    // examinee
    const exPrompt = [
      examineeSystemPrompt(examineeFm),
      '', '## これまでの面接', serializeHistory(turns),
      '', '## 面接官の最新質問', turns[turns.length - 1]!.text,
      '', '上記に、ペルソナの癖を反映して答えてください。回答文のみ。',
    ].join('\n');
    const ex = await runClaudeCli(exPrompt, 'haiku');
    n += 1;
    turns.push({ turn_no: n, role: 'user', text: ex });
    if (n >= turnsBudget) break;

    // interviewer (聞き方方針を反映)
    const ivPrompt = [
      interviewerSystem,
      '', '## これまでの面接', serializeHistory(turns),
      '', '面接官として、次の発話 (質問) を 1 つだけ出力してください。発話文のみ。',
    ].join('\n');
    const iv = await runClaudeCli(ivPrompt, 'sonnet');
    n += 1;
    turns.push({ turn_no: n, role: 'interviewer', text: iv });
  }
  return turns;
}

function axesLine(axes: Axes): string {
  return (Object.entries(axes) as [string, number][]).map(([k, v]) => `${k}:${v}`).join(' / ');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[sim] ${args.interviewer} × ${args.examinee} / ${args.rounds} rounds × ${args.turns} turns`);

  const interviewerFm = await loadFm<InterviewerPersonaInput>('interviewer', args.interviewer);
  const examineeFm = await loadFm<ExamineePersonaInput>('examinee', args.examinee);
  await mkdir(args.output, { recursive: true });

  const styleNotes: string[] = [];
  const rounds: { round: number; style: string[]; turns: Turn[]; axes: Axes; comment: string; nextStyle: string }[] = [];

  for (let r = 1; r <= args.rounds; r++) {
    console.log(`[sim] round ${r}/${args.rounds} … (聞き方方針 ${styleNotes.length} 件)`);
    const turns = await runRound(interviewerFm, examineeFm, args.turns, [...styleNotes]);
    const ev = await evaluateCli(turns);
    const nextStyle = await deriveStyle(ev.axes, ev.comment, ev.hints);
    rounds.push({ round: r, style: [...styleNotes], turns, axes: ev.axes, comment: ev.comment, nextStyle });
    styleNotes.push(nextStyle);
    console.log(`[sim] round ${r}: ${axesLine(ev.axes)}`);
    console.log(`[sim]   → 次の聞き方: ${nextStyle}`);
  }

  // ログ書き出し
  await writeFile(join(args.output, 'rounds.json'), JSON.stringify({ args, rounds }, null, 2));
  const md: string[] = [
    `# シミュレーションログ — ${args.interviewer} × ${args.examinee}`,
    '',
    `${args.rounds} ラウンドの適応面接 (FB → 面接官の聞き方を更新)。`,
    '',
  ];
  for (const rd of rounds) {
    md.push(`## Round ${rd.round}`);
    md.push('');
    md.push('**この回の聞き方の方針**: ' + (rd.style.length ? rd.style.map((s) => `\n- ${s}`).join('') : '(初回: 素の面接官)'));
    md.push('');
    md.push('**会話**:');
    for (const t of rd.turns) md.push(`- ${t.role === 'interviewer' ? '面接官' : '受験者'}: ${t.text}`);
    md.push('');
    md.push('**評価**: ' + axesLine(rd.axes));
    md.push('');
    md.push('> ' + rd.comment.replace(/\n/g, ' '));
    md.push('');
    md.push('**→ 次ラウンドで変える聞き方**: ' + rd.nextStyle);
    md.push('');
    md.push('---');
    md.push('');
  }
  const logPath = join(args.output, 'sim-log.md');
  await writeFile(logPath, md.join('\n'));
  console.log(`[sim] done → ${logPath}`);
}

main().catch((err) => {
  console.error('[sim] error:', err.message);
  process.exit(1);
});
