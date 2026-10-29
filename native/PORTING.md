# Tirocinium サーバの C++ 移植 — 棚卸しと対応表

job `cpp-node-20261030` (WP-Tirocinium)。目的は脆弱性の受け口 (npm 依存・Node 同梱部品) を減らすことと、
外部依存の総数・種類を増やさないこと。速度は目的ではない。

この文書は移植の正本の対応表で、機能を移すたびに更新する。数値の作成手順は
`native/tools/npm_dep_inventory.py` (package-lock.json だけを読む。ネットワーク不要)。

## 0. 前提として確かめた事実

| 項目 | 確かめた内容 | 影響 |
|---|---|---|
| 実行時の DB | `apps/server/src/index.ts` は `hydrateSecrets()` 後に `initSql()` を呼ぶが、`config.databaseUrl` を設定する経路が無い (`DATABASE_URL` は scripts だけが読む)。常駐サーバは常に `node:sqlite` (Node 同梱の SQLite) で `data/tirocinium.sqlite` を開く。 | 指示書の「Postgres → libpq」は scripts と `migrations/` 用。C++ 版は libpq で動くが、既存データ (SQLite ファイル) を読むには SQLite (このリポでは未許可) が要る → 「人間の判断が要ること」。 |
| Postgres 用 migration | `migrations/` に 017 (analytics) が無く、`analytics/store.ts` の SQL は SQLite 専用 (`date(ts)` / `datetime('now', …)`)。Node 版は Postgres では analytics が動かない。 | C++ 版は Postgres 方言の SQL を持つ。表は人間の判断 (017 の PG 版の追加) を待つ。 |
| PASETO の版・用途 | Cernere (`server/src/auth/paseto.ts`) は **v4.public** (Ed25519) で署名。claims は `sub/aud/iat/exp(ISO 8601)/kind/jti`、footer は `{"kid":…}`。公開鍵は `/.well-known/cernere-public-key` が raw 32 byte の base64 を返す。`CERNERE_PUBLIC_KEY` は paseto 3.1.4 の `_checkPublicKey` が受ける PASERK (`k4.public.`) か PEM。 | OpenSSL 3 の Ed25519 (EVP_DigestVerify) で検証できる。v4.local は使われていない。 |
| LLM の経路 | 面接官の発話は `codex exec --model sol` / `claude -p --model opus` を引数配列で起動 (`@ludiars/one-shot`)。judge・評価・サマリ・推薦は `@anthropic-ai/sdk` (API キー)、refine は `openai` (API キー、chat.completions を 1 回呼ぶだけ)。 | Anthropic 系は `claude -p` の CLI に置換 (API キーを持たない)。OpenAI は HTTPS (Beast + OpenSSL) の 1 リクエスト。 |
| gRPC STT | `packages/voice` の gRPC は Imperativus stt-service の `StreamingRecognize` (双方向ストリーム) 1 本だけ。既定は `TIROCINIUM_STT_BACKEND` 未設定 = off。 | gRPC C++ は入れない。HTTP/2 の自作も不採用 → 「人間の判断が要ること」。 |
| 外部 HTML / フィードの解析 | 企業クロール (listing / enrich / contribute / job-news / AI 調査) は HTML・RSS・Atom を解析する。二乗時間の走査は 64fa9d3 で Node 側を線形化済み。 | 共通規約により HTML パーサーを C++ で自作しない → Node のまま別プロセスに残す。 |

## 1. 依存の棚卸し表 (移行前)

`python3 native/tools/npm_dep_inventory.py package-lock.json` の結果 (本番依存のみ、devDependencies を除く)。
「推移的閉包」は自身を含む外部パッケージ数。`@tirocinium/*` はリポ内のワークスペースで、閉包は中身の外部依存。

