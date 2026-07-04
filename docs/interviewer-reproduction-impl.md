# 実装設計書: 面接官再現エンジン P1+P2 (codex 実行用)

本書は `spec/feature/inference/interviewer-reproduction.md` の P1 (Brain 境界) と
P2 (決定的質問プラン + 面接ブリーフ) を、**このリポジトリの知識が無い実装エージェントが
そのまま実装できる**粒度で書いた作業指示書である。設計判断は既に済んでいる —
本書の指示と矛盾する「改善」はしないこと。疑義があれば TODO コメントを残して先へ進む。

---

## 0. リポジトリ規約 (must)

- npm workspaces monorepo (`apps/*`, `packages/*`)。Node >= 22。TypeScript ESM
  (`module: NodeNext`)。**相対 import は `.js` 拡張子必須** (例 `from './phase.js'`)。
- tsconfig は `strict` + `noUncheckedIndexedAccess` + `noImplicitOverride`。
  配列 index アクセスは `!` か undefined ガードが要る (既存コード参照)。
- `packages/llm` のテストは **vitest** (`npm --workspace packages/llm run test`)。
  既存テスト (`phase.test.ts` 等) の書式に合わせる。
- サーバは `apps/server` (Hono + ws)。ビルド確認は `npm run build:server` と
  `npm --workspace packages/llm run build`。
- **migration は不変・追記のみ**。2 系列を両方書く: `apps/server/migrations/` (PG 方言) と
  `apps/server/migrations-sqlite/` (SQLite 方言)。次番号は **024**。SQLite 方言の変換規約は
  `migrations-sqlite/001_init.sql` 冒頭コメント (UUID→TEXT / TIMESTAMPTZ→TEXT /
  JSONB→TEXT(JSON) / BOOLEAN→INTEGER / `uuid_generate_v4()` は driver 登録関数 /
  `datetime('now')`)。
- **無言フォールバック禁止**: 設定・env の不正値は即 throw。一方、実行時の LLM 失敗は
  面接を止めない (warn + 縮退)。この 2 つを混同しない。
- コメントは日本語、既存密度に合わせる。`Math.random` を `packages/llm` 内で直接呼ばない
  (本実装の主目的の一つ)。

## 0.1 触るファイルの現状 (前提知識)

| ファイル | 現状 |
|---|---|
| `packages/llm/src/phase.ts` | 純関数フェーズ機 `nextPhase(PhaseState, PhaseSignals)`。変更不要 |
| `packages/llm/src/response.ts` | `buildSystemPrompt(opts)` / `streamResponse(client, input)` (AsyncGenerator<string>) |
| `packages/llm/src/cli.ts` | `streamResponseCli({systemPrompt, turns, signal, model})` claude CLI 版 stream |
| `packages/llm/src/judge.ts` | `assessAnswer(client, {question, answer, recent})` → `AnswerSignals` |
| `packages/llm/src/refine.ts` | `refine(openaiClient, {turns})` → string |
| `packages/llm/src/evaluator.ts` | `evaluate(client, {turns, turnRange}, opts)` → `Evaluation`。`clampAxes`/`extractJsonBlock` あり |
| `packages/llm/src/types.ts` | `Turn` / `Axes` / `Evaluation` / `InterviewerPersonaInput` |
| `packages/llm/src/index.ts` | パッケージの public export。新規モジュールはここに追記 |
| `apps/server/src/ws/session-runtime.ts` | `SessionRuntime` が上記 5 関数を直接呼ぶ (今回 Brain 経由に置換) |
| `apps/server/src/ws/handler.ts` | WS 接続ごとに `new SessionRuntime(ws, sessionId, userId)` |
| `apps/server/src/routes/sessions.ts` | `POST /api/v1/sessions` で `sessions.metadata` を更新 |
| `apps/server/src/config.ts` | `config.llmBackend: 'api' | 'cli'` (env `TIROCINIUM_LLM_BACKEND`) |
| `data/general/qa-seed/<stage>/programmer.json` | `{stage, role, items: [{theme, question, followups[], axes[], answer_outline}]}` |
| `company_newgrad_role_images` テーブル | migration 006。`(company_id, role)` PK、`summary TEXT`, `themes JSONB` |
| `company_interview_questions` テーブル | **存在しない** (spec のみ)。本実装では供給 interface だけ用意し配線しない |

