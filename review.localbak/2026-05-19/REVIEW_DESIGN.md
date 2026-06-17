# 設計レビュー — Tirocinium (2026-05-19, 初回)

## 1. 設計強度 — B

### モード設計 (DESIGN.md)
- **ローカルモード**: ollama 軽量モデルで全機能をローカル完結
- **サーバーモード**: 複合 LLM (Sonnet 応答 + GPT-5.5 深掘り + Opus 評価) で本格運用
- 過負荷時は 30 分 slot 予約で待機制御

設計コンセプトは明確。 ローカル / サーバーの 2 モードは Memoria pattern とも整合。

該当箇所:
- `DESIGN.md` 全体
- `spec/reservation/*.md` slot 抽象

### 学習方式 B (RAG + 弱点プロファイル)
- ES / portfolio / 過去 Q&A を教師データに RAG
- ユーザの弱点を継続学習しプロファイル化
- 反復練習で深掘り

該当箇所:
- `spec/llm/method-b.md` (fab0886)

## 2. 設計思想の一貫性 — B

- 個人データは Memoria に永続化、 Tirocinium は参照 ID のみ保持 (LUDIARS の personal data rule 準拠)
- 音声は Iv に STT/TTS 委譲 (機能分担明確)
- 複合 LLM は LUDIARS 標準パターン (Memoria の多 LLM プロバイダと整合)

該当箇所:
- `CLAUDE.md` — 性格 + 触ってよい範囲
- `DESIGN.md` — Memoria / Iv 連携設計

## 3. モジュール分割度 — B

### モノレポ構成 (spec/code/)
- `apps/server` — Hono backend (port 8084)
- `apps/desktop` — Tauri 2 desktop
- `packages/*` — 共有ライブラリ
- npm workspaces 統合

該当箇所:
- `spec/code/structure.md` (2b964b8)
- `apps/` ディレクトリ scaffold

### Port 割当
- backend: 8084
- vite dev: 5178

LUDIARS PORT-MAP との整合性は実装着手前に再確認推奨。

## 4. 設計上の課題 (scaffold 段階)

- **Cernere verify logic** — spec で「memory 参照」と指示のみ、 具体的な実装手順を spec/auth/*.md に追記推奨
- **過負荷時 30 分 slot の競合制御** — slot 抽象はあるが争奪 race の解決方針未指定
- **error response 統一形式** — endpoint 列挙はあるが標準形未定義
