// 情報提供ウインドウ: ユーザが渡したリンクを取得→キャッシュ→LLM分類 (企業/ゲーム/新卒) して
// 対象企業へ情報を追加する配線 (IO + DB)。 分類/抽出の純パースは @tirocinium/companies に委譲。
// 取得は PoliteFetcher (robots + SSRF guard + レート)。 company_id スコープ (どの企業への提供か)。

import {
  LINK_CLASSIFY_INSTRUCTION,
  parseLinkContribution,
  normalizeUrl,
  normalizeGame,
  htmlToText,
  extractTitle,
  type LinkContribution,
} from '@tirocinium/companies';
import { config } from '../config.js';
import { PoliteFetcher } from './fetcher.js';
import { createCompleter, type Completer } from './llm-completer.js';
import { getCachedLink, putCachedLink } from './cache-repo.js';
import { getCompany, updateCompanyInfo } from './repo.js';
import { upsertGame, getGameByNormalizedTitle, linkCompanyGame } from './games-repo.js';
import { upsertInterviewArticle } from './newgrad-repo.js';

/** 1 リンク分の処理結果。 */
export type LinkResult = {
  url: string;
  type: LinkContribution['type'];
  /** 実際に DB へ反映したか */
  applied: boolean;
  /** 何をしたか / なぜ skip したか (人間向け) */
  detail: string;
};

export type ContributeSummary = {
  company: string;
  processed: number;
  applied: number;
  results: LinkResult[];
};

/** テスト用に差し替え可能な依存。 省略時は実 fetcher / LLM completer。 */
export type ContributeDeps = {
  fetchPage?: (url: string) => Promise<{ ok: true; html: string } | { ok: false; message: string }>;
  completer?: Completer;
};

const MAX_LINKS = 8;
const MAX_BODY = 12_000; // 分類に渡す本文上限

/** 1 リンクを取得 (cache 優先) して本文を返す。 */
async function loadContent(
  url: string,
  fetchPage: NonNullable<ContributeDeps['fetchPage']>,
): Promise<{ title: string; body: string } | { error: string }> {
  const cached = await getCachedLink(url);
  if (cached) return { title: cached.title, body: cached.content_text };
  const res = await fetchPage(url);
  if (!res.ok) return { error: res.message };
  const title = extractTitle(res.html);
  const body = htmlToText(res.html).slice(0, MAX_BODY);
  await putCachedLink(url, { normalizedUrl: normalizeUrl(url), title, contentText: body });
  return { title, body };
}

/** 分類結果を対象企業へ反映する。 */
async function applyContribution(
  companyId: string,
  url: string,
  title: string,
  c: LinkContribution,
): Promise<LinkResult> {
  if (c.type === 'company') {
    const updated = await updateCompanyInfo(companyId, {
      description: c.description,
      industry: c.industry,
      url, // このリンク自体を会社 URL 候補にする (以後の自動 enrich を可能に)
      location: c.location,
    });
    return { url, type: c.type, applied: updated, detail: `企業情報を追記 (${c.description ? '概要あり' : '概要なし'})` };
  }
  if (c.type === 'game') {
    const game = normalizeGame({ title: c.name, series: c.series, genre: '', source: 'contribute', source_url: url });
    if (!game) return { url, type: c.type, applied: false, detail: 'ゲーム名を抽出できず' };
    await upsertGame(game);
    const node = await getGameByNormalizedTitle(game.normalized_title);
    if (!node) return { url, type: c.type, applied: false, detail: 'ゲーム登録に失敗' };
    await linkCompanyGame(companyId, node.id, 'credited', 'contribute');
    return { url, type: c.type, applied: true, detail: `ゲーム「${game.title}」に credited で関連付け` };
  }
  if (c.type === 'newgrad') {
    await upsertInterviewArticle(companyId, {
      url, normalizedUrl: normalizeUrl(url), title: c.name || title, body: c.description, source: 'contribute',
    });
    return { url, type: c.type, applied: true, detail: '新卒インタビュー記事として保存 (新卒像生成の素材)' };
  }
  return { url, type: 'other', applied: false, detail: c.reason || '企業/ゲーム/新卒のいずれにも該当せず' };
}

/**
 * company_id に対し links を取り込む。 各リンクを分類して企業/ゲーム/新卒情報を追加する。
 */
export async function runContribute(
  companyId: string,
  links: string[],
  deps: ContributeDeps = {},
): Promise<ContributeSummary> {
  const company = await getCompany(companyId);
  if (!company) throw new Error('company not found');

  const fetchPage =
    deps.fetchPage ??
    (async (url: string) => {
      const fetcher = new PoliteFetcher({
        userAgent: config.companyCrawl.userAgent,
        fetchTimeoutMs: config.companyCrawl.fetchTimeoutMs,
        minIntervalMs: config.companyCrawl.minIntervalMs,
        respectRobots: config.companyCrawl.respectRobots,
      });
      const r = await fetcher.fetch(url);
      return r.ok ? { ok: true as const, html: r.html } : { ok: false as const, message: r.message };
    });
  const completer = deps.completer ?? createCompleter('EXTRACTOR').complete;

  // 入力 URL を正規化 dedup + 上限。
  const seen = new Set<string>();
  const urls = links
    .map((u) => u.trim())
    .filter(Boolean)
    .filter((u) => {
      const key = normalizeUrl(u);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_LINKS);

  const results: LinkResult[] = [];
  for (const url of urls) {
    try {
      const loaded = await loadContent(url, fetchPage);
      if ('error' in loaded) {
        results.push({ url, type: 'other', applied: false, detail: `取得失敗: ${loaded.error}` });
        continue;
      }
      const classified = parseLinkContribution(await completer(LINK_CLASSIFY_INSTRUCTION, loaded.body));
      results.push(await applyContribution(companyId, url, loaded.title, classified));
    } catch (err) {
      results.push({ url, type: 'other', applied: false, detail: `エラー: ${(err as Error).message}` });
    }
  }

  return {
    company: company.name,
    processed: results.length,
    applied: results.filter((r) => r.applied).length,
    results,
  };
}
