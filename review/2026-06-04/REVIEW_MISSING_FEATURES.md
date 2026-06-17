# 不足機能評価（共通）— Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-06-04 |
| 対象コミット範囲 | 2026-06-02 以降 |

## 1. 機能の改善提案

| 対象機能 | 改善提案 | 期待効果 | 優先度 |
|---------|---------|---------|--------|
| Weakness profile EMA | 係数 ALPHA=0.3 hardcode → ユーザ/ペルソナ別チューニング可能化 | adaptive learning、個人差対応 | Medium |
| Phase state transition | synthesis threshold が implicit → explicit hint score threshold を config 化 | phase 跨ぎの予測可能性、テスト拡張 | Medium |

## 2. 不足機能の提案

| 提案機能 | 根拠 | 優先度 | 想定影響 |
|---------|------|--------|---------|
| API error code catalog | 500/503 response の client error handling 未仕様化、error_code + i18n が必須 | High | spec/web/errors.md + client error handler |
| Performance SLI/SLO | response latency / STT+Sonnet total / Opus eval turnaround が未計測 | High | spec/sre/observability.md + CI perf baseline |
| E2E smoke test | ft-loop dry-run はあるが、実 WS session の end-to-end 生存確認なし | Medium | integration_test/ suite |

## 総合評価
| # | 観点 | 指摘数 | 優先度別 |
|---|------|--------|---------|
| 1 | 機能改善 | 2 | Medium:2 |
| 2 | 不足機能 | 3 | High:2 Medium:1 |
