# 実装評価 — Tirocinium (2026-05-19, 初回)

## 1. コード品質 — C

### 実装未着手
src/ コードはなく、 spec / data (seed QA) / package.json / tsconfig.json 程度。
- `apps/server/package.json` scaffold
- `apps/desktop/src-tauri/` scaffold
- `data/qa/general.json` (seed: 4 types × 20)

評価不能だが、 spec 品質は B クラス。

## 2. データスキーマ — B

### schema/*.md で 8 表構造化
- users (Cernere reference のみ)
- sessions
- questions / answers
- weakness_profile
- learning_progress
- slot_reservations
- qa_corpus (seed + user additions)
- llm_runs (audit)

### 評価
- PII 非保持設計が明確 (LUDIARS の personal data rule 準拠)
- migration 運用 rule 記載済
- FK / index は実装時に検証

### 該当箇所
- `spec/schema/*.md`
- `data/qa/general.json` (seed 80 件)

## 3. SRE — D

実装未着手のため評価不能。 以下を実装着手時に整備:

- pino structured logging
- log level env 化
- LUDIARS port map (8084 / 5178) との conflict 確認
- Memoria / Iv との downstream healthcheck

## 4. パフォーマンス — C

scaffold のためベンチ不能。 実装方針として:

- LLM call は async batch (sonnet 応答先行 → GPT-5.5 深掘り並列 → Opus 評価まとめ)
- 過負荷時の 30 分 slot 予約で queue 制御
- ローカルモードは ollama 軽量モデルで応答時間 < 5s 目標

## 5. クロスプラットフォーム — B

### Tauri 2 desktop
- Win/macOS/Linux 対応
- WebView2 (Win) / WKWebKit (macOS) / WebKitGTK (Linux)

### Hono server
- Node 22+ で OS 非依存
- npm workspaces で monorepo 統合

実装着手時に native binding (better-sqlite3 等) の per-OS ビルド戦略を明示。
