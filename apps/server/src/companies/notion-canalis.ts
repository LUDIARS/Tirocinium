// Notion の企業リスト → companies テーブル の取込を Canalis に載せ替えた経路。
//   ① Crawl  : Canalis の NotionSource (旧 @tirocinium/notion を共有 lib へ移管)
//   ② Clean  : notionRecordToCompany — Notion プロパティ → CompanyInput (決定論・LLM不使用)
//   ③ Save   : 既存 upsertCompany (normalized_name で merge、空値非劣化 / フラグ sticky を温存)
// LLM 排除方針どおり、 この経路は辞書的マッピングのみで LLM を一切呼ばない。

import { NotionSource, type RawRecord, type CrawlOptions } from '@ludiars/canalis';
import { normalizeCompany, type CompanyInput } from '@tirocinium/companies';
import { upsertCompany } from './repo.js';

/** Notion プロパティ名 → company フィールドの対応。 各値は候補キー列 (先頭から最初に値があるものを採用)。 */
export type NotionCompanyFieldMap = {
  /** name は通常 Notion の title を使う。 補完用の候補キー。 */
  name?: string[];
  url?: string[];
  industry?: string[];
  description?: string[];
  roles?: string[];
  tags?: string[];
  location?: string[];
  size?: string[];
};

const DEFAULT_MAP: Required<NotionCompanyFieldMap> = {
  name: ['会社名', '企業名', 'Name', 'name'],
  url: ['URL', 'Url', 'url', 'サイト', 'HP', 'Website'],
  industry: ['業界', 'Industry', 'industry'],
  description: ['説明', '概要', 'Description', 'description'],
  roles: ['職種', '募集職種', 'Roles', 'roles'],
  tags: ['タグ', 'Tags', 'tags', '技術', 'スタック'],
  location: ['所在地', '勤務地', 'Location', 'location'],
  size: ['規模', '社員数', 'Size', 'size'],
};

/** カンマ/読点/スラッシュ/縦棒区切りを配列へ。 */
function splitList(v: string | undefined): string[] {
  if (!v) return [];
  return v
    .split(/[,、/|]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** properties (key→string) から候補キー列の最初の非空値を返す。 */
function pick(props: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = props[k];
    if (v && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Notion の 1 行 (RawRecord) を CompanyInput へ決定論マッピングする。
 * 社名が取れない行は null (スキップ)。 LLM は使わない。
 */
export function notionRecordToCompany(
  record: RawRecord,
  map: NotionCompanyFieldMap = {},
): CompanyInput | null {
  const m = { ...DEFAULT_MAP, ...map };
  const props = ((record.meta?.['properties'] as Record<string, string>) ?? {});

  const name = (record.title ?? '').trim() || pick(props, m.name);
  if (!name) return null;

  return {
    name,
    url: (record.url ?? '').trim() || pick(props, m.url),
    industry: pick(props, m.industry),
    description: pick(props, m.description) || (record.text ?? '').trim(),
    roles: splitList(pick(props, m.roles)),
    tags: splitList(pick(props, m.tags)),
    location: pick(props, m.location),
    size: pick(props, m.size),
    source: 'notion',
    source_url: (record.url ?? '').trim(),
  };
}

export type ImportSummary = {
  crawled: number;
  inserted: number;
  updated: number;
  skipped: number;
};

export type ImportOptions = {
  databaseId: string;
  /** Notion token。 省略時は NotionSource が env NOTION_TOKEN を使う。 */
  token?: string;
  fieldMap?: NotionCompanyFieldMap;
  crawl?: CrawlOptions;
  /** テスト/再利用のため NotionSource を注入可能。 */
  source?: NotionSource;
};

/**
 * Notion DB の企業リストを取込んで companies へ upsert する。
 * ①NotionSource → ②notionRecordToCompany + normalizeCompany → ③upsertCompany。
 */
export async function importCompaniesFromNotion(opts: ImportOptions): Promise<ImportSummary> {
  const source = opts.source ?? new NotionSource();
  const records = await source.crawl({
    databaseId: opts.databaseId,
    token: opts.token,
    crawl: opts.crawl,
  });

  const summary: ImportSummary = { crawled: records.length, inserted: 0, updated: 0, skipped: 0 };
  for (const record of records) {
    const input = notionRecordToCompany(record, opts.fieldMap);
    const normalized = input ? normalizeCompany(input) : null;
    if (!normalized) {
      summary.skipped++;
      continue;
    }
    const result = await upsertCompany(normalized);
    if (result === 'inserted') summary.inserted++;
    else summary.updated++;
  }
  return summary;
}
