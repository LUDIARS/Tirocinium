# data/training/ — FT-like loop 蓄積データ

DESIGN §3.9 で生成される **半自動の教師データ拡張ループ** の出力先。
受験者ペルソナ × 面接官ペルソナで会話 → サマリ → AI critique → 人間評価
を 1 サイクルとして session 単位で格納する。

---

## ディレクトリ構造

```
data/training/
├── sample-sessions/      # CLI で生成した会話セッション
│   └── <YYYY-MM-DD>/
│       └── session-<id>/
│           ├── conversation.jsonl
│           ├── opus-evaluations.jsonl
│           ├── summary.md
│           ├── ai-critique.md
│           ├── human-feedback.json
│           └── meta.json
└── README.md (本ファイル)
```

---

## ファイル仕様

### conversation.jsonl

1 行 1 turn の JSON Lines:

```json
{"turn_no": 1, "role": "interviewer", "text": "自己紹介を 1 分でお願いします。", "ts": "2026-05-19T10:00:00Z"}
{"turn_no": 2, "role": "user", "text": "中村と申します...", "ts": "2026-05-19T10:00:42Z"}
```

### opus-evaluations.jsonl

```json
{
  "turn_range": [1, 5],
  "scored_at": "2026-05-19T10:03:00Z",
  "axes": {"consistency": 3, "clarity": 2, "demeanor": 1, "self_understanding": 3, "target_fit": 3, "depth_resilience": 2},
  "comment": "...",
  "hints": ["結論先出しを意識", "..."],
  "model": "claude-opus-4-7"
}
```

### summary.md

§3.7 のサマリ。 headline / highlights / axes_summary / growth_points /
carry_over / interviewer_note の 6 ブロックを Markdown で構造化。

### ai-critique.md

§3.9 step③ の AI セルフ critique。 turn ごとに「より良い答え方」 を提案。

### human-feedback.json

§3.9 step④ の人間評価。 CLI 生成時は空テンプレ。 ユーザが手で編集 (or 専用 UI で)。

### meta.json

interviewer / examinee の id、 使用 LLM、 turn 数、 実行時刻。

---

## 利用

蓄積されたデータは:

1. **一般解 QA seed (`data/general/`) の改稿候補** として参照される (どの質問で
   どんな弱点が出やすいかが見える)
2. **弱点プロファイル EMA の係数調整** の素材になる
3. **Memoria 側 embedding seed** の対象 (RAG で「過去にこういう答えをした」 を引ける)

直接的な **fine-tune は行わない** (DESIGN §3.2.3 と整合)。

---

## ライセンス

サンプル会話は LUDIARS 内部用。 公開リポであるが、 個人情報を一切含まないテスト
データとして配置する。 外部の実会話は **絶対に置かない**。
