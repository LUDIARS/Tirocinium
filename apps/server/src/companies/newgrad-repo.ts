// インタビュー記事 (raw) + 求める新卒像サマリ の永続化。 migration 005。

import { sql } from '../db/index.js';
import type { NewgradImage } from '@tirocinium/companies';

export type StoredArticle = { url: string; title: string; body: string };

/** 記事を持つ会社 (id, name) を返す。 summarize-only 用。 */
export async function companiesWithArticles(): Promise<{ id: string; name: string }[]> {
  return sql<{ id: string; name: string }[]>`
    SELECT c.id, c.name FROM companies c
    WHERE EXISTS (SELECT 1 FROM company_interview_articles a WHERE a.company_id = c.id)
    ORDER BY c.name
  `;
}

/** 会社 × 役職 の求める新卒像を upsert (テーブル化、 role='general' が会社全体)。 */
export async function upsertNewgradRoleImage(
  companyId: string,
  role: string,
  v: NewgradImage & { articleCount: number; model: string },
): Promise<void> {
  await sql`
    INSERT INTO company_newgrad_role_images (company_id, role, summary, themes, article_count, model)
    VALUES (${companyId}, ${role}, ${v.summary}, ${sql.json(v.themes)}, ${v.articleCount}, ${v.model})
    ON CONFLICT (company_id, role) DO UPDATE SET
      summary       = EXCLUDED.summary,
      themes        = EXCLUDED.themes,
      article_count = EXCLUDED.article_count,
      model         = EXCLUDED.model,
      fetched_at    = now()
  `;
}

/** クロールしたインタビュー記事を保存 (再利用のため raw を残す)。 (company_id, normalized_url) で冪等。 */
export async function upsertInterviewArticle(
  companyId: string,
  a: { url: string; normalizedUrl: string; title: string; body: string; source?: string },
): Promise<void> {
  await sql`
    INSERT INTO company_interview_articles (company_id, url, normalized_url, title, body, source)
    VALUES (${companyId}, ${a.url}, ${a.normalizedUrl}, ${a.title}, ${a.body}, ${a.source ?? 'interview-crawl'})
    ON CONFLICT (company_id, normalized_url) DO UPDATE SET
      title = EXCLUDED.title,
      body  = EXCLUDED.body,
      fetched_at = now()
  `;
}

export type StoredNewgradRoleImage = {
  role: string;
  summary: string;
  themes: string[];
  article_count: number;
  model: string;
  fetched_at: string;
};

/** 会社の役職別新卒像を全件取得。 */
export async function getNewgradRoleImages(companyId: string): Promise<StoredNewgradRoleImage[]> {
  return sql<StoredNewgradRoleImage[]>`
    SELECT role, summary, themes, article_count, model, fetched_at
    FROM company_newgrad_role_images
    WHERE company_id = ${companyId}
    ORDER BY role
  `;
}

/** 会社の保存済みインタビュー記事を取得 (要約・他機能の素材)。 */
export async function listInterviewArticles(companyId: string, limit = 200): Promise<StoredArticle[]> {
  return sql<StoredArticle[]>`
    SELECT url, title, body FROM company_interview_articles
    WHERE company_id = ${companyId}
    ORDER BY fetched_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 500)}
  `;
}

/** 会社が求める新卒像サマリを upsert (companies と 1:1)。 */
export async function upsertNewgradImage(
  companyId: string,
  v: NewgradImage & { sources: string[]; articleCount: number; model: string },
): Promise<void> {
  await sql`
    INSERT INTO company_newgrad_images (company_id, summary, themes, sources, article_count, model)
    VALUES (${companyId}, ${v.summary}, ${sql.json(v.themes)}, ${sql.json(v.sources)}, ${v.articleCount}, ${v.model})
    ON CONFLICT (company_id) DO UPDATE SET
      summary       = EXCLUDED.summary,
      themes        = EXCLUDED.themes,
      sources       = EXCLUDED.sources,
      article_count = EXCLUDED.article_count,
      model         = EXCLUDED.model,
      fetched_at    = now()
  `;
}
