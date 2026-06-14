# 複数ソース束ね — companies 母集団の統合クロール

異種の企業ソース (HTML 一覧 / 構造化 API / seed / Notion) を **1 つの `companies` 母集団**に
束ねるための orchestration 仕様。略称 **Tr**。AIFormat 構造化仕様。
[[spec/companies/README.md]] §3.5 (listing クロール) を拡張し、[[spec/companies/gbizinfo.md]] (中小レーンの権威ソース) と接続する。

主目的: **中小ゲーム会社の新卒採用候補**を、複数ソースから漏れなく・出所を保ったまま集める。

---

## 0. 前提 — 骨格は既にある

`runListingCrawl` は **active な listing source を全部ループ**し
`extractListing → classify → shouldStock → upsertCompany (normalized_name dedup, flag は OR sticky)` する。
→ 「束ねる」= ソースを足すこと自体は実装済み。本書が足すのは **異種ソースを 1 母集団に正しく統合する横断 4 点**。

---

## 1. ソース・レジストリ (3 層 tier)

`data/companies/listing-sources.json` の各エントリに **`tier`** を付与し、信頼度で層化する。

| tier | ソース例 | kind | 既定 | 経路 | 役割 |
|---|---|---|---|---|---|
| `primary` (一次情報) | 東京ゲームショウ出展社 / CESA 会員 | `game` | enabled | LLM 抽出 | ゲーム純度 100% |
| `secondary` (まとめ) | 新卒就活ホンネナビ (約 209 社) | `newgrad-nav` | opt-in | LLM 抽出 | 新卒シグナル + 上場有無 + 中小が厚い |
| `structured` (API) | gBizINFO | `gov-api` | CLI | 決定論 | 中小の網羅・従業員数の権威 ([[spec/companies/gbizinfo.md]]) |
| (除外) | ファミキャリ等 SPA 求人 | `job-aggregator` | false | — | 企業名が JS 裏 / エージェント非公開で取得困難 |

- enable / opt-in / 礼節 (robots・逐次・Crawl-delay・UA) は既存 `PoliteFetcher` + `COMPANY_LISTING_OPTIN_SOURCES` を流用。
- まとめサイト (`secondary`) は **既定 disabled + 低頻度 + 出所明記**で運用する。

---

## 2. 横断で埋める 4 点

### ① 大表チャンク化 (必須)

現状 `htmlToText(html, 16000)` で 16000 字 cap、`extractListing` は **1 ページ最大 40 社**。
1 ページに 200 社超を持つ一覧 (ホンネナビ) は**取りこぼす**。

→ `ListingSourceConfig.chunkChars` を足し、全文 (`listingMaxChars` 上限) を
`chunkText()` で分割して `extractListing` を **チャンクごとに複数回**呼ぶ。
チャンク境界の社名重複は後段 dedup (normalized_name) が吸収。安全弁 `listingMaxChunks`。

### ② 横断 provenance (出所の累積)

現状 `upsertCompany` は `source/source_url = EXCLUDED` で**最後のソースに後勝ち上書き**。
複数ソースに出た会社の出所が片方消える。これは [[feedback_data_accuracy_over_privacy]] (出所開示が原則) に反する。

→ migration で `companies.sources jsonb` (`[{source,url}]`) を追加。
upsert を **read-merge-write** にし、既存 `sources` に新エントリを足して dedup (`mergeSources`、純関数)。
代表 1 件として `source`/`source_url` も従来どおり温存。
(将来 gBizINFO は `corporate_number` を第 2 dedup キーに持つ — [[spec/companies/gbizinfo.md]] §2。)

### ③ 中小レーン (規模軸の新設)

現状 `classify` に規模軸がなく中小フィルタ不可。本書では 2 段で確定する。

