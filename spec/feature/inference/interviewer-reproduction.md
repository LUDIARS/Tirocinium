# 面接官再現エンジン — 決定的コア + Brain 境界 + 学習データ接地

「面接官の再現をアルゴリズムでやる」ための設計。**再現 = 2 つの意味**を同時に満たす:

1. **忠実性 (fidelity)** — 実在企業の面接官らしさを、学習データ (企業が求める新卒像 / OB の
   ES・ポートフォリオ・面接受け答え) に**接地**して再現する。LLM の想像で面接官を演じない。
2. **再現性 (reproducibility)** — 同じ入力 (seed + トランスクリプト + 学習データ snapshot) から
   同じ面接進行が**決定的に**再生できる。テスト・監査・回帰検証が可能。

> **実装状況 (2026-07-17)**: P1 (Brain 境界 / StubBrain / coerce / session_seed / 注入 rng) と
> P2 (質問プラン / interview_briefs = migration 024 / 充足ゲート / role-aliases / 供給源配線) は
> 実装済み。プラン駆動は `TIROCINIUM_QUESTION_PLAN=1` の feature flag で並走中 (§8)。
> P3 (OB 抽出バッチ / judge blackbox / リプレイ CLI) は未着手。
> タスク分解: `spec/plan/interview-engine-voicevox-tasks.md`。

既存ランタイム ([`interviewer-engine.md`](./interviewer-engine.md)) と弁証法理論
([`dialectic-engine.md`](./dialectic-engine.md)) の**上に載せる**設計であり、置き換えではない。
参考実装: Pagus (`Brain` DI / 注入 rng / coerce 検証 / stub テスト)、
Discutere (`discussion_paper` md 正本 / 情報ゲート / 外部の声 RAG / 仮名化 serializer)。

---

## 1. 現状と差分 (何が足りないか)

既にあるもの (流用する):

| 部品 | 場所 | 再現性の観点での評価 |
|---|---|---|
| フェーズ状態機 | `packages/llm/src/phase.ts` `nextPhase` | ✅ 純関数。決定的 |
| 判定→signal | `packages/llm/src/judge.ts` | △ LLM 直呼び。境界なし・検証ゆるい |
| 6 軸評価 + EMA | `evaluator.ts` + `weakness-math.ts` | △ EMA は決定的だが評価は LLM 任せ |
| system prompt 積層 | `response.ts` `buildSystemPrompt` | △ 決定的だが素材 (RAG/refine) が揮発 |
| QA シード | `data/general/qa-seed/<stage>/<role>.json` | ✅ theme/question/followups/axes 構造化済 |
| 求める新卒像 | `company_newgrad_images` / `company_newgrad_role_images` (migration 005/006) | ✅ 蓄積済。**ただし面接に未配線** |
| 企業別質問プール | `company_interview_questions` | ✅ 同上、未配線 |
| Memoria RAG | `packages/training/memoria-client.ts` → `ragBlock` | △ 検索一発。キーワード分解・別名なし |

足りないもの (本 spec の対象):

- LLM 呼び出しの**単一境界**が無い (response/judge/refine/evaluator が各自 SDK/CLI を握る)
  → stub 差し替え不能 = エンジンの決定的テストが turn 単位でしかできない。
- **seed が無い** — 質問の選択・順序が毎回 LLM 判断で、同条件でも面接が再生できない。
- **質問戦略が LLM 任せ** — 「何をどの順で聞くか」がプロンプト頼み。学習データが戦略に効かない。
- 学習データの**充足判定**が無い — 企業データが薄いのに企業面接を装ってしまう。
- LLM 出力の**型検証が緩い** — judge/evaluator の JSON parse 失敗時の挙動が場当たり。

---

## 2. 三分の責務 (Pagus §3.1 の面接版)

型レベルで分離し、依存方向を固定する:

| 責務 | 担当 | 実体 |
|---|---|---|
| **進行 = プログラム** | 決定的コア | フェーズ機・質問プラン・turn 予算・EMA。純 TS、LLM/DB 非依存 |
| **発話 = AI** | `InterviewerBrain` 越しのみ | 質問の言語化・回答判定・6 軸評価・講評 |
| **材料 = 蓄積** | 学習データ層 | 新卒像 / 質問プール / OB コーパス / QA シード → 面接ブリーフに焼く |

不変条件: **決定的コアは LLM を import しない** (Pagus sim と同じ)。コアが決めるのは
「今どのフェーズで、どの質問スロットを、どの深さで聞くか」まで。それを自然な面接官発話に
するのが Brain。**戦略の再現性はコアが担保し、表現の自然さだけを LLM に払い出す**。

