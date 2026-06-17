# Web 実装評価 — Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-06-04 |
| 対象コミット範囲 | 2026-06-02 以降 |

## 1. データスキーマの妥当性

| テーブル | 問題 | 説明 |
|---------|------|------|
| (None) | — | interviewer_personas / examinee_personas / interview_summaries / human_feedback / ft_loop_runs が各責務で分離 |

- [x] 正規化: weak_top3 配列は denormalized だが intentional (EMA + top-K)
- [x] 制約: NOT NULL/UNIQUE/FK properly set (002_*.sql)、evaluation_bias は nullable
- [x] インデックス: stage/role/status composite、user_id/target_kind lookup
- [x] 破壊的マイグレーションなし (001/002 は追加のみ、ALTER は 003 以降)
- [x] API 整合: spec/web の endpoint が session/reservation/training に対応

**評価: A**

## 2. SRE観点

| 評価 | 観点 | 所見 |
|------|------|------|
| B | 可観測性 | console.error で stderr。traceID/requestID 構造化ログは Vestigium 準拠想定だが明示実装なし |
| B | デプロイ安全性 | npm ci/build は CI 確認。ローリング deploy 未定義 |
| A | スケーラビリティ | postgres pool default、WS は per-session state |
| B | 障害復旧 | backup/restore 手順未記載、migration rollback 戦略なし |
| B | 依存関係管理 | package-lock あり、monorepo workspace local dep |

**指摘:**
- High: spec/sre.md / ランブック (障害時対応) 追加、DB backup policy 明示
- Medium: 構造化ログ (traceID + turn_no context) を Vestigium ラッパーで実装
- Medium: ローリング deploy / canary strategy を CI に記載

**評価: B (2 指摘)**

## 総合評価
| # | 観点 | 評価 | 重大指摘数 |
|---|------|------|-----------|
| 1 | データスキーマ | A | 0 |
| 2 | SRE | B | 2 |