- **A (本書 / listing 段)**: 一覧の「上場有無」「規模」列を LLM 抽出 (`ListingEntry.isListed` / `sizeHint`) し、
  純関数 `classifySMB` で `CompanyFlags.isSMB` を判定。
  暫定定義 = **非上場 ∧ 大手キーワード非該当 ∧ (規模不明 or < 300 名相当) → 中小**。不明は inclusive に中小扱い。
- **B (follow-up / enrich 段)**: gBizINFO 従業員数で権威的に上書き確定 ([[spec/companies/gbizinfo.md]])。

`shouldStock(flags, {requireSMB})` で中小のみに絞れる (既定 off、`COMPANY_REQUIRE_SMB` / CLI で on)。

### ④ tier 競合解決

同一社で `is_smb` と `is_listed` が食い違うとき、`is_smb` は
**「一度も上場と判定されていない」場合のみ true** とする (`(prev ∨ new SMB) ∧ ¬(prev ∨ new listed)`)。
他フィールドは既存どおり「空でなければ COALESCE」+ フラグ OR sticky。
将来、source 信頼度での上書き優先 (primary が secondary を上書き) は gBizINFO PR 以降で精緻化。

---

## 3. データモデル変更 (migration 007)

`companies` に追記 (PG / SQLite 両方言):

| カラム | 型 (PG / SQLite) | 用途 |
|---|---|---|
| `sources` | `JSONB` / `TEXT '[]'` | 出所 `[{source,url}]` の累積 |
| `is_smb` | `BOOLEAN` / `INTEGER` | 中小フラグ (§2③) |
| `is_listed` | `BOOLEAN` / `INTEGER` | 上場シグナル (中小判定の材料) |

INDEX は ALTER の後に発行 ([[feedback_sqlite_create_index_after_alter]])。

---

## 4. 影響ファイル

| ファイル | 変更 |
|---|---|
| `packages/companies/src/types.ts` | `ListingSourceConfig{tier,chunkChars}` / `CompanyFlags.isSMB?` / `ListingEntry{isListed,sizeHint}` / `Company{sources,is_smb,is_listed}` / `CompanySource` 型 |
| `packages/companies/src/listing.ts` | LLM instruction に上場有無・規模列を追加、parse、`chunkText()` |
| `packages/companies/src/classify.ts` | `classifySMB()` + `shouldStock(opts)` |
| `packages/companies/src/provenance.ts` (新) | `mergeSources()` 純関数 |
| `apps/server/src/companies/listing-crawler.ts` | チャンクループ + SMB/provenance 引き渡し |
| `apps/server/src/companies/repo.ts` | `sources` read-merge-write + `is_smb`/`is_listed` 競合解決、selectCols 追加 |
| `apps/server/src/companies/listing-config.ts` | `tier`/`chunkChars` 読み込み |
| `apps/server/migrations{,-sqlite}/007_*.sql` | 上記カラム |
| `apps/server/src/config.ts` | `requireSMB`/`listingChunkChars`/`listingMaxChars`/`listingMaxChunks` |
| `data/companies/listing-sources.json` | ホンネナビ (opt-in) + TGS/CESA テンプレ |

---

## 5. CLI / 運用

```
POST /api/v1/companies/crawl-listing { source?: "honne-navi-game" }
  → 1 ソース or 全 active を束ねクロール → ListingCrawlSummary
COMPANY_LISTING_OPTIN_SOURCES=honne-navi-game   # まとめソースを明示有効化
COMPANY_REQUIRE_SMB=true                          # 中小のみ stock
```

---

## 6. 未確定 / 将来 (follow-up PR)

- **gBizINFO enrich (中小 B)**: 従業員数で `is_smb`/`size` を権威確定 ([[spec/companies/gbizinfo.md]])。
- seed / Notion 経路への SMB 推定 (research.size から) の取り込み。
- 実 URL 未確定の primary ソース (TGS 出展社 / CESA 会員) の確定と enabled 化。
- source 信頼度ベースの上書き優先 (primary > secondary) の精緻化。
- VC / アクセラレータ portfolio ソースの追加 (高シグナルなベンチャー)。
