#!/usr/bin/env tsx
// OB コーパス → 質問パターン抽出バッチ (spec/feature/inference/interviewer-reproduction.md §6.2)。
// backdoor_alumni (企業解決済み OB) を走査し、各 OB の past_qa を Memoria RAG
// (per-user スコープ) で引き、質問の「型」だけを EXTRACTOR (claude CLI haiku) で
// 抽出して ob_question_patterns へ仮名化 upsert する。回答本文は保存しない。
//
//   npx tsx scripts/ob-patterns                       # 全対象
//   npx tsx scripts/ob-patterns -- --company Example  # 企業で絞る
//   npx tsx scripts/ob-patterns -- --dry-run          # DB 書込なし
//   npx tsx scripts/ob-patterns -- --topk 8 --db data/tirocinium.sqlite
//
// ログ: data/training/ob-patterns/<date>-run.log (各ステップの成否を残す)

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName } from '@tirocinium/companies';
import { expandTerms, runClaudeCli } from '@tirocinium/llm';
import { createMemoriaClient } from '@tirocinium/training';
import { config } from '../../apps/server/src/config.js';
import { initSql, sql } from '../../apps/server/src/db/index.js';
import { extractPatterns } from '../../apps/server/src/ob-patterns/extract.js';
import { obAlias } from '../../apps/server/src/ob-patterns/ob-alias.js';
import { countObPatterns, upsertObPattern } from '../../apps/server/src/ob-patterns/repo.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Args = { company: string | null; topK: number; dryRun: boolean; db: string | null };

function parseArgs(argv: string[]): Args {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]!;
    if (!k.startsWith('--')) continue;
    const name = k.slice(2);
    if (name === 'dry-run') {
      a[name] = true;
      continue;
    }
    a[name] = argv[i + 1] ?? '';
    i++;
  }
  return {
    company: typeof a['company'] === 'string' && a['company'] ? a['company'] : null,
    topK: Number.parseInt((a['topk'] as string) ?? '6', 10) || 6,
    dryRun: a['dry-run'] === true,
    db: typeof a['db'] === 'string' && a['db'] ? a['db'] : null,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.db) config.databaseUrl = args.db;
  initSql();

  const memoria = createMemoriaClient();
  if (!memoria) {
    // OB コーパスの正本は Memoria — 未設定での実行は成立しない (無言スキップしない)
    console.error('[fatal] MEMORIA_URL 未設定。OB 抽出バッチは Memoria 必須です。');
    process.exit(1);
  }

  const logDir = join(REPO_ROOT, 'data', 'training', 'ob-patterns');
  await mkdir(logDir, { recursive: true });
  const logPath = join(logDir, `${new Date().toISOString().slice(0, 10)}-run.log`);
  const log = async (line: string) => {
    console.log(line);
    await appendFile(logPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
  };

  // 対象 OB: 企業解決済みの backdoor_alumni (本人同意の投稿導線を経たものだけが居る)
  const alumni = await sql<{ cernere_user_id: string; company_id: string; company_name: string }[]>`
    SELECT a.cernere_user_id, c.id AS company_id, c.name AS company_name
    FROM backdoor_alumni a
    JOIN companies c ON c.id = a.current_company_id
    WHERE a.current_company_id IS NOT NULL
    ORDER BY c.name ASC, a.cernere_user_id ASC
  `;
  const targets = args.company
    ? alumni.filter(
        (r) =>
          r.company_name === args.company ||
          normalizeName(r.company_name) === normalizeName(args.company!),
      )
    : alumni;

  await log(`[start] 対象 OB ${targets.length} 名 (全 ${alumni.length} 名)${args.dryRun ? ' [dry-run]' : ''}`);
  if (targets.length === 0) {
    await log('[done] 対象なし (backdoor_alumni に企業解決済みの OB がいない)');
    return;
  }

  let extracted = 0;
  let upserted = 0;
  let deduped = 0;
  for (const ob of targets) {
    const alias = obAlias(ob.cernere_user_id);
    const query = expandTerms([ob.company_name, '面接', '質問', '選考']).join(' ');
    let items;
    try {
      const rag = await memoria.rag({
        user_id: ob.cernere_user_id,
        query,
        filter: { kinds: ['past_qa'] },
        topK: args.topK,
      });
      items = rag.items;
    } catch (err) {
      await log(`[warn] ${alias} @ ${ob.company_name}: Memoria RAG 失敗 — ${(err as Error).message}`);
      continue;
    }
    if (items.length === 0) {
      await log(`[skip] ${alias} @ ${ob.company_name}: past_qa なし`);
      continue;
    }

    let patterns;
    try {
      patterns = await extractPatterns((p) => runClaudeCli(p, 'haiku'), {
        companyName: ob.company_name,
        stage: '',
        role: 'general',
        excerpts: items.map((i) => i.excerpt),
      });
    } catch (err) {
      await log(`[warn] ${alias} @ ${ob.company_name}: 抽出失敗 — ${(err as Error).message}`);
      continue;
    }
    extracted += patterns.length;
    await log(`[extract] ${alias} @ ${ob.company_name}: ${patterns.length} パターン (抜粋 ${items.length} 件)`);

    for (const p of patterns) {
      if (args.dryRun) {
        await log(`  [dry] ${p.theme}: ${p.question_pattern}`);
        continue;
      }
      const result = await upsertObPattern({
        companyId: ob.company_id,
        stage: '',
        role: 'general',
        theme: p.theme,
        questionPattern: p.question_pattern,
        followupPatterns: p.followup_patterns,
        axes: p.axes,
        sourceRefs: items.map((i) => i.memoria_uri),
        contributorAlias: alias,
      });
      if (result.deduped) deduped += 1;
      else upserted += 1;
    }
  }

  const companies = [...new Set(targets.map((t) => t.company_id))];
  for (const cid of companies) {
    const name = targets.find((t) => t.company_id === cid)!.company_name;
    await log(`[count] ${name}: ob_question_patterns 計 ${await countObPatterns(cid)} 件`);
  }
  await log(`[done] 抽出 ${extracted} / 新規 ${upserted} / 既存マージ ${deduped}${args.dryRun ? ' (dry-run: 書込なし)' : ''}`);
  await sql.end();
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
