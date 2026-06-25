// 求人ニュース (job postings) のドメインロジック。
// 2 系統のソースを 1 つの正規化形 JobPostingItem に畳む:
//   - rss          : ニュースフィード (gamebiz / GameBusiness 等)。 採用関連だけを keyword で抽出。
//   - job-listing  : 求人一覧ページ (gamebiz.jp/jobs 等)。 LLM で個別求人を抽出。
// 取得 / DB / LLM 呼び出しは持たず parse・正規化・判定のみ (純粋関数)。

import { extractJsonBlock } from '@tirocinium/llm';
import { decodeEntities } from './html.js';
import { normalizeUrl } from './interview.js';
import type { FeedItem } from './rss.js';

/** DB 投入前の正規化済み求人 1 件。 dedupKey が冪等キー。 */
export type JobPostingItem = {
  source: string;
  /** rss=ニュースフィード / job-listing=求人一覧ページ / recruit-page=企業の自社採用ページ。 */
  kind: 'rss' | 'job-listing' | 'recruit-page';
  /** 冪等キー (= normalizeUrl(url))。 UNIQUE。 */
  dedupKey: string;
  url: string;
  title: string;
  /** 企業名 (抽出できれば。 rss は基本 '')。 */
  companyName: string;
  /** 募集職種 (job-listing のみ。 rss は '')。 */
  role: string;
  location: string;
  employmentType: string;
  /** 説明 / 抜粋。 */
  snippet: string;
  /** 公開日時 ISO (rss の pubDate / job-listing の募集開始)。 無しは ''。 */
  postedAt: string;
  /** 応募締切 (job-listing で読めれば)。 '' 可。 */
  deadline: string;
};

/** 求人一覧ページから LLM が抽出する 1 件 (発見段階)。 */
export type JobListingEntry = {
  title: string;
  companyName: string;
  url: string;
  role: string;
  location: string;
  employmentType: string;
  snippet: string;
  deadline: string;
  /** 新卒採用 or 新卒も応募可能と読み取れるか。 */
  newgrad: boolean;
  /** 未経験者歓迎 / 未経験可と読み取れるか。 */
  inexperiencedOk: boolean;
};

/** 新卒/未経験 を表すテキストキーワード (LLM フラグの取りこぼし補完用)。 */
export const NEWGRAD_ELIGIBLE_KEYWORDS = [
  '新卒', '第二新卒', '未経験', '未経験者歓迎', '未経験可', '未経験ok', '経験不問', '学生', '26卒', '27卒',
];

/**
 * 求人が「新卒採用 / 新卒応募可 / 未経験可」かを判定する。
 * LLM フラグ (newgrad / inexperiencedOk) を主、 タイトル・説明・雇用形態のキーワードを従にして拾う。
 */
export function isNewgradEligible(entry: JobListingEntry): boolean {
  if (entry.newgrad || entry.inexperiencedOk) return true;
  const hay = [entry.title, entry.snippet, entry.role, entry.employmentType].join(' ').toLowerCase();
  return NEWGRAD_ELIGIBLE_KEYWORDS.some((k) => hay.includes(k.toLowerCase()));
}

/**
 * 採用・求人に関係するニュースかを判定するキーワード (rss フィルタ用)。
 * ゲーム文脈で誤爆する語 (単独の「募集」=ガチャ/イベント募集、「人材」「job」) は採らず、
 * 採用特化の語に絞る (精度優先。 recall は job-listing ソース + gamebiz-jobs が担保)。
 */
export const HIRING_KEYWORDS = [
  '求人', '採用', '転職', '中途', '新卒', '内定', 'リクルート', '雇用',
  '求める人物', '人材募集', 'スタッフ募集', '採用説明会',
];

/**
 * フィード item が採用/求人関連かを判定する。
 * タイトル / カテゴリ に HIRING_KEYWORDS が含まれれば true。
 * 本文 (description) は対象にしない — まとめ記事・ランキング等が本文に採用語を巻き込んで
 * 誤検出するため、 主題を表すタイトル・カテゴリだけで判定する。
 */
export function isHiringNews(item: FeedItem): boolean {
  const hay = [item.title, ...item.categories].join(' ').toLowerCase();
  return HIRING_KEYWORDS.some((k) => hay.includes(k.toLowerCase()));
}

