// CompanyInput → NormalizedCompany の正規化と dedup。 純粋関数。

import { ROLE_LENSES, type CompanyInput, type NormalizedCompany, type RoleLens } from './types.js';

const ROLE_SET = new Set<string>(ROLE_LENSES);

// 生の職種文字列 → RoleLens への寄せ表 (日本語 / 別表記)。
const ROLE_ALIASES: Record<string, RoleLens> = {
  planner: 'planner',
  プランナー: 'planner',
  企画: 'planner',
  pm: 'planner',
  ディレクター: 'planner',
  programmer: 'programmer',
  engineer: 'programmer',
  developer: 'programmer',
  プログラマ: 'programmer',
  プログラマー: 'programmer',
  エンジニア: 'programmer',
  designer: 'designer',
  デザイナー: 'designer',
  デザイン: 'designer',
  ui: 'designer',
  ux: 'designer',
  sound: 'sound',
  サウンド: 'sound',
  作曲: 'sound',
  コンポーザー: 'sound',
};

/** 社名を dedup キーに正規化する (lower + 括弧注記 / 法人格 / 記号 / 空白除去)。 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    // 括弧の注記 (旧称/英名/HD 名など) を中身ごと除去 → seed↔research の名寄れを安定させる。
    // 例: "グリー株式会社（グリーホールディングス株式会社）" / "株式会社ディー・エヌ・エー（DeNA）"
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/株式会社|有限会社|合同会社|（株）|\(株\)|co\.,?\s*ltd\.?|inc\.?|corp\.?|ltd\.?/gi, '')
    .replace(/[\s　,.・/\\()（）「」【】]/g, '')
    .trim();
}

/** 生の職種列を既知の RoleLens に寄せて重複排除する。 'any' は捨てる。 */
export function normalizeRoles(roles: string[] | undefined): RoleLens[] {
  if (!roles) return [];
  const out = new Set<RoleLens>();
  for (const raw of roles) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    if (ROLE_SET.has(key) && key !== 'any') {
      out.add(key as RoleLens);
      continue;
    }
    const alias = ROLE_ALIASES[key];
    if (alias) out.add(alias);
  }
  return [...out];
}

function cleanTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const v = t.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.slice(0, 24);
}

function str(v: string | undefined, max: number): string {
  return (v ?? '').trim().slice(0, max);
}

/** CompanyInput を正規化する。 name 空 → null (投入対象外)。 */
export function normalizeCompany(input: CompanyInput): NormalizedCompany | null {
  const name = str(input.name, 200);
  if (!name) return null;
  const normalized_name = normalizeName(name);
  if (!normalized_name) return null;
  return {
    name,
    normalized_name,
    url: str(input.url, 500),
    industry: str(input.industry, 120),
    description: str(input.description, 1000),
    roles: normalizeRoles(input.roles),
    tags: cleanTags(input.tags),
    location: str(input.location, 120),
    size: str(input.size, 60),
    employee_count:
      Number.isFinite(input.employeeCount) && (input.employeeCount ?? 0) > 0
        ? Math.round(input.employeeCount as number)
        : 0,
    listing_market: str(input.listingMarket, 20),
    source: str(input.source, 60) || 'unknown',
    source_url: str(input.source_url, 500) || str(input.url, 500),
  };
}

/** 同一 normalized_name を後勝ちで畳む (クロール 1 回分の dedup)。 */
export function dedupeCompanies(companies: NormalizedCompany[]): NormalizedCompany[] {
  const map = new Map<string, NormalizedCompany>();
  for (const c of companies) map.set(c.normalized_name, c);
  return [...map.values()];
}
