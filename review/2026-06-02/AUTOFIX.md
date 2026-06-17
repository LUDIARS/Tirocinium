# AUTOFIX.md — LUDIARS/Tirocinium (2026-06-02)

## 概要
- 修正ファイル数: 2 (`apps/server/src/index.ts`, `apps/server/src/ws/session-runtime.ts`)
- 変更行数: +約8 / -1
- カテゴリ別件数: lint=0 / typo=0 / unused_import=0 / dead_code=0 / gitignore=0 / toc=0 / critical_high=1 (+ comment 整備 1)
- 関連 PR: https://github.com/LUDIARS/Tirocinium/pull/37 / https://github.com/LUDIARS/Tirocinium/pull/38 (いずれも要レビュー / オートマージなし)

## カテゴリ別

### lint warnings (0 件)
- なし

### typo (0 件)
- なし

### 未使用 import (0 件), dead code (0 件), .gitignore 漏れ (0 件), TOC ずれ (0 件)
- なし

### Critical / High 修正 (1 件)
- `apps/server/src/index.ts:30` — Medium / コードレベル脆弱性 (機密情報露出) — `app.onError` が `err.message` を 500 レスポンスに含めていたため除去し汎用コードのみ返す (REVIEW_VULNERABILITY.md §1 参照) / PR: https://github.com/LUDIARS/Tirocinium/pull/37

### コメント整備 (RULE_CODE §7) (1 件 / 機械的カテゴリ相当)
- `apps/server/src/ws/session-runtime.ts:136` / `:285` — best-effort swallow (memoria.rag / judge 失敗) に縮退理由コメントを追加 (挙動不変) (REVIEW_IMPLEMENTATION.md §7 参照) / PR: https://github.com/LUDIARS/Tirocinium/pull/38

## フラグしたが手作業に回した指摘 (= 自動修正の範囲外)
- `apps/server/src/ws/handler.ts:44-52` — **High** / WS token を `?token=...` query param で許容 (token leak)。WS は Authorization header を載せられない client があり、auth 経路の再設計を要するため自動修正せず (認証・認可ロジックの再設計) / REVIEW_VULNERABILITY.md §1
- `apps/server/migrations/001_init.sql:102` — Low / `weakness_profiles` に `ON DELETE CASCADE` 無し (user 削除時の残留)。DB スキーマ変更のため手作業 / REVIEW_VULNERABILITY.md §1
- `packages/voice/src/iv-client.ts` (`tts()`) — High / TTS 未結線 (TODO empty)。新機能実装 (Imperativus TTS 経路の確定が前提) / REVIEW_MISSING_FEATURES.md §2
- data retention / user deletion 手順 — High / 個人データ削除の完全性。migration + Memoria sync + 手順書を要する設計判断 / REVIEW_MISSING_FEATURES.md §2
- integration / e2e テスト基盤 — Medium / session-runtime + judge loop の連携テスト新設 (テスト基盤新設) / REVIEW_QUALITY.md §1
- `packages/llm/src/evaluator.ts` (EVAL_INSTRUCTION) — Info / 「矛盾」判定の false positive。本番データ検証を要する / REVIEW_VULNERABILITY.md §1

## 関連
- レビュー全文: REVIEW.md / REVIEW_DESIGN.md / REVIEW_VULNERABILITY.md / REVIEW_IMPLEMENTATION.md / REVIEW_MISSING_FEATURES.md / REVIEW_QUALITY.md
- 修正 PR diff: https://github.com/LUDIARS/Tirocinium/pull/37 / https://github.com/LUDIARS/Tirocinium/pull/38