/** フィード item → JobPostingItem (rss 種)。 */
export function jobPostingFromFeed(source: string, item: FeedItem): JobPostingItem | null {
  const url = item.link.trim();
  const title = item.title.trim();
  if (!url || !title) return null;
  return {
    source,
    kind: 'rss',
    dedupKey: normalizeUrl(url),
    url,
    title,
    companyName: '',
    role: '',
    location: '',
    employmentType: '',
    snippet: item.description.slice(0, 400),
    postedAt: item.publishedAt,
    deadline: '',
  };
}

export const JOB_LISTING_INSTRUCTION = `
あなたは求人一覧ページから「掲載されている個別の求人」を抽出するアシスタントです。
ページ本文から求人を列挙し、 各求人について分かる範囲を JSON で返してください。

出力は **JSON オブジェクト 1 個のみ**。前置き・コードフェンス以外の説明は禁止。
スキーマ:
{
  "jobs": [
    {
      "title": "求人タイトル (職種名など)",
      "company": "募集している会社名 (本文にあれば。 無ければ空文字)",
      "url": "その求人の詳細ページ URL (本文にあれば。 無ければ空文字)",
      "role": "職種カテゴリ (例: プログラマー / デザイナー / プランナー / その他)",
      "location": "勤務地 (あれば)",
      "employment_type": "雇用形態 (正社員 / 契約 / アルバイト 等。 あれば)",
      "snippet": "募集内容の要約 (40字程度)",
      "deadline": "応募締切 / 募集期間 (本文にあれば。 無ければ空文字)",
      "newgrad": true/false,          // 新卒採用、 または新卒も応募できると読み取れるか
      "inexperienced_ok": true/false  // 未経験者歓迎 / 未経験可 / 経験不問 と読み取れるか
    }
  ]
}

ルール:
- 本文に実在する求人のみ。 創作しない。 不明な項目は空文字 / false。
- ナビゲーション・広告・関連リンクは求人として列挙しない。
- newgrad / inexperienced_ok は本文の表記 (新卒採用・新卒可・第二新卒・未経験歓迎・未経験OK・経験不問 等) から判断する。 中途/経験者のみの求人は両方 false。
- 1 ページ (チャンク) から最大 40 件まで。
`.trim();

/** LLM 出力テキストを JobListingEntry[] に parse する (純粋)。 */
export function parseJobListing(text: string): JobListingEntry[] {
  const json = extractJsonBlock(text);
  const obj = JSON.parse(json) as { jobs?: unknown };
  const rows = Array.isArray(obj.jobs) ? obj.jobs : [];
  const out: JobListingEntry[] = [];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const title = typeof r['title'] === 'string' ? r['title'].trim() : '';
    if (!title) continue;
    const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const b = (v: unknown): boolean => v === true;
    out.push({
      title,
      companyName: s(r['company']),
      url: s(r['url']),
      role: s(r['role']),
      location: s(r['location']),
      employmentType: s(r['employment_type']),
      snippet: s(r['snippet']),
      deadline: s(r['deadline']),
      newgrad: b(r['newgrad']),
      inexperiencedOk: b(r['inexperienced_ok']),
    });
  }
  return out;
}

/**
 * JobListingEntry → JobPostingItem。 詳細 URL があればそれを、 無ければ pageUrl#title を dedup キーにする
 * (同一ページ内で再掲を取りこぼさないため title を識別子に混ぜる)。
 *
 * opts.companyName: 募集元が既知のとき (recruit-page = 企業の自社採用ページ) に社名を固定する。
 *   自社ページの各求人に社名表記が無くても company_id 解決できるよう、 LLM 抽出値より優先する。
 * opts.kind: 出力する kind (既定 'job-listing')。 recruit-page ソースは 'recruit-page' を渡す。
 */
export function jobPostingFromListing(
  source: string,
  pageUrl: string,
  entry: JobListingEntry,
  opts: { companyName?: string; kind?: JobPostingItem['kind'] } = {},
): JobPostingItem | null {
  const title = entry.title.trim();
  if (!title) return null;
  const companyName = opts.companyName?.trim() || decodeEntities(entry.companyName);
  const url = entry.url || pageUrl;
  const dedupKey = entry.url
    ? normalizeUrl(entry.url)
    : `${normalizeUrl(pageUrl)}#${title}${companyName ? `@${companyName}` : ''}`;
  return {
    source,
    kind: opts.kind ?? 'job-listing',
    dedupKey,
    url,
    title,
    companyName,
    role: entry.role,
    location: entry.location,
    employmentType: entry.employmentType,
    snippet: entry.snippet.slice(0, 400),
    postedAt: '',
    deadline: entry.deadline,
  };
}
