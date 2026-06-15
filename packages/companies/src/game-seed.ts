// 調査済みゲーム企業 seed (data/all-companies-seed.json + data/companies-research.json) を
// companies / company_profiles 投入形へ寄せる決定論マッパ。 純粋関数 (LLM 不使用)。
//
// データは既に人手/調査で整形済のため、 ここでは「フィールドの寄せ」だけを行う。
// クロール経路 (extract.ts / listing.ts) とは別系統 — 取得済データの取り込み専用。

import type { CompanyFlags, CompanyInput, CompanyProfileInput, RoleLens } from './types.js';
import { extractEmployeeCount, parseListingMarket, isSMBByEmployees } from './size.js';

/** data/all-companies-seed.json の 1 レコード (調査の一次整形)。 */
export type GameCompanySeedRecord = {
  name?: string;
  company_url?: string;
  recruit_url?: string;
  titles?: string;
  platform?: string;
  roles?: string;
  tech?: string;
  tag?: string;
  location?: string;
};

/** data/companies-research.json の 1 レコード (深掘り調査)。 */
export type GameCompanyResearchRecord = {
  name?: string;
  recruiting_status?: string;
  recruit_url?: string;
  recruiting_note?: string;
  ir_recent?: string;
  size?: string;
  games?: string;
  game_kind?: string;
  tech_stack?: string[];
  features?: string;
  sources?: string[];
};

/** マッパ出力。 server 側で upsertCompany / upsertProfile に配線する。 */
export type GameSeedMapped = {
  input: CompanyInput;
  flags: CompanyFlags;
  /** 上場しているか (listing_market が判定できたか)。 */
  isListed: boolean;
  recruitUrl: string;
  stockReason: string;
  profile: CompanyProfileInput;
};

// 生の職種/技術テキスト → RoleLens を含有判定で拾う (順序は出現順)。
const ROLE_KEYWORDS: [RegExp, RoleLens][] = [
  [/プログラ|エンジニア|programmer|engineer|developer/i, 'programmer'],
  [/プランナ|企画|ディレクタ|プロデューサ|planner/i, 'planner'],
  [/デザイナ|アーティスト|アート|イラスト|モデラ|ui|ux|designer/i, 'designer'],
  [/サウンド|作曲|コンポーザ|音楽|sound/i, 'sound'],
];

function detectRoles(...texts: (string | undefined)[]): RoleLens[] {
  const hay = texts.filter(Boolean).join(' ');
  const out: RoleLens[] = [];
  for (const [re, role] of ROLE_KEYWORDS) {
    if (re.test(hay) && !out.includes(role)) out.push(role);
  }
  return out;
}

function splitTech(seedTech: string | undefined, stack: string[] | undefined): string[] {
  const fromSeed = (seedTech ?? '').split(/[,、\/]/).map((s) => s.trim());
  return [...fromSeed, ...(stack ?? [])].filter(Boolean);
}

function buildTags(seed: GameCompanySeedRecord, research: GameCompanyResearchRecord): string[] {
  return [seed.tag, seed.platform, research.game_kind, ...splitTech(seed.tech, research.tech_stack)]
    .map((t) => (t ?? '').trim())
    .filter(Boolean);
}

function cap(s: string | undefined, n: number): string {
  return (s ?? '').trim().slice(0, n);
}

/** 長い size 文から「従業員数: …」部分を優先抽出 (無ければ先頭を切る)。 */
function shortSize(sizeText: string | undefined): string {
  const t = (sizeText ?? '').trim();
  if (!t) return '';
  const m = t.match(/従業員数[:：]?\s*([^。\n]+)/);
  return cap(m ? m[1] : t, 60);
}

/** features 中の「…」ミッション引用を優先、 無ければ先頭文を philosophy に。 */
function extractPhilosophy(features: string | undefined): string {
  const t = (features ?? '').trim();
  if (!t) return '';
  const q = t.match(/[「『]([^」』]{4,})[」』]/);
  if (q) return cap(q[1], 500);
  return cap(t.split(/[。\n]/)[0], 500);
}

function buildBusiness(research: GameCompanyResearchRecord): string {
  const kind = (research.game_kind ?? '').trim();
  const games = (research.games ?? '').trim();
  const head = kind ? `${kind}系ゲーム開発。` : '';
  const body = games ? `代表作: ${games}` : '';
  return cap(`${head}${body}`.trim(), 800);
}

function uniqStrings(values: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = (v ?? '').trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * seed (+ research) を投入形へ寄せる。 name 空 → null (投入対象外)。
 * research は name 突合で渡す (片方のみでも可)。
 */
export function mapGameCompanySeed(
  seed: GameCompanySeedRecord,
  research: GameCompanyResearchRecord = {},
): GameSeedMapped | null {
  const name = (seed.name ?? research.name ?? '').trim();
  if (!name) return null;

  const recruitUrl = (seed.recruit_url ?? research.recruit_url ?? '').trim();
  const hasOpening = (research.recruiting_status ?? '').includes('募集中');
  const isNewgrad = /新卒/.test(`${research.recruiting_note ?? ''} ${seed.roles ?? ''} ${research.features ?? ''}`);

  // 会社規模 (従業員数) と上場区分 (research 優先、 無ければ seed.tag を補助に)。
  const employeeCount = extractEmployeeCount(research.size);
  const listingMarket = parseListingMarket(research.ir_recent, seed.tag);
  const isSMB = isSMBByEmployees(employeeCount);
  const isListed = listingMarket !== '';

  const stockReason = uniqStrings([
    'ゲーム企業',
    hasOpening ? '募集中' : '',
    isNewgrad ? '新卒採用あり' : '',
  ]).join(' / ');

  const input: CompanyInput = {
    name,
    url: (seed.company_url ?? '').trim(),
    industry: 'ゲーム',
    description: research.features ?? seed.titles ?? '',
    roles: detectRoles(seed.roles, seed.titles, research.features),
    tags: buildTags(seed, research),
    location: seed.location ?? '',
    size: shortSize(research.size),
    employeeCount,
    listingMarket,
    source: 'game-seed',
    source_url: (seed.company_url ?? '').trim(),
  };

  const profile: CompanyProfileInput = {
    philosophy: extractPhilosophy(research.features),
    values: [],
    ir_summary: cap(research.ir_recent, 800),
    business: buildBusiness(research),
    sources: uniqStrings([seed.company_url, recruitUrl, ...(research.sources ?? [])]),
  };

  return {
    input,
    flags: { isNewgrad, isGame: true, hasOpening, isSMB },
    isListed,
    recruitUrl,
    stockReason,
    profile,
  };
}