---

## P1 — Brain 境界 + stub + seed (挙動不変リファクタ)

ゴール: LLM 呼び出しを単一 interface `InterviewerBrain` に集約し、決定的 `StubBrain` を
差し替え可能にする。**`TIROCINIUM_BRAIN` 未設定 (既定 llm) での挙動はバイト単位で現状維持**
(プロンプト文字列・呼び出しタイミング・縮退挙動を変えない)。

### W1: `packages/llm/src/rng.ts` (新規)

```ts
/** 決定的 PRNG。seed → [0,1) の純関数列。依存追加禁止 (mulberry32)。 */
export type Rng = () => number;
export function mulberry32(seed: number): Rng { /* 標準実装 */ }
/** 文字列 seed (uuid 等) を 32bit に落とす FNV-1a。 */
export function hashSeed(s: string): number { /* FNV-1a 32bit */ }
/** テスト用: 固定列を順に返し、尽きたら最後の値を繰り返す。 */
export function seqRng(values: number[]): Rng { ... }
```

テスト `rng.test.ts`: 同 seed 同列 / 異 seed 異列 / seqRng の繰り返し挙動。

### W2: `packages/llm/src/brain.ts` (新規) — interface と文脈型

```ts
import type { Turn, Axes, Evaluation, InterviewerPersonaInput } from './types.js';
import type { Phase, PhaseSignals } from './phase.js';
import type { AnswerSignals } from './judge.js';

export type UtteranceContext = {
  systemPrompt: string;      // buildSystemPrompt 済の文字列 (P1 では組み立てを変えない)
  turns: Turn[];
  signal?: AbortSignal;
};
export type AssessContext = { question: string; answer: string; recent: Turn[] };
export type RefineContext = { turns: Turn[] };
export type EvalContext = { turns: Turn[]; turnRange: [number, number] };

/** LLM の唯一の境界。sim 型 in / sim 型 out。token・SDK client を外に漏らさない。 */
export interface InterviewerBrain {
  composeUtterance(ctx: UtteranceContext): AsyncIterable<string>;
  assessAnswer(ctx: AssessContext): Promise<AnswerSignals>;
  refineFocus(ctx: RefineContext): Promise<string | null>;
  evaluate(ctx: EvalContext): Promise<Evaluation>;
}
```

### W3: `packages/llm/src/llm-brain.ts` (新規) — 既存関数の移設先

`LlmBrain implements InterviewerBrain`。コンストラクタ:

```ts
export type LlmBrainOptions = {
  backend: 'api' | 'cli';                    // config.llmBackend をそのまま受ける
  createAnthropic?: () => Anthropic;         // 既定 createAnthropicClient (テスト差替用)
  createOpenAi?: () => OpenAI;               // 既定 createOpenAIClient
};
```

- `composeUtterance`: backend==='cli' → `streamResponseCli({..., model:'sonnet'})`、
  else → `streamResponse(this.anthropic(), {...})`。**現在の session-runtime.ts の分岐を
  そのまま移す** (generateInterviewerTurn 内の三項演算子)。
- `assessAnswer` / `refineFocus` / `evaluate`: 既存 `assessAnswer` / `refine` / `evaluate` を
  client 生成込みでラップするだけ。`refineFocus` は空文字を `null` に正規化。
- **鍵の有無による enable/skip 判定は Brain に入れない** — それは呼び出し側
  (SessionRuntime) の責務のまま (現行の `judgeEnabled` 等を維持)。

### W4: `packages/llm/src/stub-brain.ts` (新規) — 決定的実装

