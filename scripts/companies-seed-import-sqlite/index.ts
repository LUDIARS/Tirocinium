#!/usr/bin/env tsx
// 調査済みゲーム企業 seed を「ローカル SQLite」へ投入する CLI (docker/Postgres 不要)。
//   data/all-companies-seed.json + data/companies-research.json
//     → mapGameCompanySeed (純粋・共有) → upsertCompanySqlite + upsertProfileSqlite (冪等)
//
// 使い方 (cwd = repo 直下 or apps/server、 既定で repo/data を読む):
//   npm run companies:seed-import:sqlite
//   npm run companies:seed-import:sqlite -- --out data/companies.sqlite
//   npm run companies:seed-import:sqlite -- --seed <path> --research <path>

import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapGameCompanySeed,
  normalizeCompany,
  normalizeName,
  type GameCompanyResearchRecord,
  type GameCompanySeedRecord,
} from '@tirocinium/companies';
import { openCompaniesDb, upsertCompanySqlite, upsertProfileSqlite } from './sqlite-store.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type Args = { seedPath: string; researchPath: string; out: string };

function parseArgs(argv: string[]): Args {
  const a: Args = {
    seedPath: join(REPO_ROOT, 'data', 'all-companies-seed.json'),
    researchPath: join(REPO_ROOT, 'data', 'companies-research.json'),
    out: join(REPO_ROOT, 'data', 'companies.sqlite'),
  };
  const abs = (p: string): string => (isAbsolute(p) ? p : join(REPO_ROOT, p));
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === '--seed') a.seedPath = abs(argv[++i] ?? a.seedPath);
    else if (t === '--research') a.researchPath = abs(argv[++i] ?? a.researchPath);
    else if (t === '--out') a.out = abs(argv[++i] ?? a.out);
    else throw new Error(`unknown option: ${t}`);
  }
  return a;
}

function readJsonArray<T>(path: string): T[] {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

const hasProfileContent = (p: { philosophy?: string; ir_summary?: string; business?: string }): boolean =>
  Boolean((p.philosophy ?? '').trim() || (p.ir_summary ?? '').trim() || (p.business ?? '').trim());

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const seeds = readJsonArray<GameCompanySeedRecord>(args.seedPath);
  const research = readJsonArray<GameCompanyResearchRecord>(args.researchPath);

  const researchByName = new Map<string, GameCompanyResearchRecord>();
  for (const r of research) if (r.name) researchByName.set(normalizeName(r.name), r);

  const db = openCompaniesDb(args.out);
  const summary = { total: 0, inserted: 0, updated: 0, profiles: 0, skipped: 0 };

  try {
    for (const seed of seeds) {
      if (!seed.name) continue;
      summary.total++;
      const mapped = mapGameCompanySeed(seed, researchByName.get(normalizeName(seed.name)) ?? {});
      const normalized = mapped && normalizeCompany(mapped.input);
      if (!mapped || !normalized) {
        summary.skipped++;
        continue;
      }
      const { status, id } = upsertCompanySqlite(db, normalized, {
        flags: mapped.flags,
        recruitUrl: mapped.recruitUrl,
        stockReason: mapped.stockReason,
      });
      summary[status]++;
      if (hasProfileContent(mapped.profile)) {
        upsertProfileSqlite(db, id, mapped.profile);
        summary.profiles++;
      }
    }
  } finally {
    db.close();
  }

  console.error(
    `[companies:seed-import:sqlite] done: db=${args.out} total=${summary.total} ` +
      `inserted=${summary.inserted} updated=${summary.updated} profiles=${summary.profiles} skipped=${summary.skipped}`,
  );
}

try {
  main();
} catch (err) {
  console.error('[companies:seed-import:sqlite] error:', err instanceof Error ? err.message : err);
  process.exit(1);
}
