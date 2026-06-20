# モデル構成 (論点 A) — 3 機種分担 vs collapse

面接推論エンジンのモデル割当を env で切り替え可能にし、「Sonnet 応答 / Opus 評価 /
Haiku judge の 3 機種分担」を必要に応じて collapse できるようにする。

## 役割と既定 (`packages/llm/src/anthropic.ts`)

| 役割 (ModelRole) | 既定 | 用途 |
|---|---|---|
| RESPONSE | Sonnet | 面接官応答 (stream) |
| EVALUATOR | Opus | 6 軸評価 |
| SUMMARIZER | Opus | session サマリ |
| CRITIC | Opus | より良い答え方の提案 |
| EXAMINEE | Haiku | 受験者シミュ (ft-loop) |
| JUDGE | Haiku | reactive 深掘りの回答品質判定 |
| EXTRACTOR | Haiku | 企業ページの構造化抽出 (`spec/companies`) |
| RECOMMENDER | Sonnet | ES × 企業の適合判断 (`spec/companies`) |

> EXTRACTOR / RECOMMENDER は面接エンジン外 (企業クロール + おすすめ企業) の役割。
> 面接ランタイム全体は [`interviewer-engine.md`](./interviewer-engine.md) を参照。

## 切り替え (優先順位: 役割別 env > プロファイル > 既定)

- `TIROCINIUM_MODEL_PROFILE`:
  - `default` — 3 機種分担 (既定)
  - `opus-only` — 応答/受験者/judge も Opus に寄せる (最高品質・高コスト)
  - `economy` — 評価/サマリ/critic を Sonnet に寄せる (低コスト)
- `TIROCINIUM_MODEL_<ROLE>` — 役割を個別に上書き (例 `TIROCINIUM_MODEL_EVALUATOR=claude-opus-4-8`)

## 3 機種分担の是非 (decision-metrics)

| 構成 | AI 学習量 | 作業コスト | 解決度 (面接品質) | 主目的一致 |
|---|---|---|---|---|
| **3 機種分担 (既定)** | 中 | 0 (現状) | 高 (役割最適) | 高 |
| opus-only | 低 | 小 | 最高だが応答レイテンシ増 | 中 (音声でレイテンシ不利) |
| economy | 低 | 小 | 中 (評価が浅くなりうる) | 中 |

結論: **既定は 3 機種分担を維持**。役割ごとに最適 (応答=低レイテンシの Sonnet、
評価=深い Opus、judge=軽量 Haiku) で、音声面接のレイテンシ要件とも噛み合う。
collapse は「品質検証時は opus-only」「コスト抑制時は economy」と**運用で選べる knob**
として用意するに留め、コードの分岐は増やさない。
