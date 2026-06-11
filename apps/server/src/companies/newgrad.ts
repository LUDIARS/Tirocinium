// 新卒採用者インタビュー記事を (1社最大100件) クロール保存し、
// 「会社が求める新卒像」 を **役職ごとに** 要約してテーブル化する。
//   seed URL → 1 hop で同種記事発見 → 礼節 fetch → htmlToText → 記事保存
//   → 保存記事を集約して LLM 要約 (role 別) → company_newgrad_role_images。
// 記事は再利用のため raw を残す。 要約のみ再実行する path (summarizeStoredNewgrad) もある。

import {
  selectInterviewLinks,
  normalizeUrl,
  NEWGRAD_ROLES_INSTRUCTION,
  parseNewgradRoles,
  htmlToText,
  extractTitle,
  type Company,
} from '@tirocinium/companies';
import type { PoliteFetcher } from './fetcher.js';
import type { Completer } from './llm-completer.js';
import {
  listInterviewArticles,
  upsertInterviewArticle,
  upsertNewgradRoleImage,
  type StoredArticle,
} from './newgrad-repo.js';

export type NewgradCrawlResult = {
  company: string;
  articlesStored: number;
  pagesFetched: number;
  robotsBlocked: number;
  roles: string[]; // 要約できた役職キー (general/programmer/...)
  error?: string;
};

const MAX_ARTICLE_CHARS = 6000;
const MAX_PROMPT_CHARS = 60000;
const MIN_BODY_CHARS = 200;

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** 保存済み記事から役職別の求める新卒像を要約して upsert する。 要約できた役職キーを返す。 */
export async function summarizeNewgradRoles(
  companyId: string,
  articles: StoredArticle[],
  completer: Completer,
  modelLabel: string,
): Promise<string[]> {
  if (articles.length === 0) return [];

  let prompt = '';
  let used = 0;
  for (let i = 0; i < articles.length; i++) {
    const a = articles[i]!;
    const block = `# 記事${i + 1}: ${a.title}\n${a.body}\n\n---\n\n`;
    if (prompt.length + block.length > MAX_PROMPT_CHARS) break;
    prompt += block;
    used++;
  }

  const roleImages = parseNewgradRoles(await completer(NEWGRAD_ROLES_INSTRUCTION, prompt));
  const doneRoles: string[] = [];
  for (const [role, img] of Object.entries(roleImages)) {
    if (!img) continue;
    await upsertNewgradRoleImage(companyId, role, { ...img, articleCount: used, model: modelLabel });
    doneRoles.push(role);
  }
  return doneRoles;
}

/** 1 社分: インタビュー記事クロール保存 → 役職別要約。 */
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
    roles: [],
  };

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

      if (depth === 0) {
        const links = selectInterviewLinks(url, res.html, max, /* allowCrossHost */ true);
        for (const l of links) {
          if (!visited.has(normalizeUrl(l))) queue.push({ url: l, depth: 1 });
        }
      }
    }

    const articles = await listInterviewArticles(company.id, max);
    result.roles = await summarizeNewgradRoles(company.id, articles, completer, opts.modelLabel);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
