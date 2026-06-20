# 企業×ゲーム グラフDB — 関係性レコメンド / 未検知企業の発見

Tirocinium の企業DBを **企業ノードとゲームノードのグラフ**に拡張し、
「**FF(スクエニ)に関わりたいなら、こういう会社がおすすめ**」のような
**関係性ベースの企業探索・レコメンド**を可能にする設計。
あわせて、ゲームのスタッフロール掲載元から**未検知企業を発見**してDBを強化する。

略称 **Tr**。AIFormat 構造化仕様。[[spec/feature/companies/README.md]] §3 (企業クロール) /
[[spec/feature/companies/listing-bundle.md]] (複数ソース束ね) / [[spec/feature/companies/gbizinfo.md]] (中小レーン) を前提に拡張する。

---

## 0. 目的とユースケース

就活生 (Tr の利用者) が「**作りたいゲーム / 関わりたい作品・会社**」を起点に、
そこへ繋がる企業を関係グラフから提案する。

- 「FF に関わりたい」→ FF を作った/出した会社 (スクエニ) + その**取引先 / 共同開発 / 外注先 / 同系作品の開発会社**を提案。
- 「このスタジオの系譜の会社」→ パブリッシャー網・取引網をたどって関連中小スタジオを発掘。
- 探索の過程で **DBに無い企業 (外注スタジオ等) をスタッフロールから発見**し、母集団を継続強化。

レコメンドは ES ベースの既存 `company_recommendations` ([[spec/feature/companies/README.md]] §4) と併存し、
**「関係性軸」の候補出し**を担う (スコアリングは §6)。

---

## 1. なぜグラフか / ストレージ方針

関係 (開発・パブリッシュ・取引・関与) は **多対多 + 多段たどり**で、
「2〜3 ホップ先の関連企業」を引くのが中心。これはグラフ探索が自然。

### ストレージ判断 (decision-metrics)

| 案 | AI学習量 | 作業コスト | 解決度 | 主目的一致 |
|---|---|---|---|---|
| **A: 関係テーブル + 再帰CTE (現 SQLite/PG 延長)** | ★★☆ | 低 | ★★★★ | ★★★★ |
| B: 埋込グラフDB (Kuzu 等) 導入 | ★★★★ | 中 (新エンジン + 2DB 同期) | ★★★★★ | ★★★★ |

→ **A を採用**。現スタック (postgres / node:sqlite 互換ドライバ) の延長で
`games` + edge テーブルを足し、探索は再帰 CTE + アプリ側スコアリング。
ホップ数は 2〜3 に制限するため再帰 CTE で実用充分。
将来、純グラフクエリ (任意長パス・中心性) が要るなら **Kuzu へ edge テーブルをそのまま移送**できる
(エッジを第一級に保つので移行容易)。本書は A 前提で記述する。

「企業DB と ゲームDB を分けて管理」 = 論理的に `companies` ドメインと `games` ドメインを分離し、
**edge テーブルで疎結合に接続**する (両者は独立に更新・クロールできる)。

---

## 2. データモデル (ノード / エッジ)

```
[企業 companies] ──developed──▶ [ゲーム games]      company_game(role='developer')
[企業 companies] ──published──▶ [ゲーム games]      company_game(role='publisher')
[企業 companies] ──credited───▶ [ゲーム games]      company_game(role='credited')  ← スタッフロール由来
[企業 companies] ──取引先─────▶ [企業 companies]   company_partner(kind='client'|'vendor'|'partner')
[企業 companies] ◀─OB集計───── {入社年×クラス×役職×人数}  company_ob_placement (個人なし)
[企業 companies] ─has─ インタビュー記事[]            company_interview_articles (既存)
[企業 companies] ─has─ IR/プロフィール               company_profiles (既存, 業界動向用に保持)
```

ノードは **企業 (`companies`, 既存)** と **ゲーム (`games`, 新規)** の 2 種。
それ以外 (OB / インタビュー / IR) は企業に従属する属性・集計で、独立ノードにはしない。

### 2.1 個人データ境界 (OB)

