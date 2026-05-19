# scripts/ft-loop — FT-like loop CLI

DESIGN §3.9 / spec/feedback の FT-like loop を 1 回起こす CLI。
受験者ペルソナ × 面接官ペルソナで会話シミュ → サマリ → AI critique → 人間評価待ち、
までを生成する。

> 現状は **scaffold (TODO 付き skeleton)**。 LLM 呼び出しは別 PR で実装する。
> 出力ディレクトリの構造とコマンド I/F だけを固定する目的。

---

## 使い方

```bash
$ npx tsx scripts/ft-loop \
    --interviewer hr-warm-40f \
    --examinee examinee-newgrad-programmer-shy \
    --turns 10 \
    --output data/training/sample-sessions/$(date +%Y%m%d)/session-$(uuidgen | cut -c1-8)
```

| Flag | 必須 | 説明 |
|---|---|---|
| `--interviewer` | yes | `data/general/persona/interviewer/<id>.md` の id |
| `--examinee`    | yes | `data/general/persona/examinee/<id>.md` の id |
| `--turns`       | no (default 10) | 会話 turn 数 |
| `--output`      | no (default 自動生成) | 出力ディレクトリ |
| `--dry-run`     | no | LLM 呼び出しせずペルソナ読み込みのみで終了 |

---

## 出力ディレクトリ

```
<output>/
├── conversation.jsonl       # 全 turn ({turn_no, role, text, ts})
├── opus-evaluations.jsonl   # 5-7 turn ごとの Opus 評価
├── summary.md               # §3.7 サマリ (Opus 生成)
├── ai-critique.md           # §3.9 step③ AI セルフ critique
├── human-feedback.json      # §3.9 step④ 人間評価 (CLI 起動時は空テンプレ)
└── meta.json                # interviewer/examinee/turns/seed/model 情報
```

---

## 人間評価の入れ方

CLI 終了後、 ユーザは `human-feedback.json` を編集する:

```json
{
  "session_id": "<uuid>",
  "reviewed_by": "<user>",
  "reviewed_at": null,
  "summary_blocks": {
    "headline":          { "action": "skip" },
    "highlights":        { "action": "skip", "per_item": [] },
    "axes_summary":      { "action": "skip" },
    "growth_points":     { "action": "skip", "per_item": [] },
    "carry_over":        { "action": "skip", "per_item": [] },
    "interviewer_note":  { "action": "skip" }
  },
  "ai_critique": {
    "action": "skip",
    "per_turn": []
  },
  "notes": ""
}
```

`action` を `accept` / `reject` / `edit` に書き換え、 必要なら `edit_payload` を
入れる。 完了後、 別 CLI (or web UI) で DB の `human_feedback` 表に流し込む。

---

## TODO (実装フェーズで埋める)

- [ ] persona md ファイル → DB レコード形式へのパース
- [ ] InterviewerRuntime / ExamineeSimulator の wire-up
- [ ] Opus 評価呼び出し (packages/llm/evaluator)
- [ ] サマリ生成 (packages/llm/summarizer)
- [ ] AI critique (packages/llm/critic)
- [ ] human-feedback.json テンプレ自動生成
- [ ] LLM cost の概算ログ
