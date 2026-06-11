# companies — 企業クロール + ES おすすめ企業

ES からおすすめ企業を返す機能 (①) と、 企業をクロールして自動収集する機能 (②) の仕様。
② が集めた企業プールを ① がマッチング対象にする (② が ① の前提データ)。

略称 **Tr**。AIFormat 構造化仕様。DESIGN.md §3.1 / §6 と整合。

---

## 1. データ責務境界 (DESIGN §6 との整合)

| 持つ | 持たない |
|---|---|
| 企業の**公開情報** (`companies` テーブル) | ES / ポートフォリオの生本文 |
| ES から導出した**おすすめ結果** (`company_recommendations`、 理由は要約) | ES の逐語コピー |

- 企業情報は公開情報のため Tirocinium DB に保持してよい (個人データではない)。
- ES 本文は **request scope の `es_text`** か **Memoria RAG 経由** でのみ参照し、 保存しない。
- おすすめ理由は ES を逐語コピーしない (プロンプトで明示 + 履歴も要約のみ)。

---

## 2. パッケージ構成

| 層 | 場所 | 役割 |
|---|---|---|
| ドメイン (純粋) | `packages/companies` | 型 / HTML→text / 正規化 / 抽出 prompt+parse / 適合スコア / recommend prompt+parse |
| 配線 (server) | `apps/server/src/companies` | crawler (fetch→抽出→upsert) / repo / seed loader |
| 配線 (server) | `apps/server/src/recommend` | service (profile 組立→recommend) / repo |
| LLM | `packages/llm` | `EXTRACTOR` (Haiku) / `RECOMMENDER` (Sonnet) のモデル割当 |

`packages/companies` は `@tirocinium/llm` にのみ依存 (LLM 呼び出しはクライアント注入)。

---

## 3. ② 企業クロール

### 3.1 フロー

```
source.discover() → seed URL 列挙
  ↓ (逐次・礼節 UA・タイムアウト・maxPages 上限)
fetch HTML → htmlToText
  ↓
抽出: LLM (EXTRACTOR=Haiku) → 失敗/鍵なしは heuristic (title + meta description)
  ↓
normalizeCompany (社名正規化 / role 寄せ / tag 整理) → null は skip
  ↓
upsertCompany (normalized_name で UPSERT、 空値は既存を温存)
```

### 3.2 クロールソース (`packages/companies/src/sources.ts`)

| id | seed の出所 | 用途 |
|---|---|---|
| `manual` | リクエスト body の `urls[]` | 任意 URL を指定して収集 |
| `seed-file` | サーバ `data/companies/seeds.json` の `[{name,url}]` | 定常リスト |

- v1 は外部サイトを無差別に辿らない (`http(s)` のみ + 明示 URL のみ)。 礼節 / 法務リスク回避。
- 将来: sitemap / 求人サイト API ソースを `SOURCES` に追加する余地を残す。

### 3.3 API

| method | path | 説明 |
|---|---|---|
| GET | `/api/v1/companies` | 一覧 (`role` / `tag` / `industry` / `q` / `limit` / `offset`) |
| GET | `/api/v1/companies/sources` | 単体取得ソース一覧 (manual/seed-file) |
| GET | `/api/v1/companies/listing-sources` | listing ソース一覧 (有効可否つき) |
| GET | `/api/v1/companies/:id` | 詳細 |
| GET | `/api/v1/companies/:id/profile` | IR/理念 profile |
| POST | `/api/v1/companies/crawl` | 単体取得クロール `{source, urls?, maxPages?}` → `CrawlSummary` |
| POST | `/api/v1/companies/crawl-listing` | listing 発見クロール `{source?}` → `ListingCrawlSummary` |
| POST | `/api/v1/companies/enrich` | 企業サイト巡回で IR/理念取得 `{company_id?, limit?}` → `EnrichSummary` |

