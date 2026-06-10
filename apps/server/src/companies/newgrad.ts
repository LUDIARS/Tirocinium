// 新卒採用者インタビュー記事を (1社最大100件) クロール保存し、
// 「会社が求める新卒像」 を要約して保存する。
//   seed URL → 1 hop で同種記事を発見 → 礼節 fetch → htmlToText → 記事保存
//   → 保存記事を集約して LLM 要約 (backend は cli/api 自動) → company_newgrad_images。

import {
  selectInterviewLinks,
  normalizeUrl,
  NEWGRAD_IMAGE_INSTRUCTION,
  parseNewgradImage,
  htmlToText,
  extractTitle,
  type Company,
} from '@tirocinium/companies';
import type { PoliteFetcher } from './fetcher.js';
import type { Completer } from './llm-completer.js';
import { listInterviewArticles, upsertInterviewArticle, upsertNewgradImage } from './newgrad-repo.js';

export type NewgradCrawlResult = {
  company: string;
  articlesStored: number;
  pagesFetched: number;
  robotsBlocked: number;
  summarized: boolean;
  error?: string;
};

const MAX_ARTICLE_CHARS = 6000; // 1 記事あたり本文上限
const MAX_PROMPT_CHARS = 60000; // 要約プロンプトへ渡す総量上限 (token 暴発防止)
const MIN_BODY_CHARS = 200; // これ未満は記事とみなさない (索引ページ等を除外)

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** 1 社分: インタビュー記事クロール保存 → 要約。 */
export async function crawlAndSummarizeNewgrad(opts: {
  company: Company;
  seedUrls: string[];
  maxArticles?: number;
  fetcher: PoliteFetcher;
  completer: Completer;
  modelLabel: string;
}): Promise<NewgradCrawlResult> {
  const { company, fetcher, completer } = opts;
  const max = clamp(opts.maxArticles ?? 100, 1, 100);
  const result: NewgradCrawlResult = {
    company: company.name,
    articlesStored: 0,
    pagesFetched: 0,
    robotsBlocked: 0,
    summarized: false,
  };

  // seed を起点に 1 hop で記事候補を広げつつ、 本文のあるページを保存する。
  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = opts.seedUrls
    .filter(Boolean)
    .map((u) => ({ url: u, depth: 0 }));

  try {
    while (queue.length > 0 && result.articlesStored < max) {
      const { url, depth } = queue.shift()!;
      const nurl = normalizeUrl(url);
      if (visited.has(nurl)) continue;
      visited.add(nurl);

      const res = await fetcher.fetch(url);
      if (!res.ok) {
        if (res.reason === 'robots') result.robotsBlocked++;
        continue;
      }
      result.pagesFetched++;

      const body = htmlToText(res.html, MAX_ARTICLE_CHARS);
      if (body.length >= MIN_BODY_CHARS) {
        await upsertInterviewArticle(company.id, {
          url,
          normalizedUrl: nurl,
          title: extractTitle(res.html),
          body,
        });
        result.articlesStored++;
      }

      // seed ページ (depth 0) からのみ同種記事リンクを 1 hop 展開する。
      if (depth === 0) {
        const links = selectInterviewLinks(url, res.html, max, /* allowCrossHost */ true);
        for (const l of links) {
          if (!visited.has(normalizeUrl(l))) queue.push({ url: l, depth: 1 });
        }
      }
    }

    // 保存済み記事を集約して要約。
    const articles = await listInterviewArticles(company.id, max);
    if (articles.length === 0) return result;

    let prompt = '';
    const used: string[] = [];
    for (let i = 0; i < articles.length; i++) {
      const a = articles[i]!;
      const block = `# 記事${i + 1}: ${a.title}\n${a.body}\n\n---\n\n`;
      if (prompt.length + block.length > MAX_PROMPT_CHARS) break;
      prompt += block;
      used.push(a.url);
    }

    const image = parseNewgradImage(await completer(NEWGRAD_IMAGE_INSTRUCTION, prompt));
    if (image.summary) {
      await upsertNewgradImage(company.id, {
        ...image,
        sources: used,
        articleCount: used.length,
        model: opts.modelLabel,
      });
      result.summarized = true;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