| 利用元 | 直接依存 | 版 | 推移的閉包 | 判断 | 理由 |
|---|---|---|---|---|---|
| apps/server | `hono` | 4.12.19 | 1 | 置き換え | Boost.Beast の HTTP 受け口 + 自前のルータ (`native/src/http/`)。 |
| apps/server | `@hono/node-server` | 1.19.14 | 1 | 置き換え | 同上 (serveStatic は使っていない。viewer は固定ファイルを読んで返すだけ)。 |
| apps/server | `ws` | 8.20.1 | 1 | 置き換え | Boost.Beast websocket (サーバ側 3 経路 + クライアント側 2 経路)。 |
| apps/server | `paseto` | 3.1.4 | 1 | 置き換え | v4.public の検証を OpenSSL 3 の Ed25519 で実装 (PAE・claim 検査は paseto 3.1.4 と同じ規則)。 |
| apps/server | `postgres` | 3.4.9 | 1 | 置き換え | libpq (システム提供、許可済み)。migration の SQL はそのまま使う。 |
| apps/server | `@discordjs/voice` | 0.17.0 | 8 | 置き換え予定 (要判断) | Discord 音声 Gateway + UDP + AEAD + libopus の自作。DAVE (E2EE) の要否で規模が変わるため判断待ち (§6)。 |
| apps/server | `opusscript` | 0.1.1 | 1 | 置き換え予定 | libopus (Odeum/native で採用済み)。Discord 音声と同時。 |
| apps/server | `prism-media` | 1.3.5 | 1 | 置き換え予定 | 同上。 |
| apps/server | `gray-matter` | 4.0.3 | 10 | 不要 (サーバ) / 残す (scripts) | サーバは使っていない。`scripts/seed-personas` 等の frontmatter 読みだけ。 |
| apps/server | `@ludiars/blackbox` | 0.2.0 | 1 | 不要 (既定 off) | judge の卒業機構。既定 `TIROCINIUM_JUDGE_BLACKBOX=0`。保存先が SQLite のため C++ では未実装で、有効化されていたら C++ 版は起動を拒否する (無言の縮退をしない)。 |
| apps/server | `@ludiars/canalis` | 0.1.0 | 1 | 残す (Node) | `companies:notion-import` CLI だけが使う (ブラウザ操作・HTML 解析)。 |
| apps/server | `@tirocinium/llm` | — | 43 | 置き換え | 純関数 (プロンプト・質問プラン・フェーズ機・乱数・出力の検証) は C++ へ。SDK 2 本は下記。 |
| packages/llm | `@anthropic-ai/sdk` | 0.30.1 | 39 | 置き換え | `claude -p` を引数配列で起動 (one-shot と同じ環境分離)。API キーを持たない。 |
| packages/llm | `openai` | 4.104.0 | 39 | 置き換え | refine の chat.completions 1 回だけ。HTTPS (Beast + OpenSSL) で十分。キーは既存の秘密の経路のまま。 |
| packages/llm | `@ludiars/one-shot` | 0.1.0 | 1 | 置き換え | 起動規則 (環境変数の除去・モデル解決・シェル不使用) を C++ で同じに実装。 |
| apps/server | `@tirocinium/secrets` | — | 1 | 置き換え | secret-agent クライアント (HTTP) とローカル暗号化 config。 |
| packages/secrets | `@ludiars/encrypted-config` | 0.1.0 | 1 | 置き換え | 同じファイル形式 (`{plain, secrets:{v,salt,iv,tag,data}}`、scrypt N=16384 r=8 p=1 + AES-256-GCM) を OpenSSL で読み書き。 |
| apps/server | `@tirocinium/training` | — | 12 | 一部置き換え | Memoria クライアント (HTTP+JSON) は C++。`analyze.ts` (Lector) はサーバ未使用。 |
| packages/training | `@ludiars/lector` | 0.1.0 | 12 | 残す (Node、サーバ外) | HTML 解析。サーバからは呼ばれない。 |
| apps/server | `@tirocinium/voice` | — | 35 | 一部置き換え | VOICEVOX TTS (HTTP)・VAD・WAV 抽出は C++。gRPC STT は要判断。 |
| packages/voice | `@grpc/grpc-js` | 1.14.4 | 34 | 要判断 | gRPC C++ は推移的依存が大きく不採用。HTTP 化には Imperativus 側の変更が要る (§6)。 |
| packages/voice | `@grpc/proto-loader` | 0.7.15 | 32 | 要判断 | 同上。 |
| apps/server | `@tirocinium/companies` | — | 43 | 一部置き換え | サーバの読み出し経路が使う純関数 (社名正規化・ソース一覧・推薦スコア) は C++。HTML/RSS/robots の解析は Node のまま。 |
| apps/server | `@tirocinium/analytics` | — | 0 | 置き換え | 型だけ。 |
| (Node ランタイム) | `node:sqlite` | Node 22 同梱 | — | 要判断 | 常駐サーバの既定 DB。SQLite はこのリポで未許可 (§6)。 |
| (Node ランタイム) | Node 同梱部品 (OpenSSL・Brotli・zlib・llhttp・nghttp2・undici・c-ares・libuv・V8・ICU) | Node 22 | — | 受け口を外す | C++ サーバは HTTP 受け口・外向き HTTP・WS を自前 (Beast + OpenSSL) で持つ。Brotli / gzip の展開をしない (`Accept-Encoding: identity`、`Content-Encoding` 付きの応答は拒否)。 |

移行前の本番依存の外部パッケージ総数 (重複除去): **112** (+ Node ランタイム 1)。
サーバが実際に読み込むもの (scripts 専用の gray-matter / canalis / lector を除く) に限っても 80 以上。

## 2. 移行後の C++ 依存 (予定)