- 認証は Cernere (dev は `TIROCINIUM_DEV_AUTH`)。
- クロールは `COMPANY_CRAWL_ADMIN_IDS` 設定時はその user のみ (未設定なら全 authed user 可)。
- v1 は同期実行 + `maxPages` 上限。 大規模化したらバックグラウンドジョブへ (将来)。

---

## 3.5 listing クロール (新卒/ゲーム企業の発見) + enrichment

要件: ①新卒採用企業をストック / ②新卒でなくてもゲーム企業で募集があればストック / ③企業サイトを巡回して IR・企業理念を取得。

### 3.5.1 listing ソース (設定駆動)

`data/companies/listing-sources.json` に `{id, kind, urls[], enabled, note}` を列挙。
サイト固有のセレクタは持たず、 ページ本文を **LLM (EXTRACTOR=Haiku) で企業リスト抽出** する (`extractListing`)。

| kind | 用途 | 既定 |
|---|---|---|
| `job-aggregator` | 汎用求人 aggregator の新卒一覧 | disabled (実URL差替で有効化) |
| `game` | ゲーム業界特化の企業/求人一覧 | disabled |
| `seed-list` | 用意した企業リスト由来 | disabled |
| `newgrad-nav` | 大手新卒ナビ (ToS 厳しめ) | **disabled + 明示 opt-in 必須** |

- `enabled=false` でも `COMPANY_LISTING_OPTIN_SOURCES` に id があれば起動 (ToS リスク源の安全弁)。
- 全ソースで **robots.txt 遵守 + 1ドメイン逐次 + Crawl-delay/最小間隔 + 礼節UA** (`PoliteFetcher`)。

### 3.5.2 分類 + ストック判定 (`classify.ts`, 純粋)

listing エントリ + ページ語彙から keyword + LLM ヒントで `CompanyFlags{isNewgrad,isGame,hasOpening}` を判定。

```
shouldStock = isNewgrad || (isGame && hasOpening)
```

満たした企業のみ `companies` に upsert。 フラグは OR でマージ (一度立った新卒/ゲーム/募集は温存)。
`stock_reason` にストック理由 (例「新卒採用あり」) を記録。

### 3.5.3 enrichment (③ 企業サイト → IR / 理念)

`companies.url` を起点に、 **同一ホスト**の理念/IR/会社概要/採用リンクを `selectEnrichmentLinks` で選定 (語彙ベース、純粋)。
優先順 (理念 > IR > about > recruit) で `enrichMaxPages` まで巡回 → 本文結合 → **LLM で profile 抽出** (`extractProfile`) → `company_profiles` に upsert。
robots で弾かれたページは skip。 何も取れなければ保存しない。

---

## 4. ① ES おすすめ企業

### 4.1 フロー

```
プロファイル組立:
  esText = request.es_text  (無ければ Memoria RAG: kinds=[es,portfolio,self_intro])
  weakAxes = weakness_profiles.weak_top3
  ↓
candidate 抽出: scoreCompany (heuristic) で全企業を採点 → 上位 maxCandidates(30)
  ↓
LLM rerank (RECOMMENDER=Sonnet): candidate を渡し ranking + 理由 + 懸念を JSON で
  └ 幻覚 id は candidate 集合で検証して除外
  ↓ (鍵なし / LLM 失敗時)
heuristic fallback: scoreCompany の breakdown から理由を機械生成
  ↓
company_recommendations に保存 (履歴)
```

### 4.2 適合スコア (`scoreCompany`, 0-100)

| 要素 | 加点 |
|---|---|
| 志望職種が募集職種に一致 | +35 |
| タグ重なり | 1 件 +12 (最大 36) |
| ES キーワードが企業 description/tags/industry に出現 | 1 件 +6 (最大 24) |
| 志望企業名の一致 | +5 |

### 4.3 API