---

## 3. `InterviewerBrain` — LLM の唯一の境界

`packages/llm/src/brain.ts` (新規) に定義。sim 型 in / sim 型 out、token やクライアントを漏らさない:

```ts
export interface InterviewerBrain {
  /** 質問スロット + 文脈 → 面接官発話。stream は WS 逐次送信のため AsyncIterable */
  composeUtterance(ctx: UtteranceContext): AsyncIterable<string>;
  /** 直前 Q&A → フェーズ signal (synthesisReached / contradictionOpen / followupHint) */
  assessAnswer(ctx: AssessContext): Promise<PhaseSignals & { followupHint?: string }>;
  /** フェーズ遷移時の深掘り論点 (現 refine 相当) */
  refineFocus(ctx: RefineContext): Promise<string | null>;
  /** 6 軸評価 (現 evaluator 相当) */
  evaluate(ctx: EvalContext): Promise<AxisScores>;
}
```

- **実装は 2 つ**: `LlmBrain` (既存 response/judge/refine/evaluator を内側に移設。
  api/cli 切替は現行 `llmBackend` のまま) と `StubBrain` (決定的テンプレート —
  質問スロットの `question` をそのまま発話し、signal は「N turn 目で synthesis」等の
  カウンタ規則で返す)。
- **選択は env `TIROCINIUM_BRAIN=llm|stub`** (既定 `llm`)。不正値は即 throw
  (無言フォールバック禁止、Pagus `PAGUS_BRAIN` と同型)。
- `SessionRuntime` は Brain をコンストラクタ注入で受ける。judge/refine/evaluate の
  「背景発火・クリティカルパスに乗せない」原則 (engine spec §2) は呼び出し側に残る。

**出力検証**: `packages/llm/src/coerce.ts` (新規) に手書き `coerceSignals` / `coerceAxes` /
`coerceFocus`。原則 = **clamp できるものは clamp、構造違反は throw** (Pagus `json-coerce.ts` 流)。
リトライは 2 層: transport (CLI/API の一過性失敗、既存 retry) + parse (coerce throw で 1 回だけ
再呼び出し)。それでも失敗したら engine spec §7 の劣化表に従い signal は `DEFAULT_SIGNALS` へ。

---

## 4. 決定的質問プラン (アルゴリズム面接官の核)

**面接官の戦略を「セッション開始時にコンパイルされる決定的なプラン」にする**。ここが
「アルゴリズムで再現」の本体。`packages/llm/src/question-plan.ts` (新規、純関数):

```ts
export type QuestionSlot = {
  theme: string;            // 例: ガクチカ / 志望動機 / 技術選定の根拠
  question: string;         // 言語化の種 (Brain が persona 口調に整形)
  followups: string[];      // 深掘り候補 (弁証法の「反」の種)
  axes: AxisKey[];          // この質問が測る評価軸
  origin: 'company' | 'newgrad' | 'ob' | 'seed';  // 出所 (監査用)
};
export function compileQuestionPlan(brief: InterviewBrief, weakTop3: AxisKey[],
  rng: () => number): QuestionSlot[];
```

コンパイル規則 (すべて決定的):

1. **供給源の優先順**: `company_interview_questions` (実企業の過去問) >
   OB コーパス由来の質問パターン > `company_newgrad_role_images` の themes から導出 >
   `qa-seed/<stage>/<role>.json` (一般解)。上位が埋まらないスロットだけ下位で埋める。
2. **弱点駆動の重み**: `weak_top3` の軸を `axes` に含むスロットを優先採用
   (既存の弱点ブロックを「プロンプトのお願い」から「プランの構造」に格上げする)。
3. **phase 割付**: `PHASE_SPECS` の minTurns/maxTurns に合わせ opening 1-2 / probe 4-10 /
   pressure 2-4 / closing 1-2 でスロットを配る。pressure スロットは `followups` を「反」として持つ。
4. **乱択は注入 rng のみ** — 同点スロットのシャッフル等は全部 `rng` 経由。
   `Math.random` 直呼び禁止 (Pagus `TermMachineOptions.rng` と同じ規約)。

**seed**: セッション作成時に `session_seed` を採番して `sessions.metadata` に永続化。
rng は seed から得る決定的 PRNG (mulberry32 等の 30 行実装で足りる。依存追加不要)。
→ **同じ seed + 同じブリーフ = 同じプラン**。再接続復元 (`init` の turn 復元) でもプランが再現する。

