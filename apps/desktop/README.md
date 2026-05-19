# @tirocinium/desktop

Tauri 2 (Rust + React) でビルドするデスクトップクライアント。 Phase 1 は **UI 画面の
枠だけ** で、 各ページは scaffold。

## scripts

```bash
# Vite dev (port 5178)
npm --workspace apps/desktop run dev

# TS check + Vite build
npm --workspace apps/desktop run build

# Tauri (Rust toolchain が必要)
npm --workspace apps/desktop run tauri -- dev
npm --workspace apps/desktop run tauri -- build
```

Rust toolchain (cargo) が無くても、 Vite の dev サーバ + build はブラウザで確認可能。

## ページ構成

| Route | コンポーネント | 状態 |
|---|---|---|
| `/` | Dashboard | scaffold |
| `/start` | SessionStart | scaffold |
| `/session/:id` | SessionLive (WS 接続) | scaffold |
| `/session/:id/summary` | SessionSummary | scaffold |
| `/personas` | PersonaCatalog | scaffold |
| `/reservation` | Reservation | scaffold |
| `/settings` | Settings | scaffold |

## 次フェーズ

- Server API への接続 (TanStack Query)
- WS endpoint への接続 + 音声 IO (cpal + webrtc-vad は src-tauri)
- ローカル DB (tauri-plugin-sql + sqlite) — ローカルモード用
- Foundation UI 連携 (LUDIARS 共通)
- Cernere ログインフロー
