/**
 * 企業×役職別『求める新卒像』データを SQLite から newgrad-viewer/data.js へエクスポートする。
 *
 * 使い方:
 *   npm run export:newgrad-data           # デフォルト (data/tirocinium.sqlite → newgrad-viewer/data.js)
 *   npm run export:newgrad-data -- --db data/tirocinium.sqlite --out newgrad-viewer/data.js
 */

import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");

interface Args {
  db: string;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    db: get("db") ?? resolve(ROOT, "data/tirocinium.sqlite"),
    out: get("out") ?? resolve(ROOT, "newgrad-viewer/data.js"),
  };
}

interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  size: string | null;
  url: string | null;
}

interface RoleImageRow {
  company_id: string;
  role: string;
  summary: string | null;
  themes: string | null;
  article_count: number;
}

interface ArticleRow {
  company_id: string;
  url: string;
  title: string | null;
  summary: string | null;
  published_at: string | null;
}

interface ExportRecord {
  id: string;
  name: string;
  industry: string;
  size: string;
  url: string;
  roles: Record<string, { summary: string; themes: string[]; articleCount: number }>;
  articles: Array<{ url: string; title: string; publishedAt: string }>;
}

function parseThemes(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[info] DB: ${args.db}`);

  const db = new DatabaseSync(args.db);

  // companies
  const companies = db.prepare("SELECT id, name, industry, size, url FROM companies ORDER BY name").all() as CompanyRow[];
  console.log(`[info] companies: ${companies.length}`);

  // company_newgrad_role_images
  const roleImages = db.prepare("SELECT company_id, role, summary, themes, article_count FROM company_newgrad_role_images").all() as RoleImageRow[];
  console.log(`[info] role images: ${roleImages.length}`);

  // company_interview_articles
  let articles: ArticleRow[] = [];
  try {
    articles = db.prepare("SELECT company_id, url, title, summary, published_at FROM company_interview_articles ORDER BY published_at DESC").all() as ArticleRow[];
    console.log(`[info] interview articles: ${articles.length}`);
  } catch {
    console.log("[info] company_interview_articles テーブルなし — スキップ");
  }

  db.close();

  // roleImages をインデックス化
  const roleMap = new Map<string, Record<string, { summary: string; themes: string[]; articleCount: number }>>();
  for (const r of roleImages) {
    if (!roleMap.has(r.company_id)) roleMap.set(r.company_id, {});
    roleMap.get(r.company_id)![r.role] = {
      summary: (r.summary ?? "").trim(),
      themes: parseThemes(r.themes),
      articleCount: r.article_count ?? 0,
    };
  }

  // articles をインデックス化
  const articleMap = new Map<string, Array<{ url: string; title: string; publishedAt: string }>>();
  for (const a of articles) {
    if (!articleMap.has(a.company_id)) articleMap.set(a.company_id, []);
    articleMap.get(a.company_id)!.push({
      url: a.url,
      title: (a.title ?? a.url).trim(),
      publishedAt: a.published_at ?? "",
    });
  }

  // 役職データがある企業のみ出力
  const records: ExportRecord[] = companies
    .filter((c) => roleMap.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      industry: (c.industry ?? "").trim(),
      size: (c.size ?? "").trim(),
      url: (c.url ?? "").trim(),
      roles: roleMap.get(c.id) ?? {},
      articles: (articleMap.get(c.id) ?? []).slice(0, 10),
    }));

  console.log(`[info] 出力対象: ${records.length} 企業`);

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `window.NEWGRAD = ${JSON.stringify(records, null, 2)};\n`, "utf-8");
  console.log(`[info] 書き出し: ${args.out}`);
}

main();