OB (卒業生の就職実績) は [[project_personal_data_rule]] に従い **個人レコードを一切持たない**。
保持するのは **集計のみ**: `{company_id, 入社年, クラス, 役職, 人数}`。
- 個人特定不可。「役職」「クラス」までの粒度で**人数**だけ。
- OB データは**ユーザが付与**する (クロールしない)。インポータ (CSV/JSON) または **非公開 Sheet 同期** (§5.3) で取り込む。
- 1 人しかいないセルは k-匿名性のため**「1名」表示の是非を要検討** (§7)。

**氏名つき合格リストの扱い (2026-06-16 決定)**: 合格者個人 (氏名つき) を持つ非公開 Sheet を「裏で管理」する運用を許容する。
ただし**氏名の置き場は Sheet のみ**で、 Tirocinium DB には一切入れない。 取込時に `aggregateObPersons` (純) が
氏名を破棄して集計セルに畳むため、 DB / API へ氏名が流れる経路は型レベルで存在しない (返り値 `NormalizedObPlacement` に氏名フィールド無し)。
これにより「氏名を残したい」要件 (将来のスタッフロール照合用) と [[project_personal_data_rule]] を両立する
(露出面はマスク・データは正本に保持、 [[feedback_data_accuracy_over_privacy]])。 氏名 ⇄ 個人クレジット照合エンジンは
個人名つきクレジット取込元が決まってからの別フェーズ (Sheet が氏名を保持するので後から照合可能)。

---

## 3. スキーマ (migration 案)

既存 `companies` / `company_profiles` / `company_interview_articles` はそのまま。追加:

