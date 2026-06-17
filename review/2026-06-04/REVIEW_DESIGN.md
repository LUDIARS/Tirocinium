# 設計レビュー（共通）— Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-06-04 |
| 対象コミット範囲 | 2026-06-02 以降 |

## 1. 設計強度

| 評価 | 観点 | 所見 |
|------|------|------|
| A | 障害分離 | サーバーモード GPT-5.5/Opus/Sonnet 3 層オーケストレータが非同期 judge で独立、1 層障害が他を阻害しない。ローカルモード fallback で SPOF 排除 |
| A | 冪等性 | reservation slot coordinator が CONFLICT DO NOTHING + explicit txn。session 開始は状態機で決定的 |
| A | 入力バリデーション | JSON body は `.catch(() => ({}))` で fail-safe。target_company/role は nullable で型安全 |
| A | エラーハンドリング | global app.onError は err.message を stdout に留め、client に汎用 error code のみ返す (#37) |
| A | リトライ・タイムアウト | stream abort 時 AbortController で clear。ws close 時 cleanup (reservation/tick/audio queue) |
| A | 状態管理 | phase 状態機は pure function nextPhase(state, signals) で単体テスト化 |

## 2. 設計思想の一貫性

| 該当箇所 | 逸脱内容 | 推奨修正 |
|----------|---------|---------|
| (なし) | — | — |

DESIGN.md の責務境界 (Tirocinium は「予約台帳 + 評価集計 + LLM orchestrator」、生データは Memoria/Cernere に外出し) を堅持。RULE_CODE §7 (best-effort swallow に理由コメント) を #38 で遵守追加。

## 3. モジュール分割度

| モジュール | 凝集度 | 所見 |
|-----------|--------|------|
| SessionRuntime | 機能的 | WS handler + session orchestrator。turn/phase/RAG/audio stream を 1 セッション runtime として管理 |
| LLMOrchestrator (llm/) | 機能的 | 3 機種協調、prompt cache/stream buffer/signal 集約。config で Sonnet/Haiku 切替 (#33) |
| PhaseStateMachine | 機能的 | nextPhase pure function、AXES 軸定義 (weakness-math) |
| CoordinatorSlot | 機能的 | reservation slot 確保 + tick scheduler、ビジネス規則と DB 分離 |

- 循環依存なし: llm → training (RAG) → voice → server 一方向

## 総合評価
| # | 観点 | 評価 | 重大指摘数 |
|---|------|------|-----------|
| 1 | 設計強度 | A | 0 |
| 2 | 設計思想の一貫性 | A | 0 |
| 3 | モジュール分割度 | A | 0 |
