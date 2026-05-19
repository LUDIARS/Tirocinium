# AUTOFIX.md — Tirocinium (2026-05-19, 初回)

## 概要
- 修正ファイル数: 0
- 変更行数: +0 / -0
- カテゴリ別件数: lint=0 / typo=0 / unused_import=0 / dead_code=0 / gitignore=0 / toc=0
- 関連 PR: なし

## 修正対象なし

scaffold 段階 (実装未着手) のため lint / typo / unused_import / dead_code / gitignore / toc いずれにも該当する自動修正対象なし。

## フラグしたが手作業に回した指摘 (= 仕様策定段階の指摘)

以下は **spec 拡張 + 実装着手** に該当し、 設計判定が必要なため AUTOFIX 範囲外:

- **Cernere PASETO verify spec の追記** — `spec/auth/*.md` 新設 (REVIEW_DESIGN §4 / REVIEW_VULNERABILITY §2 参照)
- **LLM API key 管理 spec の追記** — `spec/llm/keys.md` 新設 (REVIEW_VULNERABILITY §1 参照)
- **Iv 音声 endpoint 認証 spec の追記** — `spec/voice/auth.md` 新設 (REVIEW_VULNERABILITY §2 参照)
- **error response 統一形式 spec の追記** — `spec/web/errors.md` 新設 (REVIEW.md §Medium Priority 参照)
- **過負荷時 slot 競合制御アルゴリズム spec の追記** — `spec/reservation/race.md` 新設 (REVIEW.md §Medium Priority 参照)
- **LICENSE 追加** — repo root に OSS license 配置 (REVIEW_QUALITY §2 参照)
- **v0.1 必須機能の実装** — Cernere verify / 複合 LLM / Iv / slot / RAG / Memoria 連携 (REVIEW_MISSING_FEATURES §2 参照)

## 関連
- レビュー全文: REVIEW.md / REVIEW_*.md
- これは **初回レビュー** で、 次回以降は実装進捗を追跡。
