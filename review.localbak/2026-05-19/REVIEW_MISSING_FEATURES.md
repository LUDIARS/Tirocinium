# 不足機能評価 — Tirocinium (2026-05-19, 初回)

## 1. 機能改善 — A

本期コミットで scaffold 完了:
- ✓ initial scaffold (6d7a268)
- ✓ learning method B (RAG + 弱点プロファイル) spec (fab0886)
- ✓ host port 割当 (backend 8084, vite 5178) spec (2b964b8)
- ✓ general QA seed data (4 types × 20) (2a7ead1)
- ✓ Tauri 2 desktop + Hono server + npm workspaces 構成

## 2. 不足機能 — D

scaffold 段階のため大半が未実装。 v0.1 マイルストーン優先順位:

### v0.1 必須

1. **Cernere PASETO verify** — `apps/server/src/auth/` 実装、 memory `Cernere は /auth しか開かない` 準拠
2. **複合 LLM router** — Sonnet 応答 / GPT-5.5 深掘り / Opus 評価の分岐実装
3. **Iv 音声統合** — STT/TTS endpoint との接続
4. **過負荷時 30 分 slot 予約** — queue + 競合制御
5. **RAG + 弱点プロファイル engine** — Method B 実装
6. **Memoria 連携** — 個人データ参照 ID のみ保持

### v0.2 計画

7. **ローカルモード ollama 統合** — サーバーモード代替
8. **練習履歴の reflection / フィードバック UI**
9. **Tauri 2 desktop 本体実装** (現状: src-tauri scaffold のみ)
10. **過去 Q&A の Memoria 永続化** (現状: data/qa/ ローカル seed のみ)

### Spec 詰め残し

- error response 統一形式 (spec/web/*.md 拡張)
- 30 分 slot 競合制御アルゴリズム (spec/reservation/*.md 拡張)
- LLM API key 管理 (spec/llm/*.md 拡張)
- Iv 音声 endpoint 認証 (spec/voice/*.md 拡張)
