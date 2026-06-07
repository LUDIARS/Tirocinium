// DB ID 配下のページを再帰クロールする本体。 NotionApi は注入 (テストで fake 可)。
// DB の各 row を起点に、 ページ内の child_page / child_database を maxDepth まで辿る。

import { blocksToMarkdown } from './blocks.js';
import { extractTitle, simplifyProperties } from './page.js';
import type {
  CrawlError,
  CrawlOptions,
  CrawlResult,
  NotionApi,
  NotionBlock,
  NotionCrawledPage,
  NotionPage,
} from './types.js';

type QueueItem = {
  id: string;
  kind: NotionCrawledPage['kind'];
  parentId: string;
  depth: number;
  /** DB query で既に取得済の page object (あれば retrievePage を省ける) */
  page?: NotionPage;
};

/** DB の全 row を取得 (ページネーション)。 */
async function queryAllRows(api: NotionApi, databaseId: string): Promise<NotionPage[]> {
  const out: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const res = await api.queryDatabase(databaseId, cursor);
    out.push(...res.results);
    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

/** block の全 children を取得 (ページネーション)。 */
async function allChildren(api: NotionApi, blockId: string): Promise<NotionBlock[]> {
  const out: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const res = await api.getBlockChildren(blockId, cursor);
    out.push(...res.results);
    cursor = res.has_more && res.next_cursor ? res.next_cursor : undefined;
  } while (cursor);
  return out;
}

type PageContent = {
  flat: { block: NotionBlock; indent: number }[];
  childPageIds: string[];
  childDatabaseIds: string[];
};

/**
 * 1 ページの block ツリーを再帰収集する。
 * - child_page / child_database は「下位ページ」として id を集め、 中には潜らない (queue が処理)。
 * - それ以外の has_children (toggle/column 等) は本ページの一部として再帰展開する。
 */
async function collectContent(api: NotionApi, rootId: string): Promise<PageContent> {
  const flat: { block: NotionBlock; indent: number }[] = [];
  const childPageIds: string[] = [];
  const childDatabaseIds: string[] = [];

  const walk = async (blockId: string, indent: number): Promise<void> => {
    const blocks = await allChildren(api, blockId);
    for (const block of blocks) {
      flat.push({ block, indent });
      if (block.type === 'child_page') {
        childPageIds.push(block.id);
        continue; // 下位ページは別途クロール
      }
      if (block.type === 'child_database') {
        childDatabaseIds.push(block.id);
        continue;
      }
      if (block.has_children) {
        await walk(block.id, indent + 1);
      }
    }
  };

  await walk(rootId, 0);
  return { flat, childPageIds, childDatabaseIds };
}

/** DB ID 配下のページをクロールする。 */
export async function crawlDatabase(
  api: NotionApi,
  databaseId: string,
  opts: CrawlOptions = {},
): Promise<CrawlResult> {
  const maxDepth = opts.maxDepth ?? 3;
  const maxPages = opts.maxPages ?? 500;
  const includeChildDatabases = opts.includeChildDatabases ?? true;

  const pages: NotionCrawledPage[] = [];
  const errors: CrawlError[] = [];
  const visited = new Set<string>();
  const queue: QueueItem[] = [];
  let truncated = false;

  // 起点: DB の row
  try {
    const rows = await queryAllRows(api, databaseId);
    for (const page of rows) {
      queue.push({ id: page.id, kind: 'database_row', parentId: databaseId, depth: 0, page });
    }
  } catch (err) {
    errors.push({ id: databaseId, stage: 'queryDatabase', message: (err as Error).message });
  }

  while (queue.length > 0) {
    if (pages.length >= maxPages) {
      truncated = true;
      break;
    }
    const item = queue.shift()!;
    if (visited.has(item.id)) continue;
    visited.add(item.id);

    let page = item.page;
    if (!page) {
      try {
        page = await api.retrievePage(item.id);
      } catch (err) {
        errors.push({ id: item.id, stage: 'retrievePage', message: (err as Error).message });
        continue;
      }
    }
    if (page.archived) continue;

    let content: PageContent;
    try {
      content = await collectContent(api, item.id);
    } catch (err) {
      errors.push({ id: item.id, stage: 'collectContent', message: (err as Error).message });
      content = { flat: [], childPageIds: [], childDatabaseIds: [] };
    }

    pages.push({
      id: item.id,
      url: typeof page.url === 'string' ? page.url : '',
      title: extractTitle(page),
      kind: item.kind,
      parentId: item.parentId,
      depth: item.depth,
      markdown: blocksToMarkdown(content.flat),
      properties: simplifyProperties(page),
    });

    if (item.depth >= maxDepth) continue;

    for (const cp of content.childPageIds) {
      if (!visited.has(cp)) {
        queue.push({ id: cp, kind: 'child_page', parentId: item.id, depth: item.depth + 1 });
      }
    }
    if (includeChildDatabases) {
      for (const cdb of content.childDatabaseIds) {
        try {
          const rows = await queryAllRows(api, cdb);
          for (const row of rows) {
            if (!visited.has(row.id)) {
              queue.push({ id: row.id, kind: 'database_row', parentId: cdb, depth: item.depth + 1, page: row });
            }
          }
        } catch (err) {
          errors.push({ id: cdb, stage: 'queryChildDatabase', message: (err as Error).message });
        }
      }
    }
  }

  return { databaseId, pages, errors, truncated };
}
