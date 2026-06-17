# 不足機能評価（共通）— Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-05-20 |
| 対象コミット範囲 | 2b964b8 .. 574d4c9 |

---

## 1. 機能の改善提案 (Feature Improvement)

| 優先度 | 対象機能 | 改善提案 | 該当箇所 | 推奨実装段階 |
|--------|---------|---------|----------|------------|
| High | Iv STT/TTS 完成 | packages/voice/src/iv-client.ts が未実装 placeholder。WS /v1/stt connect / PCM chunk pipe / partial・final event 処理が必須 | iv-client.ts:17-30 | 本リリース前 (blocking) |
| High | Memoria RAG fetch 完成 | Memoria API (embedding_id lookup / vector search / excerpt fetch) が仕様未定。training-data upsert / RAG search endpoint が Memoria 側に必要 | packages/training/src/memoria-client.ts, SessionRuntime init | 本リリース前 |
| Medium | E2E テスト追加 | session open → audio send → Sonnet response → evaluation → end の full cycle テスト | apps/server/src/ws/ | alpha リリース前 |
| Medium | Structured logging | context-aware logger (trace id / request id / user id) で observability 向上 | apps/server/src/index.ts | beta リリース前 |
| Medium | ローカルモード実装 | ollama 軽量モデル連携。SQLite fallback。無 network で動く desktop mode | apps/desktop/src/pages/SessionStart.tsx | v1.1 予定 |
| Low | Frontend form validation | loginGate / session start form の入力検証強化 | apps/desktop/src/auth/LoginGate.tsx | beta リリース |
| Low | Disaster recovery guide | DB backup / migration rollback / crash recovery 手順 doc | README / runbook | v1 GA 前 |

---

## 2. 不足機能の提案 (Missing Feature Proposal)

| 優先度 | 提案機能 | 必要性の根拠 | 推奨対応 |
|--------|---------|------------|----------|
| High | no-show timeout enforcement | reservation slot の no-show cancel 自動化。tick scheduler が stub (routes に register なし) | reservation/tick.ts を cron / interval job として wire up |
| High | API key rotation / expiry | CERNERE_PUBLIC_KEY が static。key rotation 手順なし | config に key rotation を integrate。startup health check |
| Medium | Rate limiting | POST /sessions の burst attack / concurrent reserve attack の防止 | Hono rate limit middleware を integrate |
| Medium | Admin API / panel | reservation 状態管理 UI、user session histogram、error log viewer | admin/ 新規 route set |

---

## 総合評価

| # | レビュー観点 | 指摘数 | 優先度別内訳 |
|---|------------|--------|------------|
| 1 | 機能改善 | 7 | High: 2 / Medium: 3 / Low: 2 |
| 2 | 不足機能 | 4 | High: 2 / Medium: 2 / Low: 0 |

**所見:** 最優先 (High) は Iv STT/TTS・Memoria RAG の仕様確定・実装 — session flow がこの 2 つに依存しており blocking。no-show timeout enforcement も予約フローの完成に必須。task A-M は基盤レイヤで完了しており、依存サービスの API 定義確定が次の鍵となる。