実行時: `SessionRuntime` は現フェーズの未消化スロットを順に取り、`composeUtterance` に渡す。
judge の `followupHint` は**スロット内 followup の選択**に使う (プラン外の脱線は refineFocus が
提案し、採用しても `origin` 付きでプランに追記 = 逸脱も記録される)。

---

## 5. 面接ブリーフ (Interview Brief) — md 正本

Discutere `discussion_paper` の面接版。**セッション前にコンパイルし、セッション中は不変**
(prompt cache 安定 + 再現性の入力を 1 点に固定する)。

- **内容** (md 見出し固定): `# 企業と職種` / `# 求める新卒像` (newgrad_role_images の
  summary+themes) / `# 過去の質問傾向` (質問プール + OB 受け答え由来パターン) /
  `# 受験者の素材` (Memoria RAG 抜粋: ES / ポートフォリオ / past_qa) / `# 面接官ペルソナ` /
  `# 今回の重点` (weak_top3)。
- **正本は md** (`interview_briefs.body_md`)。`buildSystemPrompt` の積層 4-7 段
  (ペルソナ/弱点/RAG/refine) のうち**素材系はブリーフから読む**形に寄せ、system の不変部を
  最大化する (揮発するのは refineBlock と会話履歴だけ)。
- **永続化**: 新テーブル `interview_briefs` (migration 024):
  `id, session_id UNIQUE, body_md, source_meta JSON (使った newgrad image id / 質問プール id /
  Memoria ref / データ snapshot 日時), seed, created_at`。
  版管理が要るのは事前編集を入れる時だけなので、初版は revision 無しでよい
  (入れるなら Discutere `paper-revisions` の「戻す = 前進積み直し」方式)。
- **監査**: ブリーフ + seed + トランスクリプトが揃えば面接が説明可能。
  「なぜこの質問をしたか」= スロットの `origin` とブリーフの `source_meta` で追える。

---

## 6. 学習データパイプライン

### 6.1 データ責務 (CLAUDE.md 準拠 — ここは譲らない)

| データ | 本文の置き場 | Tr が持つもの |
|---|---|---|
| 企業が求める新卒像 | Tr (公開情報キャッシュ) | `company_newgrad_*` そのまま |
| 企業別質問プール | Tr (公開情報) | `company_interview_questions` そのまま |
| OB の ES / ポートフォリオ | **Memoria** | `training_data_refs` (URI + embedding + tags) のみ |
| OB の面接受け答え (Q&A) | **Memoria** | 同上 + **派生特徴** (§6.2) |

生の ES・トランスクリプトを Tr の DB に複製しない。裏口 (`backdoor_alumni`) からの
提供導線では Cernere 本人アンカーで同意を取り、Memoria へ直接格納する。

### 6.2 OB コーパス → 質問パターン抽出 (バッチ、面接時ではない)

面接のクリティカルパスで生データを毎回引くのではなく、**バッチで派生特徴に蒸留**して
Tr 側に置く (個人情報を含まない形):

- 新テーブル `ob_question_patterns` (migration 024): `company_id, stage, role, theme,
  question_pattern, followup_patterns JSON, axes JSON, source_refs JSON (Memoria URI),
  contributor_alias` — 質問の**型**だけを持ち、回答本文は持たない。
- 抽出は `scripts/` の新バッチ (EXTRACTOR ロール = Haiku、model-profiles 準拠)。
  抽出結果も `coerce` で型検証。
- **仮名化は serializer で** (Discutere §6 と同じ「出所は透明 / 個人は仮名」):
  ブリーフ・UI に出るのは `OB#xxxx` (cernere_user_id からの決定的ハッシュ短縮)。
  企業名・stage・年度は透過。生 ID の参照は admin のみ。

### 6.3 検索の取りこぼし対策 (Discutere の教訓を先取り)

Memoria RAG / 質問プール検索の query は素の連結文字列にしない:

- `keyword-terms` 方式の**素朴分解** (句読点/助詞 split、依存ゼロ) で
  `target_company + target_role + weak_top3` を検索語に分解。
- **職種/技術の別名辞書** (`role-aliases.ts` 新規): 「FE⇄フロントエンド」「プランナー⇄企画」
  「UE⇄Unreal Engine」等の静的辞書 + `companies.normalized_name` 由来の社名別名。
  Discutere `game-aliases` は略称未展開で検索 0 件を長期間見逃した — 同じ穴を最初から塞ぐ。

