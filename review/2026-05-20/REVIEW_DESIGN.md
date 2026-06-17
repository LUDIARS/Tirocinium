# 設計レビュー（共通）— Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-05-20 |
| 対象コミット範囲 | 2b964b8 .. 574d4c9 |

---

## 1. 設計強度 (Design Robustness)

| 評価 | 観点 | 所見 |
|------|------|------|
| B | 障害分離 | サーバー・ローカル 2 モード分離が明確。Memoria RAG 失敗時の無言フォールバック（RAG ブロック空文字列化）は軽い。Iv STT タイムアウト時の処理が未実装。予約スロット行ロック (FOR UPDATE) で TOCTOU 対策済み。 |
| A | 冪等性 | 予約・セッション開始・評価適用が冪等設計。ON CONFLICT / FOR UPDATE で重複実行安全。 |
| A | 入力バリデーション | UUID 形式・Date パース・Enum 値のチェック徹底的。request body の JSON スキーマ厳密。不正形式は 400 で即座に拒否。 |
| A | エラーハンドリング | 意図した throw・catch の仕組みが局所的。Hono ミドルウェアで 401/403/500 を分離。WS ハンドラで close() 呼び出し確実。 |
| B | リトライ・タイムアウト設計 | データベースコネクション MAX=10 + idle_timeout=30s は妥当。WS メッセージ処理の timeout 設定が未定義。Iv/Memoria HTTP timeout が明示されない。 |
| B | 状態管理の明確性 | reservation status (held/started/no_show/canceled/completed)・session status (active/ended/aborted/scheduled) が明確。状態遷移図が DESIGN.md にあり実装が遵守。Weakness profile EMA 更新が session 終了時の明確なトリガーで駆動。 |

### チェック項目

- [x] 単一障害点 (SPOF) — Database が SPOF（Cernere/Nuntius 依存も同様）。ローカルモード分岐で一部緩和
- [x] 外部サービス障害時の縮退動作 — Memoria 未設定時 RAG スキップ。Iv STT/TTS 不在時の代替手段が未実装 (TODO)。Nuntius 通知失敗時の retry なし
- [x] 入力値の境界値・異常値 — PASETO トークン検証・時刻パース・slot hour 制約 (1-168) で防御
- [x] エラー発生時の安全な状態遷移 — 401 未認証で WS close。403 ownership 違反で socket destroy。DB トランザクション内例外で自動 rollback
- [x] 非同期処理のタイムアウトとキャンセル — currentAbort (AbortController) を SessionRuntime で保持。HTTP fetch の timeout なし（要追加）
- [x] 競合状態 — FOR UPDATE による行ロックで slot 確保安全。ON CONFLICT DO UPDATE でユーザ重複挿入安全

---

## 2. 設計思想の一貫性 (Design Philosophy Compliance)

| 該当箇所 | 逸脱内容 | 本来の設計思想 | 推奨修正 |
|----------|---------|--------------|---------|
| - | 逸脱なし | LUDIARS データ責務・認証・通知の分散設計に完全準拠 | - |

### チェック項目

- [x] レイヤー間の依存方向 — routes → service → repo → db の階層明確。ドメインロジック (weakness-math) が db import なく純粋関数
- [x] 命名規則統一 — snake_case (DB) / camelCase (関数) / kebab-case (ファイル名)
- [x] 共通パターン — repo.ts で DB 読み書き、coordinator.ts で business logic、routes で HTTP mapping
- [x] ユーティリティ再実装なし — postgres lib 一元化。uuid 生成を DB default に委譲
- [x] 責務配置 — PII は Cernere、セッションメタ・評価は Tirocinium、ES/トランスクリプトは Memoria、音声は Iv
- [x] 設定値ハードコーディング — config.ts で env 読み込み。TIROCINIUM_PORT / SLOT_DURATION_MIN 等を環境変数化

---

## 3. モジュール分割度 / 機能的凝集度 (Cohesion & Modularity)

| モジュール / クラス | 凝集度評価 | 所見 |
|-------------------|-----------|------|
| SessionRuntime | 機能的 | セッション lifecycle 全体を担当（初期化・音声処理・LLM 呼び出し・評価）。単一責務性に課題あり（後述）。 |
| CoordinatorRouter | 機能的 | 予約 slot 管理と即時開始判定。責務明確。 |
| WeaknessMath | 機能的 | EMA・variance 計算。純粋関数で再利用性高。 |
| CernereAuth | 機能的 | PASETO token 検証。middleware に特化。 |
| MemoriaClient / IvClient | 機能的 | 外部サービス client。interface 明確。 |
| Repo 群 (persona/feedback/ft_loop) | 機能的 | DB CRUD を局所化。DRY 原則遵守。 |

### チェック項目

- [x] SRP 違反 — SessionRuntime が音声入力・LLM orchestration・DB state 管理・WS frame 送信を担う。本実装段階では許容だが本番前に refactor 推奨（指摘 B-1）
- [x] God Object — 該当なし。各 class/module が 200-300 行以下
- [x] 結合度 — WeaknessMath は dependency なし。SessionRuntime は Iv/Memoria/anthropic client に依存だが環境変数で null 許容化し疎結合
- [x] 循環依存 — 該当なし。@tirocinium scoped packages で層分離
- [x] インターフェース分離 (ISP) — CernereAuth は middleware trait のみ。Coordinator は StartDecision union type で必要な info のみ
- [x] パッケージ構成 — apps/server/src/ を domain 層分割、packages/ を cross-cutting concern 分離

---

## 総合評価

| # | レビュー観点 | 評価 | 重大指摘数 |
|---|------------|------|-----------|
| 1 | 設計強度 | B | 0 |
| 2 | 設計思想の一貫性 | A | 0 |
| 3 | モジュール分割度 | B | 1 |

### 指摘詳細

**指摘 (B-1): SessionRuntime が単一責務を超えている**
- 所見：init / onMessage / close メソッド下で音声パイプ・LLM orchestration・DB state・WS frame 送信が混在
- 推奨：audio pipeline を AsyncQueue wrapper に、llm coordinator を separate class に、DB update を repo 呼び出し化
