# 設計レビュー（共通） — LUDIARS/Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-06-02 |
| 対象コミット範囲 | 2026-05-23 以降 (11 commits) |

---

## 1. 設計強度

| 評価 | 観点 | 所見 |
|------|------|------|
| A | 障害分離 | Memoria(RAG)/Nuntius(通知)/IV(STT) 未設定時は skip + best-effort。各外部連携が独立に縮退 |
| B | 冪等性 | session 単位の進行は明確。weakness profile 更新タイミングは comment 依存 (明示弱い) |
| B | 入力バリデーション | training body の kind 白リスト check は良好。LLM 出力は extractJsonBlock で堅牢化 |
| B | エラーハンドリング | parse fail は fail-fast (throw)、上流 background は warn swallow (理由コメント不足) |
| B | リトライ・タイムアウト | judge 失敗時は DEFAULT_SIGNALS で time-box fallback。評価 fail の retry は無し |
| A | 状態管理 | phase state を SessionRuntime が局所保持、session 終了で破棄 |

### チェック
- [x] SPOF: 外部連携が独立縮退
- [x] 外部障害縮退: Memoria/Nuntius/IV 未設定 skip
- [x] 境界値防御: kind 白リスト / JSON parse guard
- [~] fail-safe: 評価失敗は session 継続だが silent (ユーザ気づかず)
- [x] 非同期 timeout: judge は fallback signals
- [x] race: 単一 WS session runtime 内で逐次

## 2. 設計思想の一貫性

| 該当箇所 | 所見 |
|----------|------|
| `packages/llm/src/phase.ts` | phase 状態機を純関数化、`phase.test.ts` で遷移表テスト ✓ |
| `packages/voice/src/stt-provider.ts` | STT を interface 抽象 + factory、実装交換可能 ✓ |
| `apps/server/src/ws/session-runtime.ts` | orchestrator role。Sonnet/judge/evaluate/phase/refine を集約 (役割上必要) |
| DESIGN.md vs 実装 | #33 (model config) / #27 (STT 抽象) が DESIGN.md 未反映、spec 側へ移譲 (軽微な乖離) |

### チェック
- [x] レイヤー依存方向: llm/voice はユーザ data 非依存の純論理層、server が import (一方向)
- [x] 命名統一: assessAnswer / applyEvaluation / renderRagBlock など役割明示
- [x] 共通パターン一貫: provider 抽象 + factory
- [x] 再実装回避: Memoria/Lector を再利用
- [~] 責務配置: session-runtime が orchestrator として 370+ 行 (設計上は妥当だがテスト性低下)
- [x] ハードコード: モデル構成は profile/env で外出し

## 3. モジュール分割度 / 凝集度

| モジュール / ファイル | 凝集度 | 所見 |
|-------------------|--------|------|
| `packages/llm/src/phase.ts` | 機能的 | phase 遷移 (純関数) |
| `packages/llm/src/judge.ts` | 機能的 | 回答品質判定 (Haiku) |
| `packages/llm/src/evaluator.ts` | 機能的 | 評価 parse + 正規化 (Opus) |
| `apps/server/src/feedback/weakness-updater.ts` | 機能的 | profile EMA 更新 |
| `apps/server/src/ws/session-runtime.ts` | 逐次的 | session 進行 orchestration (7 責務を直列集約) |

### チェック
- [x] SRP: llm/voice/feedback の各モジュールは単一責務
- [x] God Object: session-runtime は orchestrator role で正当 (ISP で責務は明確)
- [x] 循環依存: なし
- [~] テスト性: orchestrator の個別単体テストが困難

---

## 総合評価

| # | レビュー観点 | 評価 | 重大指摘数 |
|---|------------|------|-----------|
| 1 | 設計強度 | A | 0 |
| 2 | 設計思想の一貫性 | A | 0 |
| 3 | モジュール分割度 | B+ | 0 |