### 6.4 充足ゲート (面接開始前の 1 回)

Discutere `information-gate.ts` の縮小版。セッション作成時にブリーフ材料の充足を判定:

- **判定は決定的カウントを一次** (LLM ゲートは後回しでよい): 新卒像あり? role image あり?
  質問プール N 件? OB パターン N 件? → `rich / moderate / sparse` を機械判定。
- sparse なら**一般解シード (`qa-seed`) へ明示的に退避**し、ブリーフに
  「企業固有データ不足 (一般面接として実施)」を明記 + `interview_briefs.source_meta` に記録。
  **企業面接のふりをした一般面接を無言でやらない** (無言フォールバック禁止の面接版)。
- 不足時に crawl を回す自動学習ループ (Discutere 流) は非同期ジョブとして P3。
  面接開始を crawl で待たせない。

---

## 7. 再現性の担保 — メカニズム一覧

| # | メカニズム | 実現手段 |
|---|---|---|
| 1 | 進行の決定性 | `nextPhase` 純関数 (既存) + 質問プラン純関数 (§4) |
| 2 | 乱択の決定性 | `session_seed` 永続化 + 注入 rng。`Math.random` 直呼び禁止 |
| 3 | 入力の固定 | ブリーフ md 正本 + `source_meta` snapshot (§5) |
| 4 | LLM の隔離 | `InterviewerBrain` 単一境界 + `StubBrain` (§3) |
| 5 | 出力の型保証 | `coerce*` throw 検証 + 2 層リトライ (§3) |
| 6 | 評価の監査可能性 | `evaluations` に `method` (llm/stub) / model id / prompt hash を追記。EMA は既存の純関数 |
| 7 | 回帰テスト | **golden transcript**: StubBrain + 固定 seed + 固定ブリーフで全セッションを流し、プラン・フェーズ遷移・EMA 結果を exact assert (Pagus `term-machine.test.ts` の一巡テスト方式) |
| 8 | リプレイ | `scripts/sim-loop` を拡張し `--seed --brief` 指定で過去セッションを再生。judge 差し替え比較 (A/B) に使う |

LLM の発話**文面**そのものは決定的にしない (温度 0 固定もしない)。再現性の対象は
**戦略・進行・評価の構造**であり、表現の揺らぎは面接練習としてむしろ価値。
「何を聞いたか」はスロット単位で決定的、「どう言ったか」は揺らいでよい、が線引き。

### 7.1 判定の卒業 (P3、Pagus fate-blackbox 方式)

judge (Haiku) の signal 判定は蓄積すると規則化できる (例: 回答長 < N かつ具体名詞ゼロ →
synthesis 不成立)。`@ludiars/blackbox` で判例を蓄積し、卒業した規則は LLM を
ショートサーキット → judge が段階的に決定的関数へ置き換わる。ローカルモード
(ollama 級で judge が弱い環境) の品質底上げにもなる。

---

## 8. 実装フェーズ

| フェーズ | 内容 | 効果 |
|---|---|---|
| **P1** | `InterviewerBrain` + `StubBrain` + `coerce` + `session_seed` + 注入 rng。既存 4 呼び出しを Brain に移設 (挙動不変のリファクタ) | エンジン全体の決定的テストが可能に |
| **P2** | `compileQuestionPlan` + `interview_briefs` (migration 024) + 充足ゲート (カウント版) + `role-aliases` + newgrad/質問プール配線 | 学習データが面接戦略に効く。golden transcript 開始 |
| **P3** | `ob_question_patterns` 抽出バッチ + OB 仮名化 serializer + judge blackbox + リプレイ CLI + (必要なら) LLM 充足ゲート | OB データ接地 + 判定の卒業 |

P1 は既存挙動を変えないリファクタなので単独 PR。P2 以降は feature flag
(`TIROCINIUM_QUESTION_PLAN=1` 等) で既存のプロンプト駆動と並走させ、sim-batch で比較してから既定化。

---

## 9. 非目標

- **fine-tune はしない** — 接地は RAG + ブリーフ + プラン (DESIGN §3.2.2 の疑似学習方針を維持)。
- 生 ES / トランスクリプトの Tr 保管はしない (Memoria/Cernere の責務)。
- 発話文面のバイト一致再現はしない (§7 の線引き)。
- STT/TTS は Iv のまま (本 spec は無関係)。
- 弁証法サイクルの理論変更はしない — `dialectic-engine.md` の遷移規則をプランの器として使うだけ。
