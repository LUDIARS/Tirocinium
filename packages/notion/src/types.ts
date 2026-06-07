// Notion クローラーの型。 指定トークンで DB ID 配下のページを再帰クロールする。
// Notion 公式 REST API (https://api.notion.com/v1) を raw fetch で叩く (依存ゼロ → 流用容易)。

/** Notion rich_text 要素 (必要分のみ)。 */
export type NotionRichText = {
  plain_text?: string;
  [k: string]: unknown;
};

/** Notion block (必要分のみ。 type 固有フィールドは緩く持つ)。 */
export type NotionBlock = {
  id: string;
  type: string;
  has_children?: boolean;
  [k: string]: unknown;
};

/** Notion page object (DB row も page)。 */
export type NotionPage = {
  id: string;
  url?: string;
  archived?: boolean;
  properties?: Record<string, unknown>;
  parent?: { type?: string; database_id?: string; page_id?: string };
  [k: string]: unknown;
};

/** ページネーション結果。 */
export type Paged<T> = { results: T[]; next_cursor: string | null; has_more: boolean };

/**
 * crawl が依存する Notion API 操作 (DI 可能にしてテストで fake 差し替え)。
 * 実装は client.ts の NotionApiClient。
 */
export type NotionApi = {
  queryDatabase(databaseId: string, cursor?: string): Promise<Paged<NotionPage>>;
  getBlockChildren(blockId: string, cursor?: string): Promise<Paged<NotionBlock>>;
  retrievePage(pageId: string): Promise<NotionPage>;
};

export type CrawlOptions = {
  /** DB row から潜る最大深さ (row=0)。 既定 3 */
  maxDepth?: number;
  /** クロールする最大ページ数 (安全弁)。 既定 500 */
  maxPages?: number;
  /** child_database を見つけたら、 その DB の row も辿るか。 既定 true */
  includeChildDatabases?: boolean;
};

/** クロールで得た 1 ページ。 */
export type NotionCrawledPage = {
  id: string;
  url: string;
  title: string;
  /** 由来: DB の row か、 ページ内の子ページか */
  kind: 'database_row' | 'child_page';
  parentId: string;
  depth: number;
  /** ページ本文を Markdown 化したもの */
  markdown: string;
  /** プロパティを簡易 key→string に落としたもの (DB row の場合に有用) */
  properties: Record<string, string>;
};

export type CrawlError = { id: string; stage: string; message: string };

export type CrawlResult = {
  databaseId: string;
  pages: NotionCrawledPage[];
  errors: CrawlError[];
  /** 上限到達等で打ち切ったか */
  truncated: boolean;
};
