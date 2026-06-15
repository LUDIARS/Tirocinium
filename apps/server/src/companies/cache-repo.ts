// link_cache (ユーザ提供リンクの取得キャッシュ) の read/write。 migration 013。
// 同一 URL の再取得を避け、 LLM 分類の入力本文を一定期間使い回す。

import { sql } from '../db/index.js';

export type CachedLink = { url: string; title: string; content_text: string; fetched_at: string };

/** キャッシュを引く。 maxAgeMs より古ければ null (再取得させる)。 */
export async function getCachedLink(url: string, maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<CachedLink | null> {
  const rows = await sql<CachedLink[]>`
    SELECT url, title, content_text, fetched_at FROM link_cache WHERE url = ${url}
  `;
  const row = rows[0];
  if (!row) return null;
  const age = Date.now() - new Date(row.fetched_at).getTime();
  if (Number.isFinite(age) && age > maxAgeMs) return null;
  return row;
}

/** 取得結果をキャッシュに upsert する。 */
export async function putCachedLink(
  url: string,
  data: { normalizedUrl: string; title: string; contentText: string },
): Promise<void> {
  await sql`
    INSERT INTO link_cache (url, normalized_url, title, content_text)
    VALUES (${url}, ${data.normalizedUrl}, ${data.title}, ${data.contentText})
    ON CONFLICT (url) DO UPDATE SET
      normalized_url = EXCLUDED.normalized_url,
      title          = EXCLUDED.title,
      content_text   = EXCLUDED.content_text,
      fetched_at     = now()
  `;
}
