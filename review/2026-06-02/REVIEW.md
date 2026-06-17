# AI Code Review — LUDIARS/Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ | main |
| レビュー実施日 | 2026-06-02 |
| 対象コミット範囲 | 2026-05-23 以降 (11 commits, 3490878..b669ba8) |
| 前回レビュー | 2026-05-23 (High 2件: WS token query param / LLM JSON parse fail catch) |

## ステータス

設計フェーズから本格実装フェーズへ。直近 11 commits で **弁証法ベース面接推論エンジン** (phase 状態機 + reactive 深掘り)、非同期 judge synthesis、評価堅牢化 (rubric アンカー + clamp + self-consistency)、LLM モデル構成の config 化、本人特化 ingest (training_data_refs CRUD)、想定質問 QA seed 合成生成、適応シミュレーション + 2ライン夜間バッチ、STT provider 抽象 (gRPC faster-whisper)、マイク音声入力を実装。

## 完成度

約 75%。複合 LLM オーケストレーション (Sonnet 応答 / Opus 評価 / Haiku judge / GPT 深掘り)、phase 状態機、weakness profile (6軸 EMA)、予約スロット、dev profile、training CRUD が実装済。ユニットテスト 16 本。

**未実装 / 未解決**:
- TTS (`packages/voice/src/iv-client.ts` の `tts()` が TODO empty) — 音声出力経路が未結線
- 前回 High「WS token を query param で許容」(`apps/server/src/ws/handler.ts:44-52`) が**未解決**
- integration / e2e テスト (cli 駆動で代替)
- data retention / user deletion 手順

## 主要達成

- 弁証法 2層推論: macro=phase 状態機 (opening→probe→pressure→closing)、micro=正-反-合サイクル、非同期 judge 信号で phase 遷移駆動 (`spec/inference/dialectic-engine.md`)。
- LLM モデル config 化 (#33): profile (opus-only/economy/custom) + env override、`models.test.ts` で遷移検証。
- STT provider 抽象 (#27): `SttProvider` interface に gRPC(faster-whisper)/API/off を pluggable に。
- 評価堅牢化 (#31): `extractJsonBlock` (fence/bare 両対応) + `clampAxes` (0-5 正規化) + self-consistency。
- 本人特化 ingest (#32): `training_data_refs` CRUD、本文は Memoria、Tirocinium は ref/embedding_id のみ保持 (個人データ非保管)。
- 適応シミュレーション (#36): examinee persona で自動面接 + weakness 駆動の面接官更新 + 夜間 2ラインバッチ。

## 主要懸念

1. **[High 未解決]** WS token を `?token=...` query param で許容 (`apps/server/src/ws/handler.ts:51`) → proxy log / referer / browser history への token leak リスク。
2. **[Medium]** memoria.rag() 失敗が warn のみで silent swallow (`session-runtime.ts:136`)、判定器 (judge) 失敗も同様 (`:285`) — RULE_CODE §7 の理由コメント無し。
3. **[Medium]** `app.onError` が `err.message` を 500 レスポンスに含める (`apps/server/src/index.ts:30`) → stack/内部情報の露出リスク。
4. **[Medium]** `weakness_profiles` に `ON DELETE CASCADE` 無し (`migrations/001_init.sql:102`) → user 削除時に残留 (個人データ削除の完全性)。
5. TTS 未結線で面接官応答が text-only。

## 総合評価

| # | レビュー観点 | 評価 |
|---|------------|------|
| 1 | 設計強度 | A |
| 2 | 設計思想の一貫性 | A |
| 3 | モジュール分割度 | B+ |
| 4 | コードレベル脆弱性 | B- |
| 5 | コード品質 | A- |
| 6 | テスト戦略 | B+ |
| 7 | ライセンス遵守 | A |
| 8 | ドキュメント完備性 | A |

**weighted: B+**。推論エンジン / 評価の core logic は robust。セキュリティ (WS token / swallow / error leak) で one-more-pass 要。

> 評価基準: A=問題なし / B=軽微 / C=要改善 / D=重大
