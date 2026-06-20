# feedback モジュール

人間フィードバック loop + FT-like loop の中核。 DESIGN §3.8 / §3.9 を実装する。

---

## 責務範囲

| 持つ | 持たない |
|---|---|
| サマリ / hint / RAG ref / critique への accept/reject/edit 履歴 | 評価本体 (Opus の生成 = `evaluations` 表) |
| 弱点プロファイル更新ロジックの「反映」 | EMA の数式 (それは `llm` 側) |
| FT-like loop の orchestration | LLM の呼び出し本体 (それは `llm` 側) |

---

## human_feedback への反映ルール

DESIGN §3.8 に基づき、 行為が `human_feedback` に append される時に追加で:

### target_kind = `growth_hint`
- `action='accept'` → `weakness_profiles.hint_history` に **accepted=true** タグで残す
- `action='reject'` → 同じ hint を **次回 Opus 呼び出しの suppress list** に入れる
  (system prompt に 「以下の hint は出さないこと: ...」 を追加)

### target_kind = `rag_ref`
- `action='accept'` → 対象 `training_data_refs` の weight を +0.1 (上限 2.0)
- `action='reject'` → 同 weight を -0.1 (下限 0.1)
- EMA 平滑化: weight_new = 0.7 * weight_cur + 0.3 * weight_delta

### target_kind = `summary_block`
- 編集された場合 (`action='edit'`) は edit_payload を accepted 版として扱う
- accept/reject は **interviewer_persona の `evaluation_bias`** に微反映する余地
  (例: clarity ブロックが頻繁に reject されるならその面接官の clarity bias を下げる)
  → これは admin operation として別管理 (即時反映しない)

### target_kind = `ai_critique`
- §3.9 step③ の出力に対するフィードバック
- accept → 次の critique で同じパターンを採用する seed として data/training/ に追加
- reject → 当該 critique を捨て、 一般解 QA seed の見直し候補 issue を発行

---

## FT-like loop の orchestration

`scripts/ft-loop` CLI:

```bash
$ npx tsx scripts/ft-loop \
    --interviewer hr-warm-40f \
    --examinee examinee-newgrad-programmer-shy \
    --turns 10 \
    --output data/training/sample-sessions/$(date +%Y%m%d)
```

内部処理:

```ts
async function runFtLoop(opts) {
  const session = await createInternalSession(opts.interviewer, opts.examinee);

  const interviewer = new InterviewerRuntime(opts.interviewer);
  const examinee    = new ExamineeSimulator({ persona: opts.examinee });

  for (let t = 0; t < opts.turns; t++) {
    const q = await interviewer.askNext(session);
    const a = await examinee.respond(q, session.history);
    await session.appendTurn(q, a);
    if ((t + 1) % 5 === 0) {
      const ev = await evaluator.evaluate(session.history);
      await session.appendEvaluation(ev);
    }
  }

  const summary = await summarizer.generate(session.id);
  const critique = await critic.critiqueGrowthPoints(session, summary);

  await persistOutputs(opts.output, session, summary, critique);
  console.log(`session ${session.id} done, awaiting human review`);
}
```

完了後、 ユーザは `data/training/sample-sessions/<date>/<session-id>/human-feedback.json`
を編集 (or 専用 UI) して accept/reject を入れる。

---

## API

| Method | Path | 説明 |
|---|---|---|
| POST   | `/api/v1/feedback` | 1 件のフィードバックを記録 |
| GET    | `/api/v1/feedback?session_id=:id` | session 単位の取得 |
| POST   | `/api/v1/ft-runs` | FT-like loop を 1 回起動 (admin only) |
| GET    | `/api/v1/ft-runs/:id` | 進捗・結果取得 |

---

## ローカルモード

ローカルは `human_feedback` のみ持つ (個別練習でも改善 hint への accept/reject は
できる)。 FT loop はサーバーモード専用。
