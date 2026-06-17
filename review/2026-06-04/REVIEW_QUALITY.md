# 品質保証レビュー（共通 + Web）— Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-06-04 |
| 対象コミット範囲 | 2026-06-02 以降 |

## 1. コード品質
- [x] best-effort swallow に縮退理由コメント追加 (#38, RULE_CODE §7)
- [x] crypto.randomUUID / err.message 除去等、設計判断の明示コメントあり
- [~] phase threshold / ALPHA が hardcode (config 化余地)

**評価: A**

## 2. テスト戦略・カバレッジ

| 評価 | 観点 | 所見 |
|------|------|------|
| B | unit | weakness-math.test.ts (EMA/top-3) / slot.test.ts (boundary/rollover) / frames.test.ts / tick-rules.test.ts。core logic 良好 |
| D | integration | server + postgres + llm mock の統合テスト suite なし |
| C | E2E | ft-loop dry-run (1×1 per CI) あるが多言語/stage 組合せ不十分 |
| B | エッジケース | phase transition / slot boundary / EMA div-by-zero は試験済。STT error 未テスト |
| A | CI | npm workspace test + ft-loop dry-run が PR/main で green 要求 |

**評価: B (integration/E2E 不足が 1 指摘)**

## 3. ライセンス遵守

| 依存 | ライセンス | 互換性 |
|------|----------|--------|
| hono / paseto / postgres / ws / @anthropic-ai/sdk / openai | MIT | OK |
| tauri | MIT/Apache-2.0 | OK |

- Medium: LICENSE 明示 + NOTICE/THIRD_PARTY_LICENSES (配布バイナリ用)

**評価: B**

## 4. ドキュメント完備性

| 評価 | 観点 | 所見 |
|------|------|------|
| A | README / DESIGN | 機能要件・音声フロー・予約設計・LLM 構成が詳細 |
| B | API リファレンス | spec/web に endpoint 一覧あるが error code catalog / OpenAPI 非形式化 |
| B | inline comment | 重要 decision あり、phase threshold/ALPHA は hardcode |
| B | spec/ | data/feature/interface/setup 整備、plan なし、test は ft-loop seed のみ |

**指摘: spec/web/api-schema.md (or error-codes.md) 追加 / spec/sre/*.md 新規作成**

**評価: B (2 指摘)**

## 5. パフォーマンス・ベンチマーク

| 評価 | 観点 | 所見 |
|------|------|------|
| C | 要件明文化 | STT+Sonnet stream+Opus eval の end-to-end latency target 未記載 |
| C | ベンチ/負荷試験 | ft-loop dry-run あるが本格負荷試験なし |
| D | プロファイリング | stream buffer size / pool sizing / per-session memory 未計測 |
| D | 性能回帰検知 | 回帰検出機構なし |
| C | 大規模データ | concurrent user scenario 未検証、WS close cleanup の leak risk |

**指摘:**
- Critical/High: spec/sre/performance.md 策定 (p50 latency target 等) + CI bench 統合 + load test (k6/autocannon)

**評価: C (2 指摘)**

## 6. クロスプラットフォーム互換

| 評価 | 観点 | 所見 |
|------|------|------|
| B | OS 差 | Node 22 固定、Windows local dev profile (#26) あり |
| B | ブラウザ互換 | Tauri 2 + React + 各 WebView |
| A | encoding/tz | UTC/ISO8601 前提、TIMESTAMPTZ |
| B | CI マトリクス | ubuntu-latest only、Windows/macOS build 未検証 |

**評価: B**

## 総合評価
| # | 観点 | 評価 | 重大指摘数 |
|---|------|------|-----------|
| 1 | コード品質 | A | 0 |
| 2 | テスト戦略 | B | 1 |
| 3 | ライセンス遵守 | B | 0 |
| 4 | ドキュメント | B | 2 |
| 5 | パフォーマンス | C | 2 |
| 6 | クロスプラットフォーム | B | 0 |
