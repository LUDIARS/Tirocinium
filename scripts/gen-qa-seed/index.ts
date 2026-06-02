#!/usr/bin/env tsx
// 想定質問 QA seed の合成生成 CLI。
// テーマ土台 (themes.ts、合法な定番観点のみ) を種に、role × stage の
// 想定質問・深掘り(弁証法の反)・評価軸・STAR 模範解答骨子を LLM で量産する。
//
//   npx tsx scripts/gen-qa-seed --stage hr --role programmer
//   npx tsx scripts/gen-qa-seed --all
//
// LLM は claude CLI 経由 (ANTHROPIC_API_KEY 不要)。出力は data/general/qa-seed/<stage>/<role>.json。

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaudeCli, extractJsonBlock } from '@tirocinium/llm';
import {
  ROLES,
  ROLE_LABEL,
  ROLE_LENS,
  STAGES,
  STAGE_LABEL,
  STAGE_THEMES,
  type Role,
  type Stage,
} from './themes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_OUT = join(REPO_ROOT, 'data', 'general', 'qa-seed');

type QaItem = {
  theme: string;
  question: string;
  followups: string[];
  axes: string[];
  answer_outline: string;
};

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return {
    all: Boolean(args['all']),
    stage: args['stage'] as Stage | undefined,
    role: args['role'] as Role | undefined,
    output: typeof args['output'] === 'string' ? (args['output'] as string) : DEFAULT_OUT,
    dryRun: Boolean(args['dry-run']),
  };
}

function buildPrompt(stage: Stage, role: Role): string {
  const themes = STAGE_THEMES[stage];
  return [
    `あなたはゲーム業界の新卒採用の面接設計者です。`,
    `面接ステージ「${STAGE_LABEL[stage]}」/ 職種「${ROLE_LABEL[role]}」(観点: ${ROLE_LENS[role]}) の想定質問を作ってください。`,
    `以下の質問テーマを土台に、各テーマ 1 問ずつ、JSON 配列で出力します。`,
    `テーマ: ${themes.join(' / ')}`,
    ``,
    `各要素のスキーマ:`,
    `{`,
    `  "theme": "<テーマ名>",`,
    `  "question": "<面接官の質問文。結論先出しを促す自然な聞き方>",`,
    `  "followups": ["<深掘り: 矛盾/反例/未踏スロット(具体例・数値・本人の担当) を突く一手>"],`,
    `  "axes": ["<評価軸を 1-2 個>"],`,
    `  "answer_outline": "<STAR(状況→課題→行動→結果) で模範解答の骨子。一般論で書き、嘘の固有名詞や数値は入れない>"`,
    `}`,
    `評価軸の語彙: consistency, clarity, demeanor, self_understanding, target_fit, depth_resilience`,
    ``,
    `ルール: 特定企業や実在の人物・サービス名は入れない。出力は JSON 配列のみ (前置き・コードフェンス可)。`,
  ].join('\n');
}

function validate(items: unknown): QaItem[] {
  if (!Array.isArray(items)) throw new Error('output is not a JSON array');
  return items.map((raw, i) => {
    const o = raw as Partial<QaItem>;
    if (typeof o.theme !== 'string' || typeof o.question !== 'string') {
      throw new Error(`item[${i}] missing theme/question`);
    }
    return {
      theme: o.theme,
      question: o.question,
      followups: Array.isArray(o.followups) ? o.followups.filter((f) => typeof f === 'string') : [],
      axes: Array.isArray(o.axes) ? o.axes.filter((a) => typeof a === 'string') : [],
      answer_outline: typeof o.answer_outline === 'string' ? o.answer_outline : '',
    };
  });
}

async function genOne(stage: Stage, role: Role, outDir: string, dryRun: boolean): Promise<void> {
  const prompt = buildPrompt(stage, role);
  if (dryRun) {
    console.log(`\n=== ${stage} / ${role} (dry-run prompt) ===\n${prompt}\n`);
    return;
  }
  console.log(`[gen] ${stage} / ${role} … (claude CLI 生成中)`);
  const text = await runClaudeCli(prompt, 'sonnet');
  const items = validate(JSON.parse(extractJsonBlock(text)));
  const dir = join(outDir, stage);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${role}.json`);
  await writeFile(
    path,
    JSON.stringify({ stage, role, generated_at: new Date().toISOString(), items }, null, 2) + '\n',
  );
  console.log(`[gen] wrote ${items.length} items → ${path}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const stages: Stage[] = args.stage ? [args.stage] : STAGES;
  const roles: Role[] = args.role ? [args.role] : ROLES;
  const combos = args.all || (!args.stage && !args.role);

  const targets: [Stage, Role][] = [];
  if (combos) {
    for (const s of STAGES) for (const r of ROLES) targets.push([s, r]);
  } else {
    for (const s of stages) for (const r of roles) targets.push([s, r]);
  }

  console.log(`[gen] ${targets.length} 組 (stage×role) を生成`);
  for (const [s, r] of targets) {
    try {
      await genOne(s, r, args.output, args.dryRun);
    } catch (err) {
      console.error(`[gen] ${s}/${r} 失敗:`, (err as Error).message);
    }
  }
  console.log('[gen] done');
}

main().catch((err) => {
  console.error('[gen] error:', err.message);
  process.exit(1);
});
