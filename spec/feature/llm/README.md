# llm モジュール

複合 LLM オーケストレータ。**Sonnet (応答)** + **GPT-5.5 (深掘り誘導)** +
**Opus (評価)** の 3 機種を 1 セッションで協調動作させる。

DESIGN.md §3.3 / §3.4 の実装視点。

---

## 役割分担 (再掲)

| 層 | モデル | 同期/非同期 | 頻度 |
|---|---|---|---|
| 応答生成 | Sonnet | 同期 stream | 毎 turn |
| 深掘り補正 | GPT-5.5 | 非同期 | 5-10 turn ごと |
| ペルソナ評価 | Opus | 非同期 | 5-7 turn ごと |

「同期 stream」= ユーザ発話が確定したら即 token を流す。
「非同期」= バックグラウンドで走らせ、終わったら hot-swap or UI 通知。

---

## システムプロンプト構造

5 段重ね (DESIGN §3.5 で persona 段が追加):

1. **静的 root** (どの session も共通) — 面接官ロール、 態度、 評価軸の説明、 安全策
2. **面接官ペルソナ** — `interviewer_personas` から `display_name / bio / temperament /
   pressure / tics` を埋め込み。 RAG クエリの `stage + role_lens` filter にも使う
3. **弱点プロファイル** — `weakness_profiles.weak_top3` を「今回特に問う軸」 として明示
4. **session 開始時 RAG** — Memoria の vector search で取得した本人素材 + 一般解 top-N
   query = `(志望企業 tag + 弱点プロファイル top3 + stage tag + role tag)`
5. **GPT-5.5 補正** — 5-10 turn ごとに上書きされる「次に深掘りすべき論点」

= Sonnet の system prompt は `(1) + (2) + (3) + (4) + (5)` の concat、 (5) のみ
session 中に揺れる。 (2)-(4) は session 開始時に固定。

prompt cache 観点では `(1) + (2) + (3) + (4)` をキャッシュ単位とし、 (5) との
境目に cache_control breakpoint を置く (Anthropic ephemeral 5min)。 (2) は再利用
されやすいので、 同一ペルソナで session を立ち上げ続けるとキャッシュ命中率が高い。

---

## 受験者ペルソナ (テスト/FT loop)

DESIGN §3.6 の受験者役。 別の LLM プロセスで Haiku を回す想定。

```ts
class ExamineeSimulator {
  constructor(opts: { persona: ExamineePersona, llm: AnthropicClient });

  // 面接官からの質問を受けて、 ペルソナに沿った回答を生成
  async respond(question: string, history: Turn[]): Promise<string>;
}
```

ExamineeSimulator の system prompt は:
- 役柄定義 (background / target_role / speech_style)
- 弱点バイアス (weakness_axes に応じて「沈黙が多い」 「結論先出しが弱い」 等の
  intentional_flaws を実装)
- 「面接の受け答えとして自然な範囲で」 という安全策

Sonnet との切り替え可能 (cost と品質のトレードオフ)。

---

## token stream の取り回し

```ts
class LLMOrchestrator {
  async *streamResponse(userText: string, ctx: SessionContext) {
    const sysPrompt = ctx.systemPrompt;  // 3 段重ね済
    const stream = this.response.messages.stream({
      model: 'claude-sonnet-4-6',
      system: sysPrompt,
      messages: ctx.turnsAsMessages(),
      max_tokens: 1024,
    });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta') yield ev.delta.text;
    }
  }
}
```

- ストリーム中に `barge_in` が来たら `stream.controller.abort()`
- 完了 → `text_uri` 払い出し (Memoria に POST) → DB に `session_turns` 行追加

---

## GPT-5.5 補正 (非同期)

```ts
async refineSystemPrompt(history: Turn[]): Promise<string> {
  const summary = await this.deep.chat.completions.create({
    model: 'gpt-5.5-x',
    messages: [
      { role: 'system', content: REFINE_INSTRUCTION },
      { role: 'user', content: serializeHistory(history) },
    ],
  });
  return summary.choices[0].message.content;
}
```

- 戻り値を `ctx.systemPrompt` の (3) スロットに差し替え
- 次の Sonnet 呼び出しから反映

---

## Opus 評価 (非同期)

```ts
async evaluate(history: Turn[]): Promise<Evaluation> {
  const res = await this.eval.messages.create({
    model: 'claude-opus-4-7',
    system: EVAL_INSTRUCTION,
    messages: [{ role: 'user', content: serializeHistory(history) }],
  });
  return parseEvaluation(res.content);  // JSON expected
}
```