| 依存 | 版 | 取得 | 推移的依存 |
|---|---|---|---|
| C++ 標準ライブラリ (C++20) | GCC 13 / MSVC | — | — |
| Boost (Asio / Beast、ヘッダのみ) | 1.87.0 | `boost-1.87.0-b2-nodocs.zip` SHA256=40efbb1f38b8cf186fd7bb12809f561ae1c233bae0f75146862e9bfce77d0d42 | なし (ヘッダのみ、コンパイル済みの Boost ライブラリはリンクしない) |
| nlohmann_json | 3.11.3 | `json.tar.xz` SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d | なし |
| OpenSSL 3 | システム (3.0.13) | `find_package(OpenSSL 3)` | libcrypto / libssl |
| libpq | システム (16) | `find_package(PostgreSQL)` | OpenSSL (+ ディストリのビルド設定により GSSAPI/LDAP) |
| libopus | システム (1.4) | pkg-config | なし (Discord 音声を入れる時だけ) |
| Lorica | cab4f12086e30484f249d1b4aa479bf7cdec13a9 | `LORICA_SOURCE_DIR` か FetchContent | なし |

## 3. 機能の対応表 (TS → C++)

状態: ✅ 移植済み / 🟡 一部 / ⛔ Node のまま (理由つき)。最終状態は成果報告を正とする。

(移植を進めるごとに更新する。)

## 4. 安全の対応表 (既存の防御 → C++)

| 既存の防御 (TS) | 内容 | C++ での置き場所 |
|---|---|---|
| `auth/cernere.ts` cernereAuth | Bearer の PASETO v4.public を現行鍵 + 旧鍵で検証、aud・exp・iat・nbf を検査、鍵が無ければ 503 (素通ししない)、dev 認証は loopback bind の時だけ | (移植時に記入) |
| `auth/cernere.ts` assertSafeAuthConfig | `TIROCINIUM_DEV_AUTH=1` は loopback 以外で起動拒否 | |
| `ws/handler.ts` | session WS は Bearer か `?token=` を `CERNERE_PUBLIC_KEY` で検証、所有者・active を検査、401/403/500 で切る | |
| `ws/call-handler.ts` | 1 回限り・30 秒の ticket を最初のフレームで受ける、認証 5 秒・初期化 30 秒、128 KiB 上限、未処理 16 件で切断、テキストのみ、1 セッション 1 接続、フレーム内容をログに出さない | |
| `ws/call-tickets.ts` | 32 byte 乱数 ticket、TTL 30 秒、最大 256 件、同じセッションの旧 ticket を無効化 | |
| `auth/cernere-composite-ws-relay.ts` | パス一致、ticket `^[A-Za-z0-9_-]{16,256}$`、未設定 503、上流接続後に upgrade、失敗 502、中身を読まない・残さない | |
| `middleware/rate-limit.ts` | セッション作成・call-ticket・資料提出をユーザ単位の固定窓で制限、429 + Retry-After | |
| `routes/sessions.ts` bodyLimit | 資料提出は 7 MiB で 413 `material_too_large` | |
| `materials/material-policy.ts` | 復号前の大きさ見積もり、base64 検査、MIME 許可表、復号後 5 MiB | |
| `materials/material-reader.ts` | 資料だけの一時フォルダ、固定ファイル名、Read だけ許可、120 秒、成否に関わらず削除、要点の形と 6000 字上限 | |
| `materials/material-store.ts` | メモリだけ、TTL 45 分、64 件、持ち主にだけ返す | |
| `submit-material.ts` | 1 セッション 1 資料、同時提出の排他 | |
| `es-review/*` | 接続コード (32 byte 乱数) は SHA-256 で保存・10 分・1 回限り、DM 限定、本文の検査 (1〜1400 字・URL/メンション/電話番号を拒否)、配送の冪等、本文をログに出さない、公開用の射影 | |
| `routes/es-requests.ts` | 社名 200 字以内かつ登録済み企業のみ | |
| `routes/companies.ts` canCrawl | クロール系は管理者 ID の許可リスト (空なら認証済み全員) | |
| `routes/backdoor.ts` | 入力の項目を許可リストで絞る、投稿者本人だけ更新・削除 | |
| `index.ts` | 既定 bind 127.0.0.1、CORS (`*`)、未知の経路 404、例外は 500 `{error:'internal'}` で詳細を返さない | |
| `discord/bridge.ts` | 許可チャンネル、bot 発言を無視、`allowed_mentions.parse=[]`、`resume_gateway_url` の検査、致命的な close code で再接続しない | |
| `@ludiars/one-shot` | API キー類の環境変数を子に渡さない、シェルを使わない、CLI ごとの出力上限・期限・ツール禁止 | |
| `secrets/*` | 秘密はメモリだけ、ログにはキー名だけ、secret-agent 不通時の退避の規則 | |
| `companies/ssrf-guard.ts` | 内部アドレスの拒否、リダイレクトを手動追従 (Node 版。C++ 版は解決した IP に接続を固定する) | |