`StubBrain implements InterviewerBrain`。LLM 呼び出しゼロ、コンストラクタ
`new StubBrain(opts?: { rng?: Rng; synthesisAfter?: number })` (既定 `synthesisAfter=3`)。

- `composeUtterance`: `turns` 中の user 発話数 `n` から
  `質問${n + 1}: これまでの回答を踏まえ、直近の内容を具体例で深掘りさせてください。` の
  1 チャンクを yield する async generator (決定的・入力のみの関数)。
- `assessAnswer`: 内部カウンタで呼び出し回数 `k` を持ち、
  `{ specificity: Math.min(3, k), synthesisReached: k >= synthesisAfter,
     contradictionOpen: k < synthesisAfter, followupHint: undefined }`。
- `refineFocus`: 常に `null`。
- `evaluate`: 全 6 軸 3 固定 (`clampAxes` で生成)、`comment: 'stub evaluation'`,
  `hints: []`, `model: 'stub'`。

テスト `stub-brain.test.ts`: 同入力 2 回で同出力 / synthesisAfter 境界で signal が反転。

### W5: `packages/llm/src/coerce.ts` (新規) — 出力検証 + parse リトライ

既存の `parseAnswerSignals` (judge.ts) と `parseEvaluation` (evaluator.ts) は残し、
LlmBrain 側で 1 回だけ再試行するヘルパを足す:

```ts
/** fn() の結果を parse に掛け、throw したら 1 回だけ fn を再実行する。2 回目も失敗なら throw。 */
export async function withParseRetry<T>(fn: () => Promise<string>, parse: (text: string) => T): Promise<T>;
```

P1 では judge/evaluator 内部の client 呼び出し構造を変えないため、`withParseRetry` の適用は
**evaluate のみ** (`parseEvaluation` が throw するのは既知) とし、judge は現状の
best-effort (呼び出し側 catch) を維持する。無理に配線を広げない。

### W6: `apps/server/src/llm/brain-factory.ts` (新規)

```ts
import { LlmBrain, StubBrain, type InterviewerBrain } from '@tirocinium/llm';
import { config } from '../config.js';

export function createBrain(): InterviewerBrain {
  const mode = process.env['TIROCINIUM_BRAIN'] ?? 'llm';
  if (mode === 'stub') return new StubBrain();
  if (mode === 'llm') return new LlmBrain({ backend: config.llmBackend });
  throw new Error(`TIROCINIUM_BRAIN は 'llm' | 'stub' のいずれか: ${mode}`); // 無言フォールバック禁止
}
```

### W7: `SessionRuntime` の置換 (挙動不変)

- コンストラクタを `(ws, sessionId, userId, brain: InterviewerBrain)` に変更し、
  `handler.ts` の生成箇所で `createBrain()` を渡す。
- 置換対応 (**それ以外のロジック・catch・warn 文言・背景発火は一切変えない**):
  - `generateInterviewerTurn` の `streamResponse`/`streamResponseCli` 分岐
    → `this.brain.composeUtterance({ systemPrompt, turns: this.turns, signal: aborter.signal })`
  - `assessAnswer(createAnthropicClient(), {...})` → `this.brain.assessAnswer({...})`
    (`recent: this.turns.slice(-4)` は必ず配列にして渡す)
  - `runRefineBackground` の `refine(oai, {turns})` → `this.brain.refineFocus({turns})`
    (null なら `refineBlock` を更新しない = 現行の `if (block)` と同じ)
  - `runEvaluationBackground` の `evaluate(client, {...})` → `this.brain.evaluate({...})`
- `llmEnabled` / `judgeEnabled` / `evalEnabled` / `refineEnabled` の算出はそのまま。ただし
  `TIROCINIUM_BRAIN=stub` のときは 4 フラグとも `true` に上書きする (stub は鍵不要のため)。

### W8: session_seed

