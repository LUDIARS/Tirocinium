# Tirocinium (Tr)

> *tīrōcinium* (lat.) — 新兵訓練、初任修練。本番前の本気の試行錯誤。

LUDIARS の面接練習アプリ。
本人の **ES / ポートフォリオ / 過去面接問答** を教師データに持つ AI を相手に、
**音声対話** で面接を反復練習し、Sonnet ストリームで応答を返しつつ
適度な分量で **ペルソナ評価** を返すサービス。

---

## 主な特徴

| | |
|---|---|
| モード | **ローカル** (1 人で完結) / **サーバー** (共有モデル + 履歴同期) |
| 過負荷時 | サーバー枠が埋まったら **予約** に誘導し、空き枠で順次実行 |
| 面接相手 | 本人の ES / ポートフォリオ + 過去 Q&A を学習した教師データ AI |
| 入力 | **音声** → STT (Imperativus 経由) → テキスト解釈 |
| LLM 構成 | **GPT-5.5 + Opus + Sonnet** の複合。Sonnet が応答ストリーム、上位 2 機種が評価/教師調整 |
| 出力 | リアルタイム応答 + 一定 turn ごとに **ペルソナ評価** (態度 / 論旨 / 主張一貫性 etc.) |

---

## ステータス

ローカル実装フェーズ。server / desktop / companies / voice / llm / training の基本実装と CI は存在する。

- `spec/` — AIFormat 準拠の構造化仕様 (schema / web / code / module)
- `DESIGN.md` — 機能要件と予約フロー設計
- `apps/server` — API / WS / SQLite 既定のバックエンド
- `apps/desktop` — Vite + React + Tauri のフロントエンド

---

## ライセンス

未定 (LUDIARS 既定に従う)。
