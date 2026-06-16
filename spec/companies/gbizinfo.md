# gBizINFO 企業ソース — 中小/ベンチャーの母集団取込

`companies` テーブルの母集団を **gBizINFO (経産省 法人情報 REST API)** で広く埋めるための仕様。
求人観点(特にゲーム + 中小/ベンチャー)に寄せるため **「gBiz で粗く絞る → 会社HPで裏取り」の 2 段ファネル**で運用する。

略称 **Tr**。AIFormat 構造化仕様。[[spec/companies/README.md]] §3.5 (listing クロール) の新種ソースとして接続する。

---

## 0. なぜ gBizINFO か / なぜ 2 段か

- **網羅性**: 全法人の公式オープンデータ。大手新卒ナビが手薄な**中小/ベンチャーまで**拾える。無料 token・構造化レスポンスで [[Canalis]] の「LLM 排除・公開情報のみ・礼節」原則に完全合致。
- **粗さ**: 日本標準産業分類 (JSIC) に**「ゲーム」専用分類は無い**。業種では「情報通信業 / ソフトウェア業」までしか絞れず、ゲーム会社を正確には切り出せない。名称キーワードもノイズ・取りこぼしが残る。
- → 母集団は gBizINFO で粗く確保し、**ゲーム/募集の有無は会社HP巡回 (既存 enrich/classify) で確定**する。HP に URL が無い record は**社名→公式HP特定の検索ステップを 1 段挟む**(ユーザ合意済)。

責務境界: gBizINFO は **layer 1 (会社選択の母集団 = `companies`)** のみを埋める。ES添削の背景 (layer 2 = `company_profiles`) と面接質問プール (layer 3 = `company_interview_questions`) には**関与しない**(それぞれ HP enrich / [[spec/companies/interview-questions.md]] が担当)。

---

## 1. Canalis adapter — `GBizInfoSource`

取得層は **Canalis 共有 lib に `GBizInfoSource` として新設**する (Notion 経路と同じ置き場所)。Tr 固有の整形 (②) は Tr 側 `gbizinfo-to-company.ts` に置く。

```
GBizInfoSource.discover(query)          ← Canalis (汎用・決定論・LLM不使用)
  → GET /hojin?industry=…&name=…&…      (ページネーション + レート制限 + リトライ)
  → GBizHojin[] (raw record)
        ↓ ② gbizInfoRecordToCompany     ← Tr 側 (決定論マッピング)
  CompanyInput { name, url?, industry, location, size, source:'gbizinfo', source_url }
        ↓ ③ upsertCompany               ← 既存再利用 (normalized_name merge / 空値非劣化)
  companies に candidate を upsert (フラグはまだ立てない)
        ↓ ④ 既存 enrich/classify         ← 既存 listing 経路を再利用 (= HP裏取り)
  HP巡回 → isGame / hasOpening 判定 → shouldStock で確定 → company_profiles へ
```

`GBizInfoSource` は `@ludiars/canalis` 側、契約は既存 Source IF に合わせる。Notion と同様 **fake client で単体テスト可能**にする (実 API なしで discover をテスト)。

### 実装状況 (2026-06-15、PR #80)
- **取得層は Tr 側に実装** (`apps/server/src/companies/gbizinfo.ts`)。 既存 Wikidata source と同じく adapter を Tr に置く方針を踏襲 (Canalis publish を伴う cross-repo 化を避け 1 PR に収めるため)。 将来 Canalis 共有 lib へ昇格する場合も IF は据え置き可能。
- `GBizClient` を DI 可能にし `createGBizFetchClient` (token header `X-hojinInfo-api-token` + page走査 + `minIntervalMs` レート間隔) と `discoverHojin` (法人番号 dedup + max打ち切り) を分離。 **fake client で単体テスト済**。
- ②決定論マッピング `gbizInfoRecordToCompany` は **純パッケージ `@tirocinium/companies/gbizinfo.ts`** に配置 (representative 等の個人列は写さない)。
- **法人番号は専用カラム** `companies.corporate_number` (migration 012) に保持 (source_url の `hojinBango` 詳細URLと二重)。 `getCompanyByCorporateNumber` で名寄せ lookup 可能 (既存重複社の自動マージ=「本対応」は未実装)。
- ③ `upsertCompany` が `employee_number` から **is_smb を権威確定** (中小=従業員 300 以下、 [[size.ts]] `isSMBByEmployees`)。
- CLI `npm run companies:gbiz-import -- (--industry|--name|--prefecture) [--max]`。 token は `GBIZINFO_TOKEN` (secret 経由、 env 平文不可)。
- ⚠️ **未検証**: 実 API レスポンス (company_url 充足率 / industry コード粒度 / レート上限) は token 取得後に裏取りが必要 (§2 の注記)。 現状はドキュメント schema 準拠 + フィールド名揺れに寛容 (`hojin-infos`/`hojinInfos`/`results`)。 CLI は company_url 充足率 50% 未満で警告を出す。