- 出力は `axes: { consistency:0-5, clarity:0-5, ... } + comment + hints[]`
- WS で `eval` フレームとしてクライアントへ push
- DB の `evaluations` に永続化
- **弱点プロファイル更新も同時に実行** (下記)

---

## サマリ生成 (session 終了時)

DESIGN §3.7 を実装。 session が `ended` になったタイミングで Opus を 1 回呼ぶ。

```ts
async function generateSummary(sessionId: string): Promise<InterviewSummary> {
  const ctx = await buildSummaryContext(sessionId);
  // ctx = { turns[], evaluations[], persona, weakness_profile, target_company }

  const res = await this.eval.messages.create({
    model: 'claude-opus-4-7',
    system: SUMMARY_INSTRUCTION,                  // JSON schema を含む
    messages: [{ role: 'user', content: serializeSummaryInput(ctx) }],
    response_format: { type: 'json_object' },     // 構造化出力
  });
  return parseSummary(res.content);
}
```

- 出力 schema: `{ headline, highlights[], axes_summary, growth_points[],
  carry_over[], interviewer_note }`
- 失敗時は再試行 (構造化出力が壊れたら再生成)
- 完了後 `interview_summaries` に upsert + クライアントへ WS push (or REST GET)

---

## AI セルフ critique (FT-like loop §3.9 step③)

サマリ生成と別に、 受験者の回答に対して「より良い答え方」 を Opus に生成させる。
出力は人間レビュー (§3.8) の素材になる。

```ts
async function critiqueTurn(turn: UserTurn, ctx: SessionContext): Promise<Critique> {
  const res = await this.eval.messages.create({
    model: 'claude-opus-4-7',
    system: CRITIQUE_INSTRUCTION,
    messages: [/* ペルソナ + 質問 + 受験者の回答 */],
  });
  return parseCritique(res.content);  // { better_answer, axes_lifted: ['clarity', ...], rationale }
}
```

- 1 session 内で全 turn をやると重いので **growth_points の根拠 turn だけ** に絞る
- 出力は `data/training/sample-sessions/<id>/ai-critique.md` に保存 (永続化 = FT-like
  loop 用)、 DB には保存しない (session レベルで揮発)

---

## 弱点プロファイル更新サイクル

評価が出るたびに `weakness_profiles` を EMA で更新:

```ts
async updateWeaknessProfile(userId: string, evalResult: Evaluation) {
  const ALPHA = 0.3;
  const cur = await db.getProfile(userId);  // 無ければ初期化
  const next = {
    axes_ema: mapAxes(cur.axes_ema, (axis, v) =>
      ALPHA * evalResult.axes[axis] + (1 - ALPHA) * v
    ),
    axes_variance: ...,                      // online variance も同時更新
    weak_top3: topNAxes(next.axes_ema, 3, 'asc'),  // 弱い軸 = score 低い
    hint_history: [...cur.hint_history.slice(-49), ...evalResult.hints],
    session_count: cur.session_count + 1,
  };
  await db.saveProfile(userId, next);
}
```

注意:
- session 中に複数回 evaluate される (5-7 turn ごと)。 各回で `axes_ema` が動く。
- session が終わるまで `weak_top3` は **同 session の system prompt には反映しない**
  (混乱を避ける)。 次回 session の (2) スロットに反映される。
- 例外: 著しく低スコア (< 1.5) が出たら、 即時に GPT-5.5 補正 (4) に「今すぐこの軸を深掘り」 を投入。

---

## prompt caching

- 静的 root + session 開始時 RAG は **`cache_control: ephemeral` 5分** (Anthropic) で再利用
- session が長引く場合 ephemeral_1h を検討
- GPT-5.5 補正後は cache 部分が変わるので、cache breakpoint は (1)+(2) と (3) の境目に置く

---

## モデル選定の根拠 (記録)

- Sonnet → 速度と日本語品質。response stream は遅延優先。
- Opus → 評価は思考の深さが要る。turn ごとには走らせず数 turn まとめて。
- GPT-5.5 → Anthropic 系と異なる視点で深掘り題を出させる。文化的に Anthropic だと
  「全肯定的」になりがちなので、対抗パースペクティブを混ぜる。

代替案 (将来):
- 全 Anthropic で揃える (Opus 評価 + Sonnet 応答 + Haiku 補正)
- ローカル代替: Llama-3.1-70B (応答) + Qwen-32B (評価) で全 self-hosted
