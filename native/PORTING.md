# Tirocinium サーバの C++ 移植 — 棚卸しと対応表

job `cpp-node-20261030` (WP-Tirocinium)。目的は脆弱性の受け口 (npm 依存・Node 同梱部品) を減らすことと、
外部依存の総数・種類を増やさないこと。速度は目的ではない。

この文書は移植の正本の対応表。数値の作成手順は `native/tools/npm_dep_inventory.py`
(package-lock.json だけを読む。ネットワーク不要)。

- C++ サーバ: `native/build/bin/tirocinium-server` (HTTP/WS の受け口はこれだけ。port 8084、経路・JSON の形は Node 版と同じ)
- DB の migration: `native/build/bin/tirocinium-migrate` (`apps/server/migrations/*.sql` をそのまま適用)
- Node に残す部分: 企業 worker `apps/server/src/companies-worker/index.ts` (C++ サーバが子プロセスとして起動。外から接続を受けない)
- 画面 (`*-viewer/`) と `apps/desktop` は移植しない (C++ サーバが固定ファイルとして返す)

## 0. 前提として確かめた事実

| 項目 | 確かめた内容 | 影響 |
|---|---|---|
| 実行時の DB | `apps/server/src/index.ts` は `hydrateSecrets()` 後に `initSql()` を呼ぶが、`config.databaseUrl` を設定する経路が無い (`DATABASE_URL` は scripts だけが読む)。常駐サーバは常に `node:sqlite` (Node 同梱の SQLite) で `data/tirocinium.sqlite` を開く。 | C++ 版は libpq (Postgres) だけで動く。`DATABASE_URL` (postgres://) を env かローカルの暗号化 config から読み、無い・SQLite を指す場合は起動を拒否する。既存の SQLite のデータの移し替えは §6 (人間の判断)。 |
| Postgres 用 migration | `migrations/` に 017 (analytics) が無く、`analytics/store.ts` の SQL は SQLite 専用。Node 版は Postgres では analytics が動かない。 | `apps/server/migrations/017_analytics.sql` (SQLite 版と同じ列) を追加した。既存の migration は変えていない。 |
| PASETO の版・用途 | Cernere は **v4.public** (Ed25519) で署名。claims は `sub/aud/iat/exp(ISO 8601)/kind/jti`、footer は `{"kid":…}`。公開鍵は `/.well-known/cernere-public-key` が raw 32 byte の base64。`CERNERE_PUBLIC_KEY` は PASERK (`k4.public.`) か PEM。 | OpenSSL 3 の Ed25519 で検証 (公式テストベクタ 4-S-1 で確認)。v4.local は使われていない。 |
| LLM の経路 | 面接官の発話は `codex exec --model sol` / `claude -p --model opus` を引数配列で起動 (`@ludiars/one-shot`)。judge・評価・サマリ・推薦は Anthropic の直接 API (API キー)、refine は OpenAI の chat.completions を 1 回。Node 側の直接 API は SDK をやめ Portus (`lib/portus`) で通信する (`spec/feature/inference/direct-api-portus.md`)。 | C++ 版は Anthropic の API を呼ばず `claude -p` (ツール無し) に置換。機能の有効判定は Node 版と同じく `ANTHROPIC_API_KEY` の有無 (キーは子に渡さない)。OpenAI は HTTPS の 1 リクエスト。 |
| gRPC STT | `packages/voice` の gRPC は Imperativus stt-service の `StreamingRecognize` (双方向ストリーム) 1 本。既定は off。 | gRPC C++ は入れない。設定されていれば C++ 版は起動を拒否する (§6)。 |
| 外部 HTML / フィード | 企業クロール (listing / enrich / contribute / job-news / AI 調査) は HTML・RSS・Atom を解析し、LLM で抽出する。 | 共通規約により C++ で HTML パーサーを自作しない → Node の企業 worker に残す (受け口は持たない)。 |
| 本番の起動方法 | catalog は `npm run dev:server` (= `tsx watch src/index.ts`)。tsx (esbuild を含む) は本番で動いている。 | 企業 worker も `node --import tsx` で起動する (既存と同じ)。dist から起動する案は §7。 |

## 1. 依存の棚卸し表 (移行前 → 判断)

`python3 native/tools/npm_dep_inventory.py package-lock.json` の結果 (本番依存のみ、devDependencies を除く)。
「推移的閉包」は自身を含む外部パッケージ数。`@tirocinium/*` はリポ内のワークスペースで、閉包は中身の外部依存。

| 利用元 | 直接依存 | 版 | 推移的閉包 | 判断 | 理由・置き場所 |
|---|---|---|---|---|---|
| apps/server | `hono` | 4.12.19 | 1 | 置き換え済み | Boost.Beast の受け口 (`io/http_server`) + 同じ規則のルータ (`http/router`, `http/cors`, `app/pipeline`)。 |
| apps/server | `@hono/node-server` | 1.19.14 | 1 | 置き換え済み | 同上。viewer は固定ファイルを返すだけ (8 MiB 上限)。 |
| apps/server | `ws` | 8.20.1 | 1 | 置き換え済み | Beast websocket。サーバ側 3 経路 (`app/ws_routes`) + クライアント側 3 本 (`io/ws_client`: Cernere project WS・composite 中継・Discord gateway)。 |
| apps/server | `paseto` | 3.1.4 | 1 | 置き換え済み | `core/paseto` + `crypto/crypto` (OpenSSL Ed25519)。 |
| apps/server | `postgres` | 3.4.9 | 1 | 置き換え済み (サーバ) / 残す (worker) | `io/pg_pool` (libpq)。企業 worker は Postgres を postgres.js で読む。 |
| apps/server | `@discordjs/voice` | 0.17.0 | 8 | 要判断 (未移植) | Discord の音声 (UDP + 暗号 + Opus + DAVE) は §6。テキスト Bot は移植済み (`app/discord_bridge`)。 |
| apps/server | `opusscript` | 0.1.1 | 1 | 要判断 | 音声と同時。 |
| apps/server | `prism-media` | 1.3.5 | 1 | 要判断 | 音声と同時。 |
| apps/server | `gray-matter` | 4.0.3 | 10 | 不要 (サーバ) / 残す (scripts) | サーバは使っていない (Consult スキルの frontmatter 除去は `domain::strip_frontmatter`)。 |
| apps/server | `@ludiars/blackbox` | 0.2.0 | 1 | 不要 (既定 off) | judge の卒業機構 (SQLite)。`TIROCINIUM_JUDGE_BLACKBOX=1` なら C++ 版は起動を拒否 (§6)。 |
| apps/server | `@ludiars/canalis` | 0.1.0 | 1 | 残す (Node CLI) | `companies:notion-import` だけ (ブラウザ操作)。 |
| apps/server | `@tirocinium/llm` | — | 43 → 2 | 置き換え済み (サーバ) / 残す (worker) | 純関数は `core/llm/*` (golden で一致)。Node 側は SDK 2 つを Portus に替え、閉包は `@ludiars/one-shot` と `@ludiars/portus` の 2 つ。 |
| packages/llm | `@anthropic-ai/sdk` | 0.30.1 | 39 | 置き換え済み (サーバ) / Portus に置き換え (Node) | サーバは `claude -p`。Node 側 (worker の抽出・Node 版サーバ・scripts) は Portus の `AnthropicClient` (stream は `packages/llm/src/anthropic-stream.ts`)。依存から外した。 |
| packages/llm | `openai` | 4.104.0 | 39 | 置き換え済み (サーバ) / Portus に置き換え (Node) | refine は HTTPS 1 回 (`app/llm`)。Node 側は Portus の `OpenAIClient`。依存から外した。 |
| packages/llm | `@ludiars/portus` (追加) | 0.1.0 (`lib/portus` submodule、タグ v0.1.0 = af663ded) | 1 | Node に追加 | 実行時依存ゼロ (`node:` 標準と fetch だけ)。`npm run build:portus` で dist を作る。 |
| packages/llm | `@ludiars/one-shot` | 0.1.0 | 1 | 置き換え済み | `app/one_shot` + `io/process`。 |
| apps/server | `@tirocinium/secrets` | — | 1 | 置き換え済み (サーバ) / 残す (worker) | `app/secrets` (agent クライアント・ローカル暗号化 config)。 |
| packages/secrets | `@ludiars/encrypted-config` | 0.1.0 | 1 | 置き換え済み (サーバ) / 残す (worker) | 同じファイル形式 (scrypt + AES-256-GCM) を OpenSSL で。Node で暗号化した fixture の復号で互換を確認。 |
| apps/server | `@tirocinium/training` | — | 12 | 置き換え済み (Memoria) | Memoria クライアント (`app/memoria`)。`analyze.ts` (Lector) はサーバ未使用。 |
| packages/training | `@ludiars/lector` | 0.1.0 | 12 | 残す (Node、サーバ外) | HTML 解析。 |
| apps/server | `@tirocinium/voice` | — | 35 | 一部置き換え | VOICEVOX TTS・WAV 抽出・文分割は `app/voice`。gRPC STT は §6。 |
| packages/voice | `@grpc/grpc-js` | 1.14.4 | 34 | 要判断 | §6。 |
| packages/voice | `@grpc/proto-loader` | 0.7.15 | 32 | 要判断 | §6。 |
| apps/server | `@tirocinium/companies` | — | 43 → 2 | 一部置き換え | 社名正規化・ソース一覧・推薦スコア/推薦は `core/domain` (golden で一致)。HTML/RSS/robots/抽出は worker。 |
| apps/server | `@tirocinium/analytics` | — | 0 | 置き換え済み | 型だけ。 |
| (Node ランタイム) | `node:sqlite` | Node 22 同梱 | — | 要判断 | §6。 |
| (Node ランタイム) | Node 同梱部品 (OpenSSL・Brotli・zlib・llhttp・nghttp2・undici・c-ares・libuv・V8・ICU) | Node 22 | — | 受け口から外した | C++ サーバは HTTP 受け口・外向き HTTP・WS を自前で持ち、展開器を持たない (`Accept-Encoding: identity`、`Content-Encoding` 付き応答は拒否)。Node は worker の中だけで動く。 |

### 依存の総数 (前 → 後)

| | 移行前 | 移行後 |
|---|---|---|
| 外から接続を受けるプロセス | Node + npm 112 (本番依存。Portus 適用後の Node 版は 73) + tsx 29 (起動に使用) | C++ サーバ: npm 0。C++ 依存 5 (Boost ヘッダ・nlohmann_json・OpenSSL 3・libpq・Lorica) + 標準ライブラリ |
| 子プロセス (企業 worker、受け口なし) | — | Node + npm 4 (`postgres`・`@ludiars/portus`・`@ludiars/encrypted-config`・`@ludiars/one-shot`。Portus 適用前は SDK 2 つの閉包を含めて 45) + tsx 29 |
| 運用 CLI (`npm run companies:*` ほか) | Node | Node のまま (§7) |

worker の数は `native/tools/npm_dep_inventory.py` の関数で上のパッケージの閉包を合併した数
(worker の入口から import を静的にたどって外部パッケージを列挙した結果)。Portus 適用前は 45、適用後は 4。

## 2. 移行後の C++ 依存

| 依存 | 版 | 取得 | 推移的依存 |
|---|---|---|---|
| C++ 標準ライブラリ (C++20) | GCC 13.3 / MSVC | — | — |
| Boost (Asio / Beast、ヘッダのみ) | 1.87.0 | `boost-1.87.0-b2-nodocs.zip` SHA256=40efbb1f38b8cf186fd7bb12809f561ae1c233bae0f75146862e9bfce77d0d42 | なし (コンパイル済みの Boost ライブラリはリンクしない) |
| nlohmann_json | 3.11.3 | `json.tar.xz` SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d | なし |
| OpenSSL 3 | システム (Ubuntu 24.04: 3.0.13) | `find_package(OpenSSL 3)` | libcrypto / libssl |
| libpq | システム (16.15) | `find_package(PostgreSQL)` | OpenSSL。Ubuntu の libpq は GSSAPI (krb5)・LDAP (ldap/sasl/gnutls) も引く (ldd で確認)。 |
| Lorica | 5e8281b0e60fa16f814e16eaa620715937e8618d (2026-11-11 の main。前回は cab4f12) | `LORICA_SOURCE_DIR` か FetchContent | なし |
| libopus | (未使用) | — | Discord 音声を入れる時だけ (§6)。 |

全 target (ライブラリ 4・実行ファイル 2・テスト 21) に `lorica_harden_target`。

## 3. 機能の対応表 (TS → C++)

✅ 移植済み / 🟡 一部 / ⛔ Node のまま (理由つき)

| TS | C++ | 状態 | 備考 |
|---|---|---|---|
| `index.ts` (hono・CORS・404/500・起動順) | `app/server_main`, `app/pipeline`, `http/*`, `io/http_server` | ✅ | 起動順は同じ。bind 既定 127.0.0.1、port 8084。 |
| `routes/health.ts` (`/api/health` `/health` `/api/readiness`) | `app/routes/health` | ✅ | |
| `routes/auth.ts` + `auth/cernere-session.ts` / `cernere-project-client.ts` / `cernere-public-keys.ts` | `app/cernere` | ✅ | project WS の代理は 1 本を使い回し、接続・要求とも 10 秒。 |
| `auth/cernere.ts` (cernereAuth・dev 認証) | `app/auth`, `core/paseto` | ✅ | |
| `routes/reservations.ts` + `reservation/{coordinator,slot,tick-rules,tick}.ts` | `app/routes/interview_routes`, `app/interview_repo`, `core/domain`, `app/reservation_tick` | ✅ | tick は 60 秒ごと・重ならない。 |
| `routes/sessions.ts` / `summary.ts` / `personas.ts` / `feedback.ts` / `ft_runs.ts` / `training.ts` | `app/routes/interview_routes`, `app/interview_repo` | ✅ | |
| `materials/*` (提出・読解・要点・Consult スキル) | `app/materials`, `core/domain`, `app/session_state` | ✅ | 読解の Read を 1 ファイルに限定 (§4)。 |
| `ws/handler.ts` / `ws/call-handler.ts` / `ws/call-tickets.ts` / `auth/cernere-composite-ws-relay.ts` | `app/ws_routes`, `app/session_state` | ✅ | |
| `ws/session-runtime.ts` (面接の進行) | `app/session_runtime` | ✅ | |
| `packages/llm` (プラン・フェーズ・プロンプト・出力検証・Brain) | `core/llm/*`, `app/llm` | ✅ | golden 711 件で Node と一致。 |
| `brief/*` (ブリーフ・充足判定・qa-seed・会社の質問候補) | `app/brief`, `core/domain` | ✅ | 企業サイトの AI 調査 (HTML) は worker に委託 (無ければ「確認できない」)。 |
| `routes/backdoor.ts` / `es-requests.ts` / `resources.ts` / `analytics.ts`、`es-review/*` | `app/routes/alumni_routes`, `app/alumni_repo` | ✅ | |
| `routes/companies.ts` (読み出し 14 経路・クロール投入・設定済みソース・地図設定) | `app/routes/companies_routes`, `app/companies_repo` | ✅ | |
| `routes/companies.ts` (crawl-listing / crawl-job-news / contribute / enrich / merge-duplicates / ob/sync) | 同上 → 企業 worker | ⛔ (委託) | HTML/RSS/Notion の解析と LLM 抽出を含む。失敗の形 (`{error, detail}` 502、`company not found` は 404) は同じ。 |
| `routes/companies.ts` (map-markers / games/:id/related / by-tech) + `companies/{geocode,games-repo,tech-repo}.ts` の読み出し | `app/companies_repo` (`build_map_markers` / `related_companies_by_game` / `companies_by_tech`) | ✅ | geocode は外向き HTTP (SSRF 判定つき、10 秒、1 MiB)。Node 版に無い全体の期限 60 秒を足した (過ぎた分は次回)。 |
| `routes/companies.ts` (ob/studios / crawl-queue・enrich-queue の状態) | 同上 → 企業 worker | 🟡 | OB スタジオの代表作選びは系列名の NFKC 正規化と `localeCompare` (ICU) を要する。キューの状態はキューを持つ worker に聞き、worker が無ければ DB から組み立てる。ob/studios は worker が無ければ 503。 |
| `companies/{crawl-queue,enrich-queue,job-news-queue}.ts` (常駐キュー) | 企業 worker | ⛔ | クロール本体と同じ理由。 |
| `routes/recommend.ts` + `recommend/*` + `packages/companies` の score/recommend | `app/recommend`, `core/domain/recommend` | ✅ | LLM rerank は `claude -p` (RECOMMENDER)。golden で一致。 |
| `discord/bridge.ts` (テキスト面接)・`discord/commands.ts`・`discord/gateway-client.ts`・`es-review/discord-relay.ts` | `app/discord_bridge`, `core/domain` | ✅ | |
| `discord/voice-bridge.ts` / `voice-adapter.ts` (音声面接) | — | ⛔ | §6。`!tr voice` はテキスト面接で始め、その旨を伝える。 |
| `packages/voice` VOICEVOX TTS | `app/voice` | ✅ | |
| `packages/voice` gRPC STT・VAD・音声キュー | — | ⛔ | §6。STT が無い構成では `audio_chunk` を受けて捨てる (Node 版は溜め続けていた)。 |
| `secrets/*` + `packages/secrets` | `app/secrets`, `crypto/crypto` | ✅ | |
| `notifications/nuntius.ts` | `app/services` (push_notification) | ✅ | 送りっぱなしは上限付きの背景キュー。 |
| `packages/training` Memoria クライアント | `app/memoria` | ✅ | |
| `db/migrate.ts` (Postgres) | `app/migrate` + `tirocinium-migrate` | ✅ | |
| `db/sqlite-driver.ts` (常駐サーバの既定 DB) | — | ⛔ | SQLite はこのリポで未許可 (§6)。 |
| `judge-blackbox/*` | — | ⛔ | 既定 off。有効なら起動を拒否 (§6)。 |
| `version.ts` | `app/version` | ✅ | |
| `scripts/*` (`companies:*`・`seed-personas`・`ft-loop` 等の運用 CLI) | — | ⛔ | サーバの受け口ではない運用ツール。HTTP+JSON だけのもの (gBizINFO・Wikidata・Sheets 同期・重複マージ) の C++ 化は §7 の残り。 |

### Node 版との違い (意図したもの)

- `sub` の無いトークンは 401 (Node 版は undefined のまま通していた)。
- 本文の上限: 資料提出 7 MiB、その他 2 MiB (Node 版は資料以外に上限なし)。
- `:id` が UUID の形でない要求は 404 (Node + Postgres では 500)。`limit` / `offset` / `max` が数でなければ既定値 (Node 版は DB エラーで 500、map-markers の `max` は上限なしになっていた)。
- 未知のパスへの WebSocket upgrade は 404 で断る (Node 版は応答せず放置)。session WS は init が終わるまで後続のフレームを待たせる。
- Discord 本文の分割でサロゲート対を割らない。gateway の heartbeat 要求 (op 1) に応じ、120 秒無通信なら切って再接続する。
- 企業 worker への委託は同時 4 件まで、超えたら待たせずに断る (書き込み系は Node 版と同じ形の 502、読み出し系は 503)。
- LLM の CLI は同時 4 本まで、空きを 30 秒待って無ければ `llm_busy`。
- 外向き HTTP は圧縮を受け取らない。public_only の取得は解決した IP に接続を固定し、NAT64/6to4 に埋め込まれた内部 IPv4 も拒否する。
- 起動を拒否する構成: `DATABASE_URL` が無い・SQLite を指す、`TIROCINIUM_JUDGE_BLACKBOX=1`、STT が gRPC。

## 4. 安全の対応表 (既存の防御 → C++)

| 既存の防御 (TS) | 内容 | C++ での置き場所 |
|---|---|---|
| `auth/cernere.ts` cernereAuth | Bearer の PASETO v4.public を現行鍵 + 旧鍵で検証、aud・exp・iat・nbf、鍵が無ければ 503、dev 認証は loopback の時だけ | `app/auth.cpp` (`Authenticator::require` / `middleware`)、`core/paseto.cpp`、`crypto/crypto.cpp` |
| `auth/cernere.ts` assertSafeAuthConfig | `TIROCINIUM_DEV_AUTH=1` は loopback 以外で起動拒否 | `app/auth.cpp` (`assert_safe_config`)、`app/server_main.cpp` |
| `ws/handler.ts` | Bearer か `?token=`、所有者・active、401/403/500 | `app/ws_routes.cpp` (`session_ws`)、`Authenticator::authenticate_ws` |
| `ws/call-handler.ts` | 最初のフレームの 1 回限り ticket、認証 5 秒・初期化 30 秒、128 KiB、未処理 16 件で切断、テキストのみ、1 セッション 1 接続、内容をログに出さない | `app/ws_routes.cpp` (`call_ws`) |
| `ws/call-tickets.ts` | 32 byte 乱数、TTL 30 秒、最大 256 件、旧 ticket の無効化 | `app/session_state.cpp` (`CallTickets`) |
| `auth/cernere-composite-ws-relay.ts` | パス一致、ticket の形、未設定 503、上流接続後に upgrade、失敗 502、中身を読まない | `app/ws_routes.cpp` (`relay_ticket` / `cernere_relay`) |
| `middleware/rate-limit.ts` | ユーザ単位の固定窓、429 + Retry-After | `core/rate_limit.cpp`、`app/services.cpp` (`check_session_rate`) |
| `routes/sessions.ts` bodyLimit | 資料提出 7 MiB で 413 `material_too_large` | `app/pipeline.cpp` (`body_limit_for`)、`io/http_server.cpp` |
| `materials/material-policy.ts` | 復号前の大きさ見積もり、base64 検査、MIME 許可表、復号後 5 MiB | `core/domain/domain.cpp` (`parse_material_upload`: 見積もりを Lorica の予算に課金) |
| `materials/material-reader.ts` | 一時フォルダ、固定ファイル名、120 秒、成否に関わらず削除、要点の形と上限 | `app/materials.cpp`。**所見 (material-reader.ts:19) の修正**: Read を `Read(./material.<ext>)` の 1 ファイルに限定し `--strict-mcp-config`。 |
| `materials/material-store.ts` / `submit-material.ts` | メモリだけ・TTL 45 分・64 件・持ち主だけ、1 セッション 1 資料・同時提出の排他 | `app/session_state.cpp` (`MaterialStore`)、`app/materials.cpp` |
| `es-review/*` | 接続コードは SHA-256 で保存・10 分・1 回限り、DM 限定、本文検査、配送の冪等、本文をログに出さない | `app/alumni_repo.cpp`、`app/discord_bridge.cpp` (`handle_review_message`)。**本文検査の正規表現は線形の走査に置換** (`review_body_has_contact`、境界テストあり)。 |
| `routes/es-requests.ts` / `routes/backdoor.ts` | 社名 200 字・登録済み企業のみ / 項目の許可リスト・本人だけ更新 | `app/routes/alumni_routes.cpp` |
| `routes/companies.ts` canCrawl | 管理者 ID の許可リスト (空なら認証済み全員) | `app/routes/companies_routes.cpp` (`can_crawl`) |
| `index.ts` | 既定 bind 127.0.0.1、CORS、404、例外は 500 `{error:'internal'}` | `app/config.hpp`、`http/cors.cpp`、`app/pipeline.cpp` |
| `discord/bridge.ts` | 許可チャンネル、bot 発言を無視、`allowed_mentions.parse=[]`、`resume_gateway_url` の検査、致命的 close code で再接続しない | `app/discord_bridge.cpp` (+ REST のチャンネル ID は数字だけ) |
| `@ludiars/one-shot` | API キー類を子に渡さない、シェルを使わない、出力上限・期限・ツール禁止 | `app/one_shot.cpp`、`io/process.cpp` (POSIX はプロセスグループ、Windows は Job、`.cmd/.bat` は起動しない) |
| `secrets/*` | 秘密はメモリだけ、ログにはキー名だけ、agent 不通時の退避 | `app/secrets.cpp`、`crypto/crypto.cpp` |
| `companies/ssrf-guard.ts` | 内部アドレスの拒否、リダイレクトを手動追従 | `core/ip_policy.cpp`、`io/http_client.cpp`。**所見 (ssrf-guard.ts:147) の修正**: 名前解決は 1 回、全 IP を検査し、その IP に接続を固定する。 |
| 二乗時間の正規表現 | LLM 出力の JSON 取り出し、ES 本文の検査、社名正規化 | `core/llm/output.cpp` (`extract_json_block`)、`app/discord_bridge.cpp`、`core/domain/domain.cpp` (`normalize_name`) — すべて前進走査 |

### Lorica で課金している外部入力

| 入力 | 課金・検査 |
|---|---|
| すべての JSON (HTTP 本文・WS フレーム・LLM 出力・Cernere/agent/Memoria/VOICEVOX/Discord の応答・worker の応答行) | `parse_json` / `parse_json_bounded` (`input_budget` で大きさ・要素数・深さ・復号後の文字列) |
| DB の結果 | `io/pg_pool.cpp` + `db/pg_decode.cpp` (結果全体を `input_budget` で課金) |
| 資料の base64 | 復号後の大きさの見積もりを `input_budget` に課金してから復号 |
| WAV (VOICEVOX) | `contains_range` / `checked_add` でチャンクの境界と桁あふれ |
| HTTP の受信 | ヘッダ 16 KiB、本文は経路ごとの上限 (Content-Length も読む前に検査)、同時接続 512 |
| 外向き HTTP / WS の受信 | 応答の上限 (呼び出しごと)、WS は 1 メッセージの上限、圧縮は受けない |
| 子プロセスの出力 | stdout の上限 (超えたら kill)、worker の 1 行 16 MiB (超えた行は読み捨て) |

## 5. テストの対応表 (TS → ctest)

ctest の名前は `tirocinium.<実行ファイル>`。DB を使うもの (`pg_*`) は `TR_TEST_DATABASE_URL` が無ければ skip (77)。

| TS のテスト | C++ のテスト | 備考 |
|---|---|---|
| `routes/health.test.ts`, `version.test.ts`, `secrets/hydrate.test.ts` (設定部分) | `app_config_tests` | |
| `secrets/hydrate.test.ts`, `packages/secrets/client.test.ts` | `app_secrets_tests` | + Node で暗号化した config の復号 (互換性) |
| `routes/auth.test.ts` | `cernere_auth_routes_tests`, `auth_paseto_tests` (公開鍵の集合) | |
| `auth/cernere-composite-ws-relay.test.ts` | `pg_runtime_tests` (composite relay) | 偽の Cernere を loopback に立てて往復 |
| `companies/ssrf-guard.test.ts` | `net_policy_tests`, `io_http_client_tests` | C++ だけの追加: 数値表記・NAT64/6to4・接続固定 |
| `middleware/rate-limit.test.ts`, `db/session-metadata.test.ts` | `pg_interview_routes_tests` | |
| `ws/call-tickets.test.ts`, `ws/session-runtime-helpers.test.ts` | `session_helpers_tests` | |
| `ws/frames.test.ts` | `pg_runtime_tests` (ws session / ws call) | 未知の kind は error フレーム / 通話は切断 |
| `discord/commands.test.ts`, `discord/bridge.test.ts` (RuntimeDiscordSocket・chunkMessage), `es-review/discord-relay.test.ts` | `discord_relay_tests` (+ `golden_pure_tests`) | |
| `discord/bridge.test.ts` (voice adapter) | — | 音声は未移植 (§6) |
| `brief/qa-seed-loader.test.ts` | `voice_brief_tests` | Node 版は実ファイルを読んでいた。C++ 版は合成の seed |
| `brief/sufficiency-gate.test.ts`, `reservation/{slot,tick-rules}.test.ts`, `feedback/weakness-math.test.ts`, `persona/prompt.test.ts`, `materials/{material-policy,material-reader,consult-skills}.test.ts`, `packages/llm/*.test.ts` (rng/phase/question-plan/response/brain/coerce/evaluator/judge/role-aliases/specialist-*/company-question-boundaries), `packages/companies/{normalize,score,recommend}.test.ts` | `golden_pure_tests` (Node の出力 711 件と一致) + 個別の単体テスト | 記録: `native/tools/golden/record_pure.mjs` |
| `packages/llm/models.test.ts` | `llm_process_tests` (resolveModels) | |
| `materials/{material-store,submit-material}.test.ts` | `pg_interview_routes_tests` (資料の境界)、`llm_process_tests` | |
| `packages/voice/{tts-voicevox-provider,stt-provider}.test.ts` | `voice_brief_tests` | STT の grpc は「拒否」になる |
| `packages/voice/{vad,queue}.test.ts` | — | STT 経路と一緒に未移植 (§6) |
| `packages/training/memoria-client.test.ts` | `pg_interview_routes_tests` (training)、`pg_runtime_tests` | 偽の Memoria |
| `packages/companies/geocode.test.ts` (parseGeocodeResult) | `pg_runtime_tests` (map markers) | + キャッシュ・失敗の記録・max の扱い |
| `companies/{backdoor-repo,repo-quality}.test.ts`、`crawl-queue-repo.test.ts` (投入・畳み込み・件数・直近) | `pg_alumni_routes_tests`, `pg_runtime_tests` | C++ に移した読み出し・投入の部分。キューの claim/完了/失敗は worker 側 (Node のテストのまま) |
| `companies/news-config.test.ts` | `pg_runtime_tests` (job-sources の表示) | 表示に使う kind/有効判定だけ C++。newgradOnly・company は worker 側 |
| `judge-blackbox/judge-blackbox.test.ts` | — | 未移植 (起動拒否) |
| `companies/*` のクロール・抽出系、`ob-patterns/*`、`packages/companies/*` (HTML/RSS/robots/抽出/ゲーム/OB/geocode)、`packages/training/analyze.test.ts`、`packages/avatar/motion.test.ts`、`apps/desktop/allowed-hosts.test.ts` | — | Node に残る部分 (worker・CLI・デスクトップ)。Node の vitest のまま |

C++ だけの追加テスト: `io_http_server_tests` (ソケット越しの境界)、`db_decode_tests` / `pg_db_tests` (libpq の型変換・migration)、
`companies_worker_tests` (常駐子プロセスと worker の取り次ぎ)、`pg_runtime_tests` (WS の端から端まで・Discord の偽 gateway・企業/推薦・tick)。

## 6. 人間の判断が要ること

1. **常駐サーバの DB (SQLite → Postgres)**: Node 版は実際には `data/tirocinium.sqlite` を使っている。C++ 版は Postgres だけ。
   切り替えには Postgres の用意 (`DATABASE_URL`)、migration の適用 (`tirocinium-migrate`)、既存 SQLite のデータの移し替えが要る
   (SQLite はこのリポで未許可なので C++ では読まない)。企業 worker も同じ Postgres を使う。
2. **Discord の音声面接**: UDP + 暗号 (AEAD) + Opus に加え、Discord の DAVE (E2EE) への対応要否で規模が大きく変わる。
   現状はテキスト面接で始めて伝える。音声が要るなら libopus を足して実装するか、音声だけ Node に残すかの判断が要る
   (同じ bot token で 2 つの gateway を張れないので、分けるなら token を分ける)。
3. **gRPC STT (Imperativus)**: gRPC C++ は入れない。Imperativus 側に HTTP (WebSocket など) の口を作るか、STT を使う間は Node 版で動かすか。
4. **judge の卒業機構 (`@ludiars/blackbox`、SQLite)**: 既定 off。使うなら保存先の変更 (Postgres) が要る。
5. **企業 worker の LLM**: クロール抽出は Anthropic の直接 API (API キー) を使う (通信は SDK から Portus に替えた)。`claude -p` に寄せるか (llm-completer の cli 経路はある)。
6. **企業 worker の起動方法**: 今は既存と同じく `node --import tsx` (tsx = esbuild を含む 29 パッケージ)。`tsc` で build した dist を node で起動すれば tsx を外せる。
7. **公開 POST `/api/v1/companies/crawl-job-news`**: Node 版のまま認証なしで外部取得を起動できる (取得先は設定済みソースだけ)。C++ 版は worker の同時実行上限で抑えているだけ。認証を付けるかの判断。

## 7. 残り・切り替え後に外せる依存

- 切り替え後 (C++ サーバ + worker) に `apps/server` から外せる直接依存: `hono`, `@hono/node-server`, `ws`, `paseto`
  (音声・STT を移した後なら `@discordjs/voice`, `opusscript`, `prism-media`, `@grpc/grpc-js`, `@grpc/proto-loader`、
  blackbox を捨てるなら `@ludiars/blackbox`)。`@anthropic-ai/sdk` と `openai` は Portus に置き換えて外した。
  Node 実装と package.json は今回は消していない。
- OB スタジオ (`/ob/studios`) の C++ 化には NFKC 正規化と照合順序 (ICU 相当) が要る。ICU は許可依存に無いので worker のまま。
- HTTP+JSON だけの運用 CLI (gBizINFO 取り込み・Wikidata・Sheets 同期・重複マージ・系列正規化・技術グラフ) の C++ 化。
- Windows でのビルドと実行の確認 (コードは Windows 分岐を持つが、クラウドでは Linux しか試していない)。

## 8. 本社での手順

```sh
# 依存: CMake 3.24+、Ninja、GCC 13 か MSVC 2022、OpenSSL 3 と libpq の開発パッケージ
# 企業 worker (Node) の準備: submodule (lib/lapilli・lib/portus) → npm install → Portus の dist
git submodule update --init lib/lapilli lib/portus && npm install && npm run build:portus
cmake -S native -B native/build -G Ninja -DCMAKE_BUILD_TYPE=Release [-DLORICA_SOURCE_DIR=<Lorica>]
cmake --build native/build
# DB を使うテストには空の Postgres を 1 つ (テストが public schema を作り直す)
native/tools/pg_test_cluster.sh start      # 一時クラスタ (port 55433)
TR_TEST_DATABASE_URL=postgres://tirocinium@127.0.0.1:55433/tirocinium_test ctest --test-dir native/build --output-on-failure
# 本番 DB の migration
DATABASE_URL=postgres://... native/build/bin/tirocinium-migrate
# golden の取り直し (Node 側を変えた時)
node --experimental-transform-types --import ./native/tools/golden/ts-loader.mjs \
     native/tools/golden/record_pure.mjs native/tests/fixtures/golden_pure.json
```

実サービスでの確認 (クラウドでは未実施): Cernere の本物の token での `/api/v1/*` と session WS、composite ログイン、
`claude -p` / `codex exec` の実呼び出し (面接・judge・評価・サマリ・推薦・資料読解)、OpenAI refine、Memoria・Nuntius・VOICEVOX、
Discord の本物の gateway (テキスト面接・ES 相談の仲介)、企業 worker (tsx あり) でのクロール・enrich・求人ニュース、
Excubitor からの起動と health。
