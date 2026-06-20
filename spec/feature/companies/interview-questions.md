# 会社別 面接質問プール — 面接質問リストの優先素材

面接練習の質問リストを事前生成する際、**「その会社で実際に受けた質問」を最優先**で引くための
会社単位の質問プール (layer 3) の仕様。供給は **A: ユーザ投稿** と **B: Notion 手元データ取込**の併用。

略称 **Tr**。AIFormat 構造化仕様。[[spec/feature/companies/README.md]] / [[spec/data/README.md]] / 面接官エンジン (`spec/feature/inference/interviewer-engine.md`) と整合。

---

## 0. スコープの区別 (重要)

「実際に受けた質問」には別スコープの 2 つがあり、本書は **②** を新設する。

| | 本人が過去受けた質問 (①) | 会社で誰かが受けた質問プール (②・本書) |
|---|---|---|
| 単位 | user | company |
| 既存 | `training_data_refs.kind='past_qa'` (実装済) | **無い → 新設 `company_interview_questions`** |
| 経路 | Memoria RAG (interviewer-engine §5-4) | 本書 (DB 直引き) |
| PII | 本人データ (Memoria 保管) | **質問文のみ・誰が答えたかは持たない → 公開情報扱い** |

①②は競合せず**併用**する。質問リスト生成では「②会社プール > ①本人 past_qa > 汎用 qa-seed」の優先順で素材を積む。

---

## 1. データモデル — `company_interview_questions` (migration 005)

質問文のみを会社に紐づける。回答・氏名・個人特定情報は**持たない** (PII 非保管・DESIGN §6 / [[個人データ保管禁止]] と整合)。

```sql
CREATE TABLE company_interview_questions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  question      TEXT NOT NULL,                 -- 質問文 (本文のみ。回答は持たない)
  normalized_q  TEXT NOT NULL,                 -- 正規化 (trim/全半角/記号除去) → dedup キー
  role          TEXT NOT NULL DEFAULT 'any',   -- planner/programmer/designer/sound/any
  stage         TEXT NOT NULL DEFAULT 'any',   -- hr/peer-tech/lead-tech/final/any (面接官 stage と整合)
  source        TEXT NOT NULL DEFAULT 'user',  -- 'user'(投稿) / 'notion'(取込) / 'seed'
  source_ref    TEXT NOT NULL DEFAULT '',      -- notion page id 等 (PII を含めない)
  asked_year    INT,                           -- 受けた年 (任意・鮮度用。月日は持たない)
  upvotes       INT NOT NULL DEFAULT 0,        -- 投稿の有用度 (任意)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, normalized_q, role, stage)   -- 同一質問の重複投入を抑止
);

CREATE INDEX idx_ciq_company ON company_interview_questions(company_id, stage, role);
```

- dedup は `(company_id, normalized_q, role, stage)` UNIQUE。再投入は `upvotes` 加算 or no-op。
- `asked_year` までに留め、**月日・氏名・回答内容は保持しない**(個人特定回避)。

---

## 2. 供給 A — ユーザ投稿

面接後に「何を聞かれたか」をユーザが記録 → 会社プールに蓄積。**ToS リスクゼロ・運用で育つ主軸**。

| method | path | 説明 |
|---|---|---|
| POST | `/api/v1/companies/:id/questions` | 質問を投稿 `{question, role?, stage?, asked_year?}` → upsert (dedup) |
| GET | `/api/v1/companies/:id/questions` | 会社の質問プール取得 (`role`/`stage`/`limit`) |
| POST | `/api/v1/companies/:id/questions/:qid/upvote` | 有用度 +1 |

- 認証は Cernere (既存 `companies` ルートと同じガード)。投稿者 id は**保存しない** (`source='user'` のみ)。
- 投稿本文は質問文のみ受け付け、回答欄は設けない (PII 混入防止 + 規約明示)。

## 3. 供給 B — Notion 手元データ取込

自分/関係者の体験記 Notion DB を**既存 Notion 取込経路を拡張**して company 紐付けで投入。

```
Canalis NotionSource → notionRecordToInterviewQuestions (Tr 側・決定論マッピング)
  プロパティ → { company_name, question, role?, stage?, asked_year? }
        ↓ resolveCompanyByName (normalized_name で companies と突合、無ければ skip or 新規 candidate)
        ↓ upsertInterviewQuestion (source='notion', source_ref=notion page id)
```

- 既存 `scripts/companies-notion-import` と**別 DB / 別マッピング**(企業マスタ取込とは用途が違う)。新 script `companies:notion-questions-import`。
- Notion 側に「会社名」「質問」列がある前提。回答列があっても**取り込まない**(質問文のみ)。
- 会社名→`companies` 突合は `normalized_name`。未登録会社は candidate として最小 upsert してから紐付け。

---

## 4. consumer — 面接質問リスト生成

面接官エンジン (`interviewer-engine.md` §5 init) の質問素材積層に layer 3 を**最優先**で追加する。

```
buildQuestionMaterial(session):
  ② company pool:  company_interview_questions WHERE company_id=… AND stage∈{target,any} AND role∈{target,any}
                   ORDER BY upvotes DESC, asked_year DESC NULLS LAST   ← 最優先
  ① 本人 past_qa:  Memoria RAG (kinds=[past_qa], query=target_company+role)   ← 次点
  汎用 qa-seed:    data/general/qa-seed/<stage>/<role>.json              ← フォールバック
  → 上位 N 件を面接官の「予定質問」シードに。実進行は弁証法エンジンが動的に分岐 (シードは初手/枯渇時に使用)
```

- ②が 0 件の会社は①→汎用に自然縮退 (graceful degradation、RULE_CODE §7)。
- ②は system prompt に**「実際に過去問われた質問」と明示**して面接官に渡す(優先度の根拠)。

---

## 5. ES添削との関係 (補足)

ES添削の「背景情報を含む特化添削」は本書 (layer 3) ではなく **layer 2 = `company_profiles`**(HP enrich の理念/IR/事業)を RAG に食わせて行う。質問プールは**面接側のみ**の素材。両者は別レイヤーとして独立。

---

## 6. 未確定 / 将来

- 投稿質問のスパム/不適切フィルタ (初期は upvote ベースの弱フィルタのみ)。
- ②の鮮度減衰 (`asked_year` が古い質問の重み下げ)。
- 会社横断の「定番質問」抽出 (複数社で頻出する汎用質問の昇格)。