| method | path | 説明 |
|---|---|---|
| POST | `/api/v1/recommend` | おすすめ生成 `{target_role?, target_company?, tags?, es_text?, topK?}` |
| GET | `/api/v1/recommend` | 自分のおすすめ履歴 (`limit`) |

レスポンスは `{recommendation, method: 'llm'|'heuristic', has_es_material}`。
`has_es_material=false` は ES 素材なし (職種・タグのみの弱い推薦) を示す。

---

## 5. 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `COMPANY_CRAWL_MAX_PAGES` | 20 | 1 回のクロール取得上限 |
| `COMPANY_CRAWL_FETCH_TIMEOUT_MS` | 15000 | fetch タイムアウト |
| `COMPANY_CRAWL_MIN_INTERVAL_MS` | 2000 | 同一ドメイン最小間隔 (Crawl-delay と長い方) |
| `COMPANY_CRAWL_RESPECT_ROBOTS` | 1 | robots.txt 遵守 (0 で無効化、 UA/レート制限は維持) |
| `COMPANY_ENRICH_MAX_PAGES` | 5 | enrichment で 1 社あたり巡回ページ数上限 |
| `COMPANY_CRAWL_USER_AGENT` | `TirociniumBot/0.1 …` | 礼節 UA |
| `COMPANY_CRAWL_ADMIN_IDS` | (空) | クロール可能な user_id (カンマ区切り)。空なら全 authed user |
| `COMPANY_LISTING_OPTIN_SOURCES` | (空) | enabled=false の listing source を明示有効化する id (例 `newgrad-nav`) |
| `TIROCINIUM_MODEL_EXTRACTOR` | Haiku | 抽出モデル上書き |
| `TIROCINIUM_MODEL_RECOMMENDER` | Sonnet | recommend モデル上書き |
| `MEMORIA_URL` / `MEMORIA_PROJECT_TOKEN` | (空) | ES 素材の RAG 取得 (既存) |

---

## 6. DB スキーマ (migration 003)

`companies` (公開情報プール) / `company_recommendations` (導出ガイダンス履歴)。
詳細は `apps/server/migrations/003_companies_recommend.sql` と `spec/schema/README.md`。

---

## 6.5 関連ソース / レイヤー (別 spec)

企業データは**3 レイヤー**で構成され、それぞれ供給源と consumer が異なる:

| layer | データ | 供給 | consumer | spec |
|---|---|---|---|---|
| 1 会社マスタ | `companies` (社名/業種/規模/URL) | Web crawl / Notion / **gBizINFO** | 会社選択 | 本書 + [`gbizinfo.md`](./gbizinfo.md) |
| 2 企業プロファイル | `company_profiles` (理念/IR/事業) | HP enrich (§3.5.3) | **ES添削の背景 RAG** | 本書 §3.5.3 |
| 3 面接質問プール | `company_interview_questions` | ユーザ投稿 + Notion 取込 | **面接質問リストの優先素材** | [`interview-questions.md`](./interview-questions.md) |

- **中小/ベンチャーを増やす主軸は gBizINFO**(layer 1)。粗く集めて HP で裏取り。詳細は [`gbizinfo.md`](./gbizinfo.md)。
- ES添削の特化(背景情報入り)は **layer 2 をそのまま RAG に使う**(新規データ源不要)。
- 面接の「その会社で実際に受けた質問」は **layer 3** で新設(本人 past_qa とは別スコープ)。詳細は [`interview-questions.md`](./interview-questions.md)。

---

## 7. 未確定 / 将来

- クロールの非同期ジョブ化 (大量 URL / 定期実行)。 現状は同期 + maxPages 上限。
- sitemap / 求人サイト (Wantedly 等) ソースの追加 (利用規約確認が前提)。
- VC/アクセラレータ portfolio ソース (高シグナルなベンチャーの厳選リスト) を listing source に追加。
- recommend の候補プール拡大時の scoring 高速化 (現状は全件 in-memory)。
- Memoria RAG API の最終仕様確定 (training と共通の TODO)。
