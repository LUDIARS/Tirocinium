# Tirocinium 棚卸し (job cpp-lorica-20261111 / W6)

ブランチ `cpp/tirocinium-node-port`、着手時の先頭 `b89fc41`。前回の正本は `native/PORTING.md`。

## ビルド単位 (着手時)

| ビルド単位 | 種類 | Lorica::boundary | lorica_harden_target | deprecate_unsafe_apis |
|---|---|---|---|---|
| tr_core | static lib | ○ (PUBLIC) | baseline | なし |
| tr_crypto | static lib | ○ (tr_core 経由) | baseline | なし |
| tr_io | static lib | ○ (tr_core 経由) | baseline | なし |
| tr_app | static lib | ○ (tr_core 経由) | baseline | なし |
| tirocinium-server | exe | ○ (経由) | baseline | なし |
| tirocinium-migrate | exe | ○ (経由) | baseline | なし |
| テスト 21 本 (`tr_test()`) | exe | ○ (経由) | baseline | なし |

- Lorica の固定は `cab4f12…` (古い)。→ `5e8281b0e60fa16f814e16eaa620715937e8618d` にそろえる。
- `Lorica::boundary` を直接 `PRIVATE` で持っているのは tr_core だけ (他は PUBLIC の推移)。指示書 3.3 の形に合わせ、全単位に明示する。
- sanitizer の option・fuzz の入口は無い。
- 第三者のソースをビルドしているもの: なし (Boost・nlohmann_json はヘッダのみ。OpenSSL・libpq はシステムのビルド済み)。
- `native/tools/__pycache__/*.pyc` (生成物) がコミットされている。

## 外から入る入力の経路

| 経路 | 着手時の上限 | Lorica |
|---|---|---|
| HTTP 受信 (ヘッダ・本文) `io/http_server.cpp` | ヘッダ 16 KiB・本文は経路ごと (2 MiB / 資料 7 MiB)・同時 512 | 要求ごとの budget なし (本文の JSON は parse_json の内部で別 budget) |
| WebSocket 受信 (session / call / Cernere 中継) `app/ws_routes.cpp` | 1 メッセージ上限 + parse_json | parse_json 内の budget (メッセージごと) |
| WebSocket クライアント (Cernere project WS・Discord gateway) `io/ws_client.cpp` | max_message + parse_json | 同上 |
| Discord 音声 (UDP) | **未移植** (前回 §6 人間の判断)。C++ に UDP の受け口は無い | — |
| 教材 (資料の base64 提出) `core/domain/domain.cpp` | 復号前見積もりを budget に課金 | input_budget / checked_multiply |
| 教材 (Consult スキル SKILL.md の読み込み) `app/materials.cpp` | 大きさを見てから rdbuf で全部読む (TOCTOU、読み取りは無制限) | なし |
| 企業クロールの応答 (worker の 1 行 JSON) `app/companies_worker.cpp` | 1 行 16 MiB + parse_json | parse_json 内 |
| 企業 geocode の応答 `app/companies_repo.cpp` | 1 MiB・10 秒 | parse_json 内 |
| 外向き HTTP 全般 `io/http_client.cpp` | ヘッダ 64 KiB・本文は呼び出しごと・圧縮拒否 | なし (Beast の上限) |
| 子プロセスの出力 `io/process.cpp` | stdout 上限 | なし |
| DB の結果 `io/pg_pool.cpp` | 結果全体を budget | input_budget |
| ファイル (data/*.json・viewer・migration・secrets config・brief) | 一部は大きさを見てから全部読む | なし |
| WAV (VOICEVOX 応答) `app/voice.cpp` | contains_range / checked_add | 一部 |

## 依存 (前回のブランチが使っているもの)

Boost 1.87.0 (ヘッダ)・nlohmann_json 3.11.3・OpenSSL 3 (システム)・libpq 16 (システム、指示書 10 章で許可)・Lorica。
許可リストに当たらない依存は無い。libopus は許可済みだが未使用 (音声未移植)。
Node 側は前回どおり (PORTING.md §1。企業 worker = npm 4 + tsx 29)。

## 前回の報告の残り (PORTING.md §6/§7)

人間の判断 7 件 (SQLite→Postgres、Discord 音声、gRPC STT、blackbox、worker の LLM、worker の起動、crawl-job-news の認証)。
残り: OB スタジオ (ICU)、HTTP+JSON の運用 CLI の C++ 化、Windows の確認。

## 指示書 10 章 W6 の 3 所見 (着手時の確認)

- ssrf-guard: `io/http_client.cpp` は 1 回解決・全 IP 検査・検査した endpoint へ接続 (再解決なし)。ws_client も同じ。直っている。純関数として切り出して境界テストを足す予定。
- 教材の読み込み: Read を 1 ファイルに限定・`--strict-mcp-config` は入っている。ただし一時フォルダの権限が既定 (0755 相当)・SKILL.md の読み取りが無制限。ここを直す予定。
- 正規表現の二乗時間: C++ に `std::regex` は無い。ES 本文の検査は線形テストあり。JSON 取り出し・社名正規化は線形テストが無いので足す予定。
