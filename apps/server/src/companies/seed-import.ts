// 調査済みゲーム企業 seed (data/all-companies-seed.json + data/companies-research.json) を
// companies / company_profiles へ投入する配線 (IO + DB)。 マッピング自体は
// @tirocinium/companies の mapGameCompanySeed (純粋) に委譲する。 LLM 不使用・冪等。

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mapGameCompanySeed,
  normalizeCompany,
  normalizeName,
  type GameCompanyResearchRecord,
  type GameCompanySeedRecord,
} from '@tirocinium/companies';
import { getCompanyByNormalizedName, upsertCompany } from './repo.js';
import { upsertProfile } from './profile-repo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// apps/server/src/companies → repo 直下 data/
const DATA_DIR = join(__dirname, '..', '..', '..', '..', 'data');
const DEFAULT_SEED_PATH = join(DATA_DIR, 'all-companies-seed.json');
const DEFAULT_RESEARCH_PATH = join(DATA_DIR, 'companies-research.json');

export type SeedImportOptions = {
  seedPath?: string;
  researchPath?: string;
};

export type SeedImportSummary = {
  total: number;
  inserted: number;
  updated: number;
  profiles: number;
  skipped: number;
};

async function readJsonArray<T>(path: string): Promise<T[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** seed と research を社名 (normalized) で突合した {seed, research} 列にする。 */
function mergeByName(
  seeds: GameCompanySeedRecord[],
  research: GameCompanyResearchRecord[],
): { seed: GameCompanySeedRecord; research: GameCompanyResearchRecord }[] {
  const researchByName = new Map<string, GameCompanyResearchRecord>();
  for (const r of research) {
    if (r.name) researchByName.set(normalizeName(r.name), r);
  }
  return seeds
    .filter((s) => s.name)
    .map((seed) => ({ seed, research: researchByName.get(normalizeName(seed.name!)) ?? {} }));
}

const hasProfileContent = (p: { philosophy?: string; ir_summary?: string; business?: string }): boolean =>
  Boolean((p.philosophy ?? '').trim() || (p.ir_summary ?? '').trim() || (p.business ?? '').trim());

/**
 * seed JSON を companies / company_profiles へ upsert する。
 * 既存行は upsertCompany の非劣化マージ + フラグ sticky を踏襲 (再実行安全)。
 */
export async function importGameCompanySeeds(opts: SeedImportOptions = {}): Promise<SeedImportSummary> {
  const seeds = await readJsonArray<GameCompanySeedRecord>(opts.seedPath ?? DEFAULT_SEED_PATH);
  const research = await readJsonArray<GameCompanyResearchRecord>(opts.researchPath ?? DEFAULT_RESEARCH_PATH);
  const merged = mergeByName(seeds, research);

  const summary: SeedImportSummary = { total: merged.length, inserted: 0, updated: 0, profiles: 0, skipped: 0 };

  for (const { seed, research: r } of merged) {
    const mapped = mapGameCompanySeed(seed, r);
    const normalized = mapped && normalizeCompany(mapped.input);
    if (!mapped || !normalized) {
      summary.skipped++;
      continue;
    }

    const status = await upsertCompany(normalized, {
      isNewgrad: mapped.flags.isNewgrad,
      isGame: mapped.flags.isGame,
      hasOpening: mapped.flags.hasOpening,
      recruitUrl: mapped.recruitUrl,
      stockReason: mapped.stockReason,
    });
    if (status === 'inserted') summary.inserted++;
    else summary.updated++;

    if (hasProfileContent(mapped.profile)) {
      const company = await getCompanyByNormalizedName(normalized.normalized_name);
      if (company) {
        await upsertProfile(company.id, mapped.profile);
        summary.profiles++;
      }
    }
  }

  return summary;
}
