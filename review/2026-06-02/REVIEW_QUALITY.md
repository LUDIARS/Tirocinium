# 品質保証レビュー（共通） — LUDIARS/Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-06-02 |
| 対象コミット範囲 | 2026-05-23 以降 (11 commits) |

---

## 1. テスト戦略・カバレッジ

| 評価 | 観点 | 所見 |
|------|------|------|
| A | unit テスト網羅性 | 16 本: phase / judge / evaluator / models / weakness-math / frames / slot / tick-rules 等。core logic を網羅 |
| C | integration テスト | 無し。session-runtime + judge loop、training + Memoria fail path が未カバー |
| C | E2E テスト | cli 駆動 (scripts/ft-loop, sim-loop) で代替。CI は dry-run のみ |
| A | エッジケース | phase 遷移表 / clampAxes / extractJsonBlock の境界を test |
| B | CI 自動実行 | GitHub Actions で build + vitest + ft-loop dry-run |

### チェック
- [x] コアロジック unit テスト存在 (phase/judge/evaluator/weakness)
- [ ] 外部 I/O integration テスト (Memoria upsert / WS loop)
- [~] E2E: cli dry-run のみ、本実行は ANTHROPIC_API_KEY 必要
- [x] 失敗系: parse fail / signal default をテスト
- [x] CI で毎コミット green
- [ ] カバレッジ計測ツール・目標値 未定義

## 2. ライセンス遵守・OSS 帰属表示

| 該当依存 | ライセンス | 配布形態 | 互換性 | 帰属表示 |
|---------|----------|---------|--------|----------|
| hono / ws / pg | MIT | SaaS (非配布) | OK | N/A |
| @anthropic-ai/sdk / openai | MIT | SaaS | OK | N/A |
| react / react-router-dom | MIT | bundled (desktop) | OK | 対応推奨 |
| @grpc/grpc-js / proto-loader | Apache-2.0 | SaaS | OK | N/A |
| @tauri-apps/cli | MIT/Apache-2.0 | dev | OK | N/A |

### チェック
- [x] プロジェクトライセンス: package.json `"license": "UNLICENSED"` (private)
- [x] 依存ライセンス: MIT / Apache-2.0 で copyleft 混入なし
- [~] desktop バンドル配布時の OSS 帰属表示は将来検討 (現状 SaaS/dev 中心)
- [ ] cargo-deny / license-checker の機械チェック未組込 (Low)

## 3. ドキュメント完備性

| 評価 | 観点 | 所見 |
|------|------|------|
| A | README | サービス概要・特徴・ステータス |
| A | DESIGN / spec | DESIGN.md + spec/inference/dialectic-engine.md が詳細 |
| B | API リファレンス | routes/*.ts のコメント、OpenAPI 化は未 |
| B | inline コメント | why コメントあり (一部 swallow に欠如) |
| A | CLAUDE / setup | 個人データ責務 + branch 運用 + windows-local-dev ガイド |
| B | spec 5 分類 | inference/setup 充実、feedback EMA 数式 / persona guideline が薄い |

### チェック
- [x] README 概要 + 起動手順
- [x] DESIGN / spec で重要決定記録 (弁証法エンジン)
- [~] API リファレンス: 手書きコメントのみ
- [~] spec 同期: #33 (model config) の DESIGN 反映漏れ → spec へ移譲
- [ ] EMA 数式 / persona creation guideline を spec に追記推奨

---

## 総合評価

| # | レビュー観点 | 評価 | 重大指摘数 |
|---|------------|------|-----------|
| 1 | テスト戦略・カバレッジ | B+ | 0 (integration/e2e 弱い) |
| 2 | ライセンス遵守・OSS 帰属表示 | A | 0 |
| 3 | ドキュメント完備性 | A | 0 |
