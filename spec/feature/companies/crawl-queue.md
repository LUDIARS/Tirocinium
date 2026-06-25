# 企業クロールキュー (crawl queue)

URL を投入すると企業情報をクロールして `companies` に upsert する常駐 worker と、その待ち行列。
「URL を渡したら会社をクロールする」機構 (`runCrawl({ source: 'manual', urls })`) を、
同期実行ではなく**キュー化**して投入即時応答 + 進捗可視化できるようにしたもの。

## 目的

- 企業の公式サイト / 採用ページの URL を渡すだけで `companies` に取り込めるようにする。
- **Web 取得は直列** (1 件ずつ)。 理由は ①同一 URL の重複リクエストを無駄に処理しない ②対象サイトへの負荷を抑える。
- 投入と処理を分離し、 HTTP は即時 202 を返す (重いクロールでリクエストを待たせない)。

## データモデル (migration 022)

`crawl_jobs`:

| 列 | 用途 |
|---|---|
| `url` | クロール対象 URL |
| `name_hint` | 既知の社名 (抽出ヒント、 任意) |
| `source` | crawl source id (`manual` / `seed-file` 等) |
| `status` | `queued` → `running` → `done` / `failed` |
| `max_pages` | per-job のページ上限 (NULL は config 既定) |
| `attempts` | 試行回数 (`crawlQueue.maxAttempts` で打ち切り) |
| `summary` | 完了時の `CrawlSummary` (JSON 文字列) |
| `error` | 失敗理由 (最終) |
| `requested_by` | 投入者 Cernere user id (任意) |
| `enqueued_at` / `started_at` / `finished_at` | 投入 / 開始 / 終了時刻 |

重複畳み込み: 部分 unique index `uq_crawl_jobs_active_url` が `status IN ('queued','running')` の
同一 URL を 1 件に制限する。 enqueue は先に active job を引いて再利用し、 競合は index を砦にする。
`done` / `failed` 後は active でないため同 URL を再投入できる (再クロール可)。

## 処理フロー

- `enqueueCrawl(input)` (`companies/crawl-queue-repo.ts`): active な同 URL があれば再利用 (`deduped=true`)、
  無ければ `queued` で INSERT。
- worker `startCrawlQueue()` (`companies/crawl-queue.ts`): `crawlQueue.intervalMs` 毎に
  `claimNextCrawlJob()` で最古の `queued` を 1 件だけ `running` に進め (attempts++)、
  `runCrawl({ source, urls:[url] })` を実行。 成功で `markCrawlDone` (summary 保存)、
  例外は `markCrawlFailed` (maxAttempts 未満は `queued` に戻して再試行、 到達で `failed` 確定)。
- tick は多重実行防止フラグで直列を保証する (enrich-queue.ts と同型)。

## 子クローラ連鎖 (chain enrich)

`crawlQueue.chainEnrich`(既定 true)のとき、 worker は企業 upsert 後に **CLI 子クローラ**を
detached spawn して、その企業を深掘りする (migration 023 で `crawl_jobs.child_*` を追跡)。
Web 本体 (server) は spawn するだけでブロックしない。 子は **cli backend (`claude -p`) 固定**で、
Web 本体の LLM backend (api/cli) に依存しない。

- `runCrawl` は upsert できた企業 id (`upsertedCompanyIds`) を返す。 worker はその id ごとに
  `spawnChildEnrich(jobId, companyId)`(`child-enrich-spawn.ts`)を呼ぶ。
- 子 = `scripts/company-enrich`(`npm run companies:enrich-chain -- --company-id <id> [--job-id <id>]`)。
  フルチェーン `runCompanyEnrichChain`(`enrich-chain.ts`):
  1. **発見** (`site-discover.ts`): sitemap (index は 1 段再帰)→ works / career / about に分類。
     一覧 (`/works/` `/career/`) は JS描画SPAで本文が薄いため個別ページ (slug 付き) を優先。 空ならトップページ走査にフォールバック。
  2. **ゲーム紐付け + 企業情報**: `contribute`(works + about、 cli LLM)→ `company_game` 紐付け + 企業概要更新。
  3. **求人**: career URL をアドホック `recruit-page` ソース (`newgradOnly=false`) にして `runJobNewsCrawl(undefined, sources)` で全求人抽出。
- 子の状態は `crawl_jobs.child_status`(none→spawned→running→done/failed)+ `child_log`(ログパス)+ `child_detail`(1行サマリ)。 ログは `logs/company-enrich/<jobId>.log`。
- 精度: ゲーム紐付け・企業情報は安定。 求人の自動検出はサイト構造依存の best-effort(curated な `news-sources.json` の recruit-page が精密な経路)。

## API

| メソッド | パス | 役割 |
|---|---|---|
| `POST` | `/api/v1/companies/crawl` | URL をキューに投入 (即時 202)。 `{ source?, urls?, maxPages? }`。 `seed-file` はサーバ側 seed の URL を投入。 戻り `{ enqueued, deduped, jobs[] }` |
| `GET` | `/api/v1/companies/crawl-queue/status` | 件数 (`queued/running/done/failed`) + 直近ジョブ + worker 稼働状態 |

`POST /crawl` は `COMPANY_CRAWL_ADMIN_IDS` 設定時はその user に限定 (外部 fetch を伴うため)。

## 可視化

デスクトップアプリ `Companies.tsx` に:

- 「URL から企業を追加」フォーム (textarea に 1 行 1 URL → `POST /crawl`)。
- crawl-queue バナー (10 秒ポーリングで `crawl-queue/status` を表示。 待ち / 処理中 / 直近結果)。

enrich-queue (概要なし企業の自動 enrich) とは別系統。 enrich は既存企業の補完、 crawl-queue は URL からの新規取り込み。

## config (`crawlQueue`)

| キー | 既定 | 意味 |
|---|---|---|
| `enabled` | true | worker を起動するか |
| `intervalMs` | 15000 | 次の 1 件を取り出す間隔 (礼節) |
| `maxAttempts` | 3 | 失敗時の最大試行回数 |