---

## 2. gBizINFO API (実装前に実物で確認すべき点つき)

- ベース: `https://info.gbiz.go.jp/hojin/v1/hojin`
- 認証: 取得した token を header で送る (env を使わず Excubitor secret-agent / Canalis config に保存)。
- 主要エンドポイント:
  - `GET /hojin?...` — 法人検索 (本ソースの主経路)
  - `GET /hojin/{corporate_number}` — 詳細
- 候補に効く検索パラメータ(粗フィルタ): `name` / `industry`(JSIC系) / `prefecture` / `founded_year` / `employee_number` レンジ / 各種 flag(`subsidy` 等)。
- dedup キー: **`corporate_number`** (法人番号、13桁) を `companies.source_url` 等に保持し、再クロールの安定 dedup に使う(`normalized_name` と二重で持つ)。

> ⚠️ **実装着手前に実 API レスポンスで確認する**(過去に「memory から答えず実物で裏取り」方針):
> - `company_url`(会社HP)フィールドの**充足率** — 低ければ §0 の検索ステップ比率が上がる。
> - `industry` の**コード体系と粒度** — 情報通信業をどのコードで絞るか。
> - レート/クォータ上限 — token 規約値に従い `MIN_INTERVAL_MS` を設定。

---

## 3. 設定 (env 不使用)

[[spec/notion/README.md]] と同方式。Excubitor secret-agent (`@tirocinium/secrets`) or Canalis `config set` で runtime 取得し process memory のみ。

| キー | 用途 |
|---|---|
| `GBIZINFO_TOKEN` | gBizINFO API token (必須) |
| `GBIZINFO_MIN_INTERVAL_MS` | レート間隔 (規約上限に従う) |
| `GBIZINFO_DEFAULT_INDUSTRY` | 既定の粗フィルタ業種コード(情報通信業系) |

---

## 4. CLI / 運用

```
npm run companies:gbiz-import -- --industry <code> [--name ゲーム] [--max <n>]
  → discover → gbizInfoRecordToCompany → upsert (candidate)
  → 続けて既存 enrich (--enrich) で HP裏取り → stock 確定
```

- v1 は同期 + `max` 上限。大量化したらバックグラウンドジョブへ (既存 §7 と同じ将来課題)。
- クロール権限は既存 `COMPANY_CRAWL_ADMIN_IDS` を踏襲。

---

## 5. 未確定 / 将来

- gBizINFO の `company_url` 欠落 record に対する「社名→公式HP特定」検索ステップの実装(ToS の緩い経路を選定)。
  - Wikidata 発見社 (url 無) 向けは ✅ 実装済 (2026-06-16, #198): Wikidata の official website (P856) を社名ラベル (組織 Q43229 限定) で引く決定論ステップ。純関数 `parseOfficialSite`/`fetchOfficialSite` (`wikidata.ts`) + DB 非依存オーケストレーション `runWikidataUrlFill` (`wikidata-url.ts`) + CLI `companies:wikidata-url` (token 不要)。url が埋まると以後の自動 enrich キューに乗る。gBizINFO 欠落 record / 非 Wikidata 経路の汎用検索は引き続き未確定。
- 業種粗フィルタの最適コードセット(実 API で確定)。
- VC/アクセラレータ portfolio ソース(高シグナルなベンチャー)を別 listing source として追加(本書とは独立)。