- `apps/server/src/routes/sessions.ts` のセッション作成成功パス (`decision.kind === 'start'`
  の UPDATE) で `metadata` に `session_seed` を追記する:
  `metadata || ${sql.json({ interviewer_id: ..., session_seed: randomUUID() })}`。
  `crypto.randomUUID()` を使う (ここは「採番」なので乱数で良い。**再現に使うのは記録された値**)。
- `SessionRuntime.init()` で `sess.metadata.session_seed` を読み
  `this.rng = mulberry32(hashSeed(seed ?? this.sessionId))` を保持する
  (P1 では未使用。P2 の質問プランが消費する。フィールドだけ用意し ESLint 的に問題なら
  `void this.rng` 等はせずコメントで P2 参照と書く)。
- migration 不要 (`metadata` は既存 JSONB/TEXT カラム)。

### W9: export と受け入れ基準

- `packages/llm/src/index.ts` に brain/llm-brain/stub-brain/rng/coerce の公開型・関数を追記。
- 受け入れ基準:
  1. `npm --workspace packages/llm run test` green (新規テスト含む)。
  2. `npm run build:server` + `npm --workspace packages/llm run build` が通る。
  3. `grep -rn "Math.random" packages/llm/src` が 0 件。
  4. `TIROCINIUM_BRAIN=llm` (既定) で `buildSystemPrompt` へ渡る引数・LLM 呼び出し順が
     現行と同一 (レビューで diff から確認できるよう、W7 は純粋な置換 commit に分離)。
  5. `TIROCINIUM_BRAIN=foo` で起動時 throw。

---

## P2 — 決定的質問プラン + 面接ブリーフ + 充足ゲート

ゴール: 「何をどの順で聞くか」をセッション開始時に純関数でコンパイルし、seed で再現可能にする。
**feature flag `TIROCINIUM_QUESTION_PLAN=1` の時だけ有効** (未設定時は P1 の挙動のまま)。

### W10: `packages/llm/src/question-plan.ts` (新規・純関数、DB/LLM import 禁止)

```ts
import type { Rng } from './rng.js';
import type { Axes } from './types.js';
import type { Phase } from './phase.js';

export type AxisKey = keyof Axes;
export type QuestionSlot = {
  theme: string;
  question: string;          // 言語化の種。Brain がペルソナ口調に整形する
  followups: string[];
  axes: AxisKey[];
  origin: 'company' | 'newgrad' | 'ob' | 'seed';
};
/** 供給源 1 件。origin ごとに配列で渡す (取得は呼び出し側の責務)。 */
export type QuestionSupply = { origin: QuestionSlot['origin']; items: Omit<QuestionSlot, 'origin'>[] };
export type QuestionPlan = {
  opening: QuestionSlot[];   // 1-2 件
  probe: QuestionSlot[];     // 4-6 件
  pressure: QuestionSlot[];  // 0 or 2-3 件 (personaPressure >= 4 のときのみ)
  closing: QuestionSlot[];   // 1 件 (逆質問促し。固定文でよい)
};

export function compileQuestionPlan(opts: {
  supplies: QuestionSupply[];      // 優先順に並べて渡す: company > ob > newgrad > seed
  weakTop3: AxisKey[];
  personaPressure: number;         // phase.ts の pressureEnabled と同じ閾値 (>=4)
  rng: Rng;
}): QuestionPlan;
```

コンパイル規則 (すべて決定的。`rng` 以外の乱択・Date 参照禁止):

1. 全 supplies を優先順に flatten し、`theme` の重複は先勝ちで除去。
2. スコアリング: `score = (weakTop3 と axes の交差数) * 10 + (優先順位の逆順ボーナス:
   company=3, ob=2, newgrad=1, seed=0)`。同点は `rng` による Fisher–Yates シャッフルで順序決定
   (安定ソート + 事前シャッフルの組み合わせで実装し、テストで seqRng を使って exact assert する)。
