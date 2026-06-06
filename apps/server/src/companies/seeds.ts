import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompanyInput } from '@tirocinium/companies';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// repo 直下 data/companies/seeds.json (apps/server/src/companies → ../../../../data)
const SEEDS_PATH = join(__dirname, '..', '..', '..', '..', 'data', 'companies', 'seeds.json');

/** seed-file ソース用の {name, url}[] を読み込む。 ファイル無し / 不正は空配列。 */
export async function loadSeedRecords(): Promise<CompanyInput[]> {
  try {
    const text = await readFile(SEEDS_PATH, 'utf8');
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r): r is { name?: string; url?: string } => typeof r === 'object' && r !== null)
      .map((r) => ({ name: typeof r.name === 'string' ? r.name : '', url: typeof r.url === 'string' ? r.url : '' }))
      .filter((r) => r.url);
  } catch {
    return [];
  }
}