### 3.1 `games` (ゲームノード)
```sql
CREATE TABLE games (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title         TEXT NOT NULL,
  normalized_title TEXT NOT NULL UNIQUE,   -- dedup キー (記号/版表記除去)
  series        TEXT NOT NULL DEFAULT '',  -- 例 'ファイナルファンタジー'
  platform      TEXT NOT NULL DEFAULT '',  -- コンシューマ/モバイル/PC 等
  genre         TEXT NOT NULL DEFAULT '',
  release_year  INTEGER NOT NULL DEFAULT 0,
  source        TEXT NOT NULL DEFAULT '',  -- 抽出元 (research/staff-credits/wikidata)
  sources       JSONB NOT NULL DEFAULT '[]', -- 出所累積 (listing-bundle §2② と同方式)
  crawled_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
`series` は「FFに関わりたい」のシリーズ単位探索に効く (タイトル表記揺れを吸収する束ね軸)。

### 3.2 `company_game` (企業↔ゲーム edge)
```sql
CREATE TABLE company_game (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,    -- 'developer' | 'publisher' | 'credited' | 'support'
  source      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, game_id, role)
);
CREATE INDEX idx_company_game_game ON company_game(game_id);
CREATE INDEX idx_company_game_company ON company_game(company_id);
```
`role='credited'` はスタッフロール由来 (関与の弱い証拠)。developer/publisher は確度の高い関係。

### 3.3 `company_partner` (企業↔企業 取引 edge)
```sql
CREATE TABLE company_partner (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  partner_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'partner',  -- 'client'(取引先) | 'vendor'(発注先) | 'partner'
  source      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (company_id, partner_id, kind),
  CHECK (company_id <> partner_id)
);
```
主要取引先。方向あり (client/vendor) だが探索は双方向に辿る。

### 3.4 `company_ob_placement` (OB 集計・個人なし)
```sql
CREATE TABLE company_ob_placement (
  company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  join_year    INTEGER NOT NULL DEFAULT 0,   -- 入社年 (0=不明)
  class_name   TEXT NOT NULL DEFAULT '',     -- クラス (例 'ゲームプランナー専攻 2024')
  role         TEXT NOT NULL DEFAULT '',     -- 役職/職種
  headcount    INTEGER NOT NULL DEFAULT 0,   -- 人数 (集計)
  source       TEXT NOT NULL DEFAULT 'user', -- 原則ユーザ付与
  PRIMARY KEY (company_id, join_year, class_name, role)
);
```

migration は ALTER→INDEX 順序遵守 ([[feedback_sqlite_create_index_after_alter]])、PG/SQLite 両方言で用意。

---

## 4. パッケージ / マッピング (純関数)

`@tirocinium/companies` に追加:
- `normalizeTitle(title): string` — ゲーム名 dedup キー (版/記号/全角半角/「リマスター」等の除去)。
- `parseGamesFromResearch(research): GameLink[]` — 既存 `companies-research.json` の `games` 文 (代表作) と
  `game_kind` から Game + developer edge を導出 (Phase 1 の初期投入源)。
- `parseStaffCredits(pageText): { game, companies[] }` — スタッフロール掲載元から Game↔企業 を抽出 (Phase 2)。✅ 実装済 (2026-06-16, #200): section 見出しで役割 (developer/publisher/support/credited) を切替え、 企業指標を持つ行のみ採って個人名を除外。「開発協力/外注/移植/QA」も拾い外注スタジオの発見精度を上げる (full credits)。
- `extractEmployeeFromIR(irText): number` — IR 文から従業員数を裏取り抽出 (Phase 4、[[size.ts]] 再利用)。✅ 実装済: `extractEmployeeCount` と同じ anchor 規則で「連結/単体」併記に対応し連結 (グループ全体規模) を優先。

LLM は listing 同様 **抽出段のみ**で使用可、束ね/正規化/探索は決定論 ([[Canalis]] 原則)。

---

## 5. 取り込み経路

### 5.1 Phase1: research → Game DB 初期投入
`companies-research.json` の各社 `games`(代表作テキスト) を `parseGamesFromResearch` で分解し、
`games` upsert + `company_game(role='developer')` を張る。publisher は既知分 (大手) を別途付与。

### 5.2 Phase2: スタッフロール発見クロール
[[spec/feature/companies/listing-bundle.md]] に **新 kind `staff-credits`** を追加。
MobyGames / Wikipedia(クレジット節) / 4Gamer 等の**クレジット掲載元**を source 登録し、
`parseStaffCredits` で「ゲーム → 関与企業群」を抽出 →
- 既知企業は `company_game(role='credited')` を追加、
- **未知企業は `companies` に新規 upsert** (source='staff-credits') → **未検知企業の自動発見**。
robots / 礼節 / opt-in は既存 `PoliteFetcher` + listing 規約を踏襲。ToS は source ごとに要確認。

✅ 実装済 (2026-06-16, #200): `parseStaffCredits` (純) + DB 非依存 ingest (`staff-credits-ingest.ts`、 deps 注入) + クロール (`staff-credits-crawl.ts`) + CLI `companies:staff-credits`。kind `staff-credits` を追加し、 source template (`mobygames-credits`/`wikipedia-credits`) は **ToS 未確認のため既定 disabled** (実 URL 確定 + ToS 目視確認 → opt-in で有効化)。role は dev/pub/support/credited を張り分け、 未知企業は source='staff-credits' で自動発見。**OB 在籍証明/検索の company↔game グラフ補強**にも使う。

### 5.3 Phase3: OB 集計インポータ
ユーザ付与の OB データ (CSV/JSON: `会社名, 入社年, クラス, 役職, 人数`) を
社名正規化で `company_id` に解決し `company_ob_placement` へ upsert。個人列は受け取らない (§2.1)。

**非公開 Sheet 同期 (✅ 2026-06-16, source='sheet-sync')**: 合格リストを非公開 Google Sheet で管理し、
service account (読み取り専用) で差分同期する admin 専用フロー。 氏名つき個人行 (`氏名, 会社, 入社年, クラス, 役職`)
を読み、 `aggregateObPersons` で氏名を破棄して集計セルに畳んでから DB へ反映する。
- **コネクタ** `google-sheets.ts`: 外部 SDK 不使用。 service account JSON で署名した JWT (RS256) → access token → Sheets values API。 Sheet は service account のメールに共有しておく。
- **差分 (Sheet 正本同期)**: `source='sheet-sync'` の DB 現状 (prev) と Sheet 全量 (next) を `diffObCells` (純) で突合 → 新規/headcount 変更 upsert + Sheet から消えたセルの削除。 手動 CSV 取込 (`source='user'`) のセルには触れない。
- **アクセス制御**: creds/id/range は secret 経由 (`TIROCINIUM_OB_SHEET_SA_JSON` / `_ID` / `_RANGE`、 リポ非コミット)。 起動は admin (`COMPANY_CRAWL_ADMIN_IDS`) のみ — CLI `companies:ob-sync` (`--dry-run` 可) / admin API `POST /companies/ob/sync`。 公開 API には集計しか出ない。

**OB×ゲーム結合ビュー (✅ 2026-06-17)**: OB を「結果にマージ」する読み出し。 OB→会社 (集計) と 会社→ゲーム (`company_game`) を**結合**し、
「**OB 輩出スタジオ × 代表作**」を出す (`GET /companies/ob/studios`、 desktop の企業プールに `ObStudios` パネル)。 個人照合なし・§2.1 準拠。
- 代表作選定は純関数 `pickRepresentativeGames` (シリーズ単位で 1 作に畳む + 自社開発/発売 role 優先 + 年降順)。
- **個人名クレジット照合 (氏名 ⇄ スタッフロール) は不採用**: 個人名クレジットの構造化源 (MobyGames API) は **ToS が人物特定情報の harvest を禁止**、かつ漢字⇄ローマ字の名寄せが不安定で同姓同名誤ヒットの恐れ → 外部 ToS + `project_personal_data_rule` + 精度の三点で見送り (2026-06-17 決定)。 個人粒度が要る場合は外部 harvest せず **OB 本人申告 (Sheet に参加作品列)** の許諾ルートで持つ。

### 5.4 Phase4: IR 従業員数 裏取り
`listing_market<>''` または research 名寄れ失敗で `employee_count=0` の社を対象に、
IR/株価情報・会社情報ページをクロールして従業員数を確定 (`extractEmployeeFromIR`)。
IR 本文は `company_profiles.ir_summary` (既存) に**「ゲーム業界動向」用として保持**。

### 5.5 Phase5: 英⇔カナ社名の自動マージ (#197) ✅ 実装済

`normalized_name` が異なる同一企業 (例: 「Capcom Co., Ltd.」と「カプコン」) を `corporate_number` (gBizINFO 由来) を基準に名寄せして 1 行に集約する。

- **重複検出**: `corporate_number` が同じ (非空) 企業行を重複グループとみなす。
- **survivor 選定**: (url非空?1:0) + (description非空?1:0) + game_count + ob_count のスコアで最充実行を survivor に選ぶ。同点は `crawled_at` 昇順 → `id` 昇順で決定論的に解決。
- **全参照テーブル repoint**: 8 子テーブル (company_profiles / company_interview_articles / company_newgrad_images / company_newgrad_role_images / company_game / company_partner / company_tech / company_ob_placement) の `company_id` を survivor に張り直す。PK 衝突は `ON CONFLICT DO NOTHING` で回避。`company_ob_placement` は headcount を合算 (`DO UPDATE SET headcount = ... + EXCLUDED.headcount`)。`company_partner` は `company_id`/`partner_id` 双方を置換し、置換後に自己ループになる行は `CHECK company_id <> partner_id` 違反なので除外する。
- **フィールド集約**: sources は全行 union、boolean フラグ (is_newgrad/is_game/has_opening/is_smb/is_listed) は OR、scalar (url/description 等) は survivor が空なら loser の非空値で補完。
- **実行**: CLI `companies:merge-duplicates` (`--dry-run` 可) / admin API `POST /api/v1/companies/merge-duplicates { dryRun? }`。純関数は `@tirocinium/companies` の `company-merge.ts`、DB 非依存コアは `company-merge-core.ts`、配線は `company-merge-wire.ts`。

---

## 6. レコメンド (関係性軸)

API: `POST /api/v1/companies/related { seed: {game?|series?|company?}, hops?: 2, limit?: 20 }`

探索 (再帰 CTE、hops ≤ 3):
1. seed を解決 (Game / series / Company)。
2. Game/series → `company_game` で **開発/パブリッシュ企業**を取得 (ホップ0)。
3. そこから `company_partner` (取引網) と「同シリーズ/同パブリッシャーの他ゲームの開発企業」を1〜2ホップ展開。
4. `company_game(role='credited')` も弱エッジとして加点。

スコア = Σ エッジ重み × ホップ減衰。重み例: developed/published > partner > credited。
中小フィルタ (`is_smb`)・新卒採用 (`is_newgrad`)・募集中 (`has_opening`) で絞り込み可
([[spec/feature/companies/listing-bundle.md]] の軸を流用)。

---

## 7. 未確定 / 将来

- ~~**OB の k-匿名性**: 人数 1 のセルの扱い~~ → **決定 (2026-06-15): 実数表示のまま**。OB は集計のみ・個人特定不可のため、人数 1 でも丸めず実数を出す (丸め / 「数名」表記 / 非表示閾値は導入しない)。
- ゲーム名・社名の**表記揺れ名寄せ** (FF/ファイナルファンタジー、英⇔カナ社名)。series 軸 + 別名辞書で緩和、最終は corporate_number ([[spec/feature/companies/gbizinfo.md]])。
  - series 軸は ✅ 実装済 (2026-06-16, #202): 純関数 `normalizeSeries` (NFKC + 機械正規化 + 主要フランチャイズの別名/略称/下位シリーズを親キーへ畳む明示対応表。過剰マージ回避のため未知シリーズは機械正規化のみ)。`games.normalized_series` 列 (migration 016) に materialize し、同シリーズ判定 (`relatedCompaniesByGame`) で使用。backfill 前は raw series へ degrade。既存行は CLI `companies:series-normalize` で埋める。社名の英⇔カナ名寄せ (#197) は §5.5 で実装済 (corporate_number 基準の自動マージ)。
- publisher edge の網羅 (research に publisher 情報が薄い → スタッフロール/Wikidata 補完)。
- 純グラフクエリが必要になった場合の **Kuzu 移行** (edge テーブルをそのまま移送)。
- フロント: グラフ可視化 (企業—ゲームの関係ネットワーク表示) は別途。

---

## 8. フェーズ (各 1 PR、[[feedback_ai_pr_size]])

1. **Game DB + edge 基盤**: `games`/`company_game`/`company_partner` migration + `normalizeTitle`/`parseGamesFromResearch` + research からの初期投入 + 反映。
2. **スタッフロール発見クロール** ✅ 実装済 (#200): `staff-credits` source + `parseStaffCredits` → dev/pub/support/credited edge + 未知企業の自動発見。source は ToS 未確認のため既定 disabled (opt-in で有効化)。
3. **OB 集計インポータ** ✅ 実装済: `company_ob_placement` migration (011) + 取込 CLI (`companies:ob-import`、 CSV/JSON 自動判別) + 集計 API (`GET /:id/ob`・`GET /ob/top`) + 検索表示 (関連会社カードに OB 累計 chip + 内訳)。 純パース/集計は `@tirocinium/companies` の `ob.ts`。 個人列は列名で拾わず構造的に排除 (§2.1)。 k-匿名性 (人数1 セル) は §7 のとおり実数表示で確定 (2026-06-15)。
4. **関係性レコメンド + IR 従業員裏取り**: `/companies/related` 探索 API + `extractEmployeeFromIR` クロール。
   - IR 従業員裏取り ✅ 実装済 (2026-06-16): 純関数 `extractEmployeeFromIR` (`size.ts`、 連結 (consolidated) 優先・決定論・LLM 不使用) + クロール CLI `companies:ir-employee`。 対象は `employee_count=0` ∧ url 有 (上場社優先)。 ホーム→同一ホストの IR/会社概要ページを巡回し従業員数を確定 → `employee_count`/`is_smb` 更新、 IR 本文は (LLM 要約が無い社のみ) `company_profiles.ir_summary` に保持。 純 IO は `ir-employee-extract.ts` に分離 (DB 非依存・テスト可能)。
