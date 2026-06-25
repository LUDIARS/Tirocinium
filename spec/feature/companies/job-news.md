# 求人ニュース クロール (job postings)

ゲーム業界ニュース系サイトから採用・求人情報をクロールし、 新着求人を検出して
Web 表示 + Nuntius 通知する機構。 既存の listing クロール (企業発見) とは別系統。

## 目的と粒度

- 「求人サイトの新規求人情報をサマって通知する」 を実現する。
- 新着判定は **差分検知**: ソースを定期取得し、 `dedup_key` が未登録のものを「新着」とする。
- 既存の `companies` / `company_interview_articles` とは独立した `job_postings` テーブルに保持。
  社名が DB の企業に解決できれば `company_id` を埋める (任意リンク)。

## ソース (data/companies/news-sources.json)

config 駆動。 サイト追加は JSON 編集のみ。 3 種をサポートする。

| kind | 取得 | 抽出 | LLM | 例 |
|---|---|---|---|---|
| `rss` | RSS2.0 / RDF(RSS1.0) / Atom フィード | `parseFeed` (依存ゼロ) + `isHiringNews` で採用関連だけ抽出 | 不要 | gamebiz-rss / gamebusiness-rss |
| `job-listing` | 求人一覧 HTML ページ | `htmlToText`→`chunkText`→`extractJobListing` (LLM) で個別求人を抽出 | 必須 | gamebiz-jobs |
| `recruit-page` | 企業の自社採用ページ HTML | `job-listing` と同じ LLM 抽出。 社名は `company` で固定 (LLM 抽出より優先) | 必須 | melpot-career / linkedbrain-recruit |

`recruit-page` は **aggregator (RSS / 求人まとめ) に載らない規模の企業**を継続追従するための直クロール。
募集元が自明なので `company` フィールドで社名を固定し、 自社ページの各求人に社名表記が無くても
`company_id` を解決できる。 `job-listing` と同じく「現在の掲載」スナップショット置換 (重複累積を防ぐ)。

検証済みソース (robots/RSS を実確認):

- **gamebiz-rss** `https://gamebiz.jp/feed.rss` — ニュース RSS。 robots は `/enterprise/` `/enter-enter/` のみ禁止、 feed は許可。 既定 enabled。
- **gamebusiness-rss** `https://www.gamebusiness.jp/rss/index.rdf` — RDF。 robots は `/test/` のみ禁止 (ClaudeBot Crawl-delay 5)。 既定 enabled。
- **gamebiz-jobs** `https://gamebiz.jp/jobs` — 業界求人情報 (企業/職種/勤務地/雇用形態/募集期間)。 LLM 必須のため既定 disabled、 `COMPANY_JOB_NEWS_OPTIN_SOURCES=gamebiz-jobs` で opt-in。
- **melpot-career** `https://melpot.com/career/` — 株式会社メルポット (ブランド表記 MELPOT) の自社採用ページ。 `company` は正式名称 (メルポット) に合わせる (クロールも公式サイトからこの名で企業生成するため `company_id` が解決できる)。 robots 許可 (Disallow は `/*/_template.html` のみ)・証明書有効。 ⚠ `melpot.co.jp` は証明書が 2024-08 失効のため使わない (正は `melpot.com`)。 既定 enabled。
- **linkedbrain-recruit** `https://linkedbrain.jp/recruit/student` — 株式会社リンクトブレイン の新卒採用ページ。 robots 全許可。 既定 enabled。

`rss` の `hiringOnly`(既定 true) は HIRING_KEYWORDS (求人/採用/転職/中途/新卒/内定/雇用/採用説明会…) で
**タイトル + カテゴリ** を判定し、 採用関連ニュースだけを取り込む。 本文(description)は判定に使わない
— まとめ記事・ランキングが本文に採用語を巻き込んで誤検出するため。 単独の「募集」(ガチャ/イベント募集) や
「人材」「job」 のようにゲーム文脈で誤爆する語は採らず精度を優先する (recall は job-listing ソースが担保)。

## データモデル (migration 018)

`job_postings`:

| 列 | 用途 |
|---|---|
| `dedup_key` UNIQUE | 冪等キー。 rss=`normalizeUrl(link)`、 job-listing=詳細URL or `pageUrl#title@company` |
| `source` / `kind` | ソース id と種別 |
| `url` / `title` / `snippet` | 表示・遷移先 |
| `company_name` / `company_id` | 抽出社名 + 解決できた企業 (normalized_name 突合) |
| `role` / `location` / `employment_type` / `deadline` | job-listing で埋まる構造化フィールド |
| `posted_at` | rss の pubDate (ISO) |
| `notified` | Nuntius 通知済みフラグ |
| `first_seen_at` | 初出時刻 (新着順ソートキー) |

## 処理フロー

`runJobNewsCrawl(sourceId?)` (`companies/job-news-crawler.ts`):

1. `selectActiveNewsSources` で有効ソースを決める (enabled or env opt-in)。
2. `PoliteFetcher` で robots 遵守 + レート制限つき取得。
3. kind 別に求人を抽出 → `JobPostingItem[]` に正規化 (`@tirocinium/companies` の純粋関数)。
4. run 内で `dedup_key` 重複を畳む → `insertNewJobPostings` で `ON CONFLICT DO NOTHING RETURNING`。
   返ってきた行 = 新着。
5. 新着を `notifyJobPostings` で Nuntius へダイジェスト通知 → 成功時 `notified` を立てる。

## API

| メソッド | パス | 認証 | 用途 |
|---|---|---|---|
| GET | `/api/v1/companies/job-postings?source=&limit=` | public | 新着順一覧 + total |
| GET | `/api/v1/companies/job-sources` | public | 設定済ソース (有効可否つき) |
| POST | `/api/v1/companies/crawl-job-news` `{source?}` | cernere + canCrawl | クロール起動 |

Web: `/jobs` (新規求人タブ)。 `JobPostings.tsx` がソース別フィルタ + 「新着を取得」 ボタン + カード一覧。

## 定期クロール + 通知 (config.jobNews)

| 設定 (env) | 既定 | 意味 |
|---|---|---|
| `COMPANY_JOB_NEWS_ENABLED` | false | 定期クロールの自動起動 |
| `COMPANY_JOB_NEWS_INTERVAL_MS` | 6h | クロール間隔 (礼節) |
| `COMPANY_JOB_NEWS_OPTIN_SOURCES` | (空) | enabled=false ソースの明示有効化 |
| `COMPANY_JOB_NEWS_NOTIFY_USER_ID` | (空) | Nuntius 通知先。 空なら通知 no-op (Web 表示のみ) |
| `NUNTIUS_URL` / `NUNTIUS_API_KEY` | (空) | Nuntius エンドポイント。 空なら push 自体が no-op |

`startJobNewsQueue` は `enabled=true` のときだけ `setInterval` を張る (起動 30 秒後に初回)。
通知は予約リマインドと同じ `pushNotification` 経路 (`notifications/nuntius.ts`) を使う。

## 個人データ境界

求人は公開情報のため保持してよい (DESIGN §6)。 個人名 (応募者・担当者) は抽出・保存しない。
