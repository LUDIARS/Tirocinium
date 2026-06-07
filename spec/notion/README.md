# notion — Notion クローラー

指定した Notion integration トークンで、 渡された **Database ID 配下のページを再帰クロール**して
構造化出力するライブラリ + CLI。 Notion 公式 REST API を **依存ゼロ (raw fetch)** で叩く。

略称 **Tr**。 取得層は依存を持たないため将来の共通スクレイピング lib へ抽出しやすい構造
(方針A: Tr 先行実装 → 後で Di/Quaestor と共通化)。

---

## 1. パッケージ構成 (`packages/notion`)

| ファイル | 役割 | 純粋 |
|---|---|---|
| `types.ts` | `NotionApi` (DI 用 IF) / `CrawlOptions` / `NotionCrawledPage` / `CrawlResult` | ✓ |
| `client.ts` | `NotionApiClient` — REST 呼び出し + レート制限 + 429/5xx リトライ | (fetch) |
| `crawl.ts` | `crawlDatabase` — DB row 起点に再帰クロール (NotionApi 注入) | ほぼ |
| `blocks.ts` | block[] → Markdown | ✓ |
| `page.ts` | properties → title 抽出 / key→string 簡易化 | ✓ |

`NotionApi` を IF として注入するため、 `crawl.ts` は実 API なしで単体テスト可能 (fake client)。

---

## 2. クロール仕様

```
crawlDatabase(api, databaseId, opts)
  1. databases.query で DB の全 row を取得 (ページネーション) → depth 0 の起点
  2. 各ページ:
     - blocks.children を再帰取得 → Markdown 化 (toggle/column 等の入れ子も展開)
     - child_page block → 下位ページ (depth+1) として queue に追加
     - child_database block → (includeChildDatabases) その DB の row を queue に追加
  3. visited で重複排除 (循環リンクでも無限ループしない)
  4. maxPages 到達で truncated=true で打ち切り
→ CrawlResult { databaseId, pages[], errors[], truncated }
```

`NotionCrawledPage`: `{ id, url, title, kind('database_row'|'child_page'), parentId, depth, markdown, properties }`。

### オプション (`CrawlOptions`)
| key | 既定 | 説明 |
|---|---|---|
| `maxDepth` | 3 | DB row から潜る深さ (row=0) |
| `maxPages` | 500 | 最大ページ数 (安全弁) |
| `includeChildDatabases` | true | child_database の row も辿るか |

### 堅牢性
- 1 ページの取得失敗は `errors[]` に記録して**全体は止めない** (best-effort)。
- `archived` ページは skip。
- レート制限: 最小間隔 (既定 350ms ≒ 3 req/s) + 429 の `Retry-After` / 5xx 指数バックオフ。

---

## 3. CLI (`scripts/notion-crawl`)

```
NOTION_TOKEN=secret_xxx npm run notion-crawl -- <DATABASE_ID> [options]
```

| option | 説明 |
|---|---|
| `--token <t>` | トークン (env `NOTION_TOKEN` でも可) |
| `--max-depth <n>` / `--max-pages <n>` | クロール範囲 |
| `--no-child-db` | child_database を辿らない |
| `--out <dir>` | 出力先 (既定 `data/notion`) |
| `--stdout` | ファイルに書かず標準出力へ |

出力は `data/notion/<DATABASE_ID>/<timestamp>.json` (= `CrawlResult`)。
**private なページ内容を含むため `data/notion/` は gitignore** 済。

---

## 4. 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `NOTION_TOKEN` | — | Notion integration token (必須) |
| `NOTION_VERSION` | `2022-06-28` | Notion-Version ヘッダ |
| `NOTION_MIN_INTERVAL_MS` | 350 | API 最小間隔 |

事前準備: Notion で integration を作成し、 対象 Database を integration に **Connection 共有**しておく
(共有していない DB / ページは API から見えない)。

---

## 5. 想定 consumer / 将来

- 単体 CLI として構造化 JSON を出力 (本 PR の範囲)。
- 将来: Tr の training_data 取込 (ES/portfolio を Notion から) や Memoria RAG への投入は別タスク。
- 取得層 ([[]] client/crawl) は [[project_shared_scraping_lib]] の共通化候補。