3. 割付: `theme` が自己紹介系 (`/自己紹介|自己PR/` に一致) のものを opening へ (無ければ
   固定スロット `質問: 自己紹介を1分でお願いします` origin='seed' を合成)。上位スコアから
   probe に 6 件。`personaPressure >= 4` なら followups を 1 件以上持つスロットから
   pressure に 2 件 (probe と重複させない)。closing は固定文スロット 1 件。
4. 供給合計が probe 最小 4 件に満たない場合もエラーにせず、あるだけで返す
   (プラン枯渇時の挙動は W13 参照)。

テスト `question-plan.test.ts`: 同 seed 同プラン / weakTop3 が優先に効く /
pressure<4 で pressure 空 / 供給不足時の縮退。

### W11: 供給源ローダ (apps/server 側)

`apps/server/src/brief/supplies.ts` (新規):

- `loadSeedSupply(stage: string, role: string): QuestionSupply` —
  `data/general/qa-seed/<stage>/<role>.json` を読む。role ファイルが無ければ
  `programmer.json` に退避し、その事実を戻り値に含めず **呼び出し側で source_meta に記録**する
  ため `{ supply, degraded: boolean }` を返す形にする。items の `theme/question/followups/axes`
  はシードの同名フィールドをそのまま写像 (axes は AxisKey 集合との交差のみ採用)。
- `loadNewgradSupply(companyName: string | null, role: string | null): Promise<{supply: QuestionSupply; imageMeta: object | null}>` —
  `companies.normalized_name` 一致で `company_newgrad_role_images` を引き
  (role 不一致時は `role='general'`)、`themes` (JSON 配列の文字列) 各要素 `t` を
  `{ theme: t, question: `${t} について、あなた自身の経験を交えて教えてください`,
     followups: [], axes: ['target_fit'] }` に機械変換する。企業が引けなければ
  `items: []`。**LLM は呼ばない** (これは決定的経路。LLM での質問生成は P3)。
- company / ob supply は今回作らない (interface 上は origin として存在するだけ)。

### W12: 充足ゲート + ブリーフコンパイル

`apps/server/src/brief/compile.ts` (新規):

```ts
export type BriefSufficiency = 'rich' | 'moderate' | 'sparse';
/** 決定的カウント判定。LLM 不使用。newgradItems>=3 && seed あり → moderate、
    さらに (将来) company/ob 供給ありで rich。newgradItems==0 → sparse。 */
export function assessSufficiency(counts: { newgrad: number; seed: number }): BriefSufficiency;

export type CompiledBrief = {
  bodyMd: string;            // 下記見出し構成の md
  sourceMeta: object;        // { newgrad_image: {...}|null, seed_file, degraded, sufficiency, seed }
  plan: QuestionPlan;
};
export async function compileBrief(opts: {
  targetCompany: string | null; targetRole: string | null;
  interviewer: InterviewerPersonaInput; weakTop3: string[];
  ragBlock: string; seed: string;
}): Promise<CompiledBrief>;
```

- `bodyMd` の見出しは固定順:
  `# 企業と職種` / `# 求める新卒像` (summary + themes 箇条書き。sparse 時は
  `**企業固有データ不足のため一般面接として実施**` を明記) / `# 過去の質問傾向`
  (プランの probe/pressure スロットを origin 付き箇条書き) / `# 受験者の素材`
  (既存 ragBlock をそのまま埋める。空なら「(素材なし)」) / `# 今回の重点` (weakTop3)。
- プランは `compileQuestionPlan` に `mulberry32(hashSeed(seed))` を渡して得る。

### W13: migration 024 + SessionRuntime 配線

migration `024_interview_briefs.sql` (両方言):

```sql
-- PG 方言
CREATE TABLE IF NOT EXISTS interview_briefs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  body_md     TEXT NOT NULL DEFAULT '',
  source_meta JSONB NOT NULL DEFAULT '{}',
  plan        JSONB NOT NULL DEFAULT '{}',
  seed        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS method TEXT NOT NULL DEFAULT 'llm';
```

