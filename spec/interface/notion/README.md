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

## 3. 設定取得 (Excubitor secret-agent 経由、 env 不使用)

クローラーの設定 (Notion token / DB ID / オプション) は **Excubitor secret-agent から
runtime で取得**する (`@tirocinium/secrets`)。env もファイルも使わない。

```
service code 'tirocinium' の Infisical マッピングに以下を入れる:
  NOTION_TOKEN, NOTION_DATABASE_ID,
  NOTION_VERSION?, NOTION_MIN_INTERVAL_MS?, NOTION_MAX_DEPTH?, NOTION_MAX_PAGES?, NOTION_INCLUDE_CHILD_DB?
```

起動時に `resolveSecrets('tirocinium', { keys: [...] })` で agent (`POST /api/v1/secrets/resolve`)
を叩き、 値は process memory にのみ載せる。agent / token の解決は [[Excubitor secret-agent]]
(`spec/secret-agent.md` 相当) と同じ規約: `EXCUBITOR_URL` (既定 127.0.0.1:17332) +
`EXCUBITOR_AGENT_TOKEN` or token ファイル。

## 4. CLI (`scripts/notion-crawl`)

```
npm run notion-crawl                    # 全て agent から (NOTION_DATABASE_ID 含む)
npm run notion-crawl -- <DATABASE_ID>   # DB ID だけ明示、 token は agent
npm run notion-crawl -- --token secret_x <DATABASE_ID>   # token 明示 (agent 回避・緊急用)
```

| option | 説明 |
|---|---|
| `--service <code>` | secret-agent の service code (既定 `tirocinium`) |
| `--token <t>` | Notion token 明示。 **指定時は agent を引かない** (緊急/オフライン用) |
| `--max-depth <n>` / `--max-pages <n>` / `--no-child-db` | クロール範囲 (agent 値を上書き) |
| `--out <dir>` (既定 `data/notion`) / `--stdout` | 出力 |

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
