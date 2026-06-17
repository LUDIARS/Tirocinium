# AUTOFIX — Tirocinium (2026-05-23)

## 概要

- 修正ファイル数: 0
- 変更行数: +0 / -0
- カテゴリ別件数: lint=0 / typo=0 / unused_import=0 / dead_code=0 / gitignore=0 / toc=0 / critical_high=0
- 関連 PR: なし

**修正対象なし**: WS token 受入経路の制限 (query param → Bearer のみ) や LLM parse 失敗時の default fallback は機能変更を伴うため、bounded fix の範囲を超える (client breaking change + テスト追加が必須)。

## カテゴリ別

該当なし。

## フラグしたが手作業に回した指摘

- `apps/server/src/ws/handler.ts:47-49` — High — query param token を deprecated し Bearer header のみ受入。client (apps/desktop) 側修正と協調が必要 — REVIEW_VULNERABILITY.md §1
- `apps/server/src/index.ts:27-28` — Medium — error.message を返す処理を環境別に generic message に変更。本番ステージング切替設計が必要 — REVIEW_VULNERABILITY.md §例外処理
- `packages/llm/src/evaluator.ts:28-54` — Medium — JSON parse throw 時の default evaluation 返却 wrapper。テスト追加 + DB write 側挙動の合意必要 — REVIEW_IMPLEMENTATION.md §エラーハンドリング
- `apps/server/src/ws/session-runtime.ts:120-127` — Medium — memoria/iv health failure サイレント skip → WARN log + graceful degradation flag — REVIEW_VULNERABILITY.md §例外処理
- `packages/voice/src/iv-client.ts:16-31` — High — stt() / tts() TODO empty。Imperativus WS API spec 確定後実装 — REVIEW_MISSING_FEATURES.md §1
- `apps/desktop/src/ws/SessionWebSocket.ts:28-29` — Medium — WS URL token embedded → query encoding 安全確認 + Bearer 移行 — REVIEW_VULNERABILITY.md §1
- `apps/server/migrations/002_persona_summary_feedback.sql:52-63` — Medium — human_feedback の delete cascade + weakness_profiles weight 再計算 trigger — REVIEW_VULNERABILITY.md §データ責務

## 関連

- レビュー全文: REVIEW.md / REVIEW_*.md