SQLite 版は 001 の変換規約どおり (UUID→TEXT + `uuid_generate_v4()`、JSONB→TEXT DEFAULT '{}',
now()→`datetime('now')`。SQLite は `ADD COLUMN IF NOT EXISTS` 不可のため
`ALTER TABLE evaluations ADD COLUMN method TEXT NOT NULL DEFAULT 'llm';` を素で書く —
migration runner は各ファイル 1 回しか適用しないので IF NOT EXISTS は不要)。

`SessionRuntime` 配線 (`TIROCINIUM_QUESTION_PLAN=1` のときのみ、`init()` 末尾):

1. 既存 `interview_briefs` 行があれば読む (再接続再現)。無ければ `compileBrief` して INSERT。
2. `this.plan` に保持し、消化位置カーソル `planCursor: Record<Phase, number>` を
   turn 復元から算出 (interviewer turn 数と phase 遷移履歴の再計算はせず、
   **interviewer turn 総数からの単純割付で良い**: opening→probe→… の順で消化済みとみなす)。
3. `generateInterviewerTurn` で現 phase の未消化スロットがあれば、systemPrompt 組み立て後に
   `\n## 今回問うべき質問スロット\n- テーマ: <theme>\n- 質問の種: <question>\n- 深掘り候補: <followups>`
   を追記して Brain に渡し、カーソルを進める。スロット枯渇時は追記なし = 現行挙動
   (LLM の自由質問) に自然縮退。
4. `runEvaluationBackground` の INSERT に `method` 列を追加
   (`TIROCINIUM_BRAIN=stub` なら 'stub'、それ以外 'llm')。
5. judge の `followupHint` は現行どおり `refineBlock` に入れる (スロット選択への反映は P3)。

### W14: golden transcript テスト

`apps/server` 側はテスト基盤が薄いため、golden は `packages/llm` に置く:
`packages/llm/src/golden.test.ts` — `StubBrain` + `seqRng`/`mulberry32(hashSeed('golden-1'))` +
固定 supplies (テスト内リテラル) で `compileQuestionPlan` → 擬似 turn ループ
(`nextPhase` + `StubBrain.assessAnswer`) を 20 turn 回し、
**プランの全 slot 順・phase 遷移列・最終 evaluate 出力を exact assert** する。
このテストが「同 seed 同進行」の回帰防御になる。

### P2 受け入れ基準

1. flag OFF (`TIROCINIUM_QUESTION_PLAN` 未設定) で P1 と完全同挙動 (diff は init の分岐のみ)。
2. flag ON + `TIROCINIUM_BRAIN=stub` で: 同 seed のセッションを 2 回流すと
   `interview_briefs.plan` と面接官発話列が一致する。
3. sparse 判定時、`interview_briefs.source_meta.sufficiency='sparse'` かつ bodyMd に
   一般面接実施の明記がある (無言フォールバック禁止の充足版)。
4. `npm run migrate` が SQLite (既定) で通り、`interview_briefs` が出来る。
5. vitest green (question-plan / golden 含む)。

---

## やらないこと (P3 以降 / 本 PR で触らない)

- `company_interview_questions` テーブルの新設・OB コーパス抽出バッチ
  (`ob_question_patterns`)・OB 仮名化 serializer。
- LLM による充足ゲート / 質問文の LLM 事前生成 / judge の blackbox 卒業。
- `buildSystemPrompt` の積層構造の変更 (ブリーフ md を system に直載せする置換は
  prompt-cache 対応と合わせて P3)。
- Iv / 音声経路、予約、companies クロールへの変更。

## 作業手順

- P1 と P2 は別 PR。ブランチは `feat/interviewer-brain` / `feat/question-plan`
  (main 直編集禁止・自動 merge 禁止は CLAUDE.md 準拠)。
- P1 は「新規ファイル追加 commit」→「SessionRuntime 置換 commit」の 2 段に分け、
  置換 commit が機械的差し替えだけであることをレビュー可能にする。
