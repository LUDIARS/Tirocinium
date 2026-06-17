# Web 実装評価 — Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-05-20 |
| 対象コミット範囲 | 2b964b8 .. 574d4c9 |

---

## 1. コード品質 (Code Quality)

| 該当箇所 | 問題分類 | 説明 | 推奨修正 |
|----------|---------|------|---------|
| apps/server/src/ws/session-runtime.ts:100-120 | 未完成の実装 | Memoria RAG fetch が TODO 領域で実装未了。 | TODO(impl) を tracking issue へ。fetch wrapper を別 function に分離 |
| apps/server/src/index.ts:27-29 | 例外ハンドリングの loose さ | 全例外を "internal" message で wrap。call stack がいずれ必要。 | logger を context に attach して err.message / stack を記録。client には opaque error_id |
| packages/voice/src/iv-client.ts | placeholder with return | stt / tts が空 return で実装 stub。本番で呼ばれると null 動作。 | NotImplementedError を throw、または logger.warn の guard を入れる |
| apps/server/src/config.ts:18-19 | Optional key without guard | cernerePublicKey = '' がデフォルト。middleware が 503 を返しても起動は成功。 | startupChecks で必須 key list を iterate |

### チェック項目

- [x] マジックナンバー — EVAL_EVERY_N_TURNS=5、ALPHA=0.3 等は const 定義 + comment 付き
- [x] 過度なネスト — max depth 2-3 で良好。早期リターン多用
- [x] 未使用のコード・デッドコード — unused import なし (tsconfig strict)。22 commit 全て active feature
- [x] DRY 違反 — SQL fragment は repo 層で共通化。llm client call は factory で abstract
- [x] スコープ — config は export const object で lock。class property は private/protected 適切
- [x] 例外の握りつぶし — catch ブロック全て re-throw or return error code
- [x] 暗黙的型変換 — TypeScript strict mode。union type 分岐
- [x] ログ出力 — console.error / console.log のみ。本番で structured logger 必須（要実装）
- [x] 命名 — tryStart / reserve / cancel / assertOwnership / renderRagBlock 等、動詞-noun で明確
- [x] 関数長 — max 150 行。適切な粒度

---

## 2. データスキーマの妥当性・重複確認 (Data Schema Validation)

| テーブル / モデル | 問題種別 | 説明 | 推奨対応 |
|-----------------|---------|------|---------|
| users | 正規化 OK | Cernere user_id mirror。PII なし。first_seen timestamp で監査可能。 | - |
| reservation_slots | 正規化 OK | 30 分 slot 単位。capacity / used で availability を atomic に。 | - |
| reservations | 正規化 OK | user_id / slot_start 外部キー。status enum (SQL CHECK)。unique index で同時 1 件制御。 | - |
| sessions | 正規化 OK | user_id / reservation_id の関連。status / mode enum。llm_profile / metadata JSONB。index on (user_id, started_at DESC)。 | - |
| session_turns | 正規化 OK | session_id 外部キー。turn_no unique。role enum。stt_text / text_uri で dual storage。 | - |
| evaluations | 正規化 OK | session_id 外部キー。turn_range int4range。axes / hints JSONB。 | - |
| training_data_refs | 正規化 OK | user_id 参照。Memoria URI + embedding_id 保持。kind enum。tags text[]。 | - |
| weakness_profiles | 正規化 OK | user_id pk。axes_ema / axes_variance / hint_history JSONB。session_count int。 | - |

### チェック項目

- [x] 正規化 — 第 3 正規化完了。JSONB column の使用は柔軟性と検索のバランスが良好
- [x] 同一概念の複数定義 — 該当なし。interviewer_personas / examinee_personas は DESIGN 上正当化される分離
- [x] フィールド型 — UUID / TIMESTAMPTZ / INT / TEXT[] / JSONB 全て適切
- [x] NOT NULL・UNIQUE・FK 制約 — 各表に PK / FK / unique index。制約網羅的
- [x] インデックス最適化 — idx_sessions_user / idx_sessions_active / idx_eval_session / idx_turns_session / idx_resv_user_active で主要 query path をカバー
- [x] マイグレーション破壊性 — 001_init / 002_persona_summary_feedback は additive。immutable comment で重複実装防止
- [x] API ↔ DB スキーマ — POST /api/v1/sessions ↔ sessions table insert で一致
- [x] Enum 定義一致 — mode/status は CHECK(... IN (...)) で DB enforce
- [x] N+1 — session turn 再構成は単一 SELECT。weakness_profiles は user 単位 select 1 行。N+1 なし

---

## 3. SRE 観点のレビュー (SRE Review)

| 評価 | 観点 | 所見 |
|------|------|------|
| D | 可観測性 | console.log / console.error のみ。structured logging なし。trace id / request id 未付与。本番で障害追跡が困難。 |
| B | デプロイ安全性 | migrate.ts で seed runner あり。migrations/ が immutable 設計。db pool max=10。WS graceful close で in-flight 処理後 shutdown。 |
| C | スケーラビリティ | db.max=10 はシングルインスタンス向け。slot coordinator はメモリ in-flight state を持たず DB-backed で良好。 |
| D | 障害復旧 | バックアップ手順記載なし。migration rollback 手順なし。reserved session へのタイムアウト cancel ロジックが未実装。 |
| B | 依存関係管理 | package.json に version pin。monorepo で @tirocinium/* scoped。Memoria/Iv 依存は env optional で graceful degrade。 |

### チェック項目

- [ ] 構造化ログ — 未実装。console.log / error のみ
- [ ] メトリクス収集 — 未実装。Prometheus exporter / StatsD client なし
- [x] ヘルスチェック — liveness: GET /health で 200。readiness (db 接続確認) は未実装
- [x] デプロイ可逆性 — SQL migration は immutable。手順書なし
- [x] 設定変更 — env var で動的。リアルタイム reload 機構なし
- [x] リソース制限 — db.max=10 / idle_timeout=30s。HTTP timeout なし
- [x] 水平スケーリング — サーバは stateless。slot lock は FOR UPDATE で分散 safe
- [ ] バックアップ・リストア — 未実装。DB backup / restore script なし
- [ ] SLI / SLO — 未定義
- [ ] インシデント runbook — 未実装

---

## 総合評価

| # | レビュー観点 | 評価 | 重大指摘数 |
|---|------------|------|-----------|
| 1 | コード品質 | B | 1 |
| 2 | データスキーマ | A | 0 |
| 3 | SRE | C | 2 |

**所見:** データスキーマは第 3 正規化 + 適切な index + immutable migration で A 評価。コード品質も strict TypeScript で良好だが iv-client.ts の placeholder が残存。SRE は構造化ログ・バックアップ手順・runbook がいずれも未実装で C、本番リリース前に可観測性・DR の整備が必須。
