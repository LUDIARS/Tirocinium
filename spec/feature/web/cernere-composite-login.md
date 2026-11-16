# Cernere 埋め込みログイン (Tirocinium Web)

指示: neco「正式なログインまで実装」(2026-10-09)。旧画面 (#21) は Cernere の PASETO token を手で貼る仮実装だった。
2026-11-14 改訂: Cernere の交換契約の変更 (Cernere `spec/plan/2026-10-30-authcode-service-binding.md`、main 455c7bc 以降) に合わせ、
PKCE + project credential での交換と自前セッションへ切り替えた。互換経路 (旧 `{code}` だけの交換・project-token・refresh・パスワード) は残さない。

## 流れ

1. 画面 `apps/desktop/src/auth/LoginGate.tsx` が試行ごとに PKCE (S256) の `code_verifier` / `code_challenge` と `state` を作る
   (`apps/desktop/src/auth/pkce.ts`。verifier はメモリにだけ置く)。`@ludiars/cernere-composite/ui` (0.6.0) の `<CompositeLogin>` を出す。
   ログインは**パスキーのみ** (Cernere がメール+パスワードのログイン・登録を廃止した)。
2. authApi (`session-api.ts` の `TrCompositeAuthApi`) は begin/finish を Tirocinium サーバへ送る。ブラウザから Cernere を直接呼ばない。
   - `POST /api/auth/cernere/passkey-login-begin { code_challenge, state }`
   - `POST /api/auth/cernere/passkey-login-finish { challengeOwner, response, code_challenge, state }`
   サーバ (`native/src/app/auth_routes.cpp`) は `client_id` (project credential の client id) と `target` (`TIROCINIUM_PUBLIC_ORIGIN`) を
   **設定から**足し、project WS (`/ws/project`) の `auth.passkey-login-begin` / `finish` へ中継する。送り先をブラウザから受け取らない。
   Cernere は authCode を `{ project, origin, code_challenge }` に束縛して発行する (60 秒・1 回きり)。
3. 画面は authCode と verifier を `POST /api/auth/exchange { code, code_verifier }` へ送る (余分な項目は 400)。
   サーバ (`native/src/app/cernere_exchange.cpp`) は project credential で Cernere にログインして project token を得て、
   `POST {CERNERE_URL}/api/auth/exchange { code, code_verifier }` を `Authorization: Bearer <project token>` で呼ぶ。
   応答 `{ user, projectToken }` の projectToken を Cernere の公開鍵で検証し (aud = `CERNERE_AUDIENCE` = 登録した hub_url、sub = user.id)、
   通れば自前セッション (`native/src/app/service_session.cpp`) を発行して `{ sessionToken, expiresAt, user }` を返す。
   Cernere の user token / refresh token は受け取らず、保存もしない。
4. 画面は sessionToken を localStorage に置き、API に Bearer で付ける。セッションは 12 時間の固定期限で延長しない。
   API が 401 を返したらログイン画面へ戻り、パスキーでログインし直す。`POST /api/auth/logout` はサーバ側のセッションも消す。
5. 認証ミドルウェア (`native/src/app/auth.cpp`) は、自前セッションの形 (43 文字の base64url) の token を DB で引く。
   それ以外は従来どおり Cernere の PASETO として検証する (GLAB などからの下流呼び出し、aud = `CERNERE_AUDIENCE`)。

ログイン口 (begin / finish / exchange / logout) はブラウザの `Origin` が `TIROCINIUM_PUBLIC_ORIGIN` と一致するときだけ受ける。
セッションの DB (`tirocinium_service_sessions`、migration 028) は token の SHA-256 だけを持ち、token 本体は持たない。
トークンはログに出さない。開発用の `TIROCINIUM_DEV_AUTH` / `VITE_DEV_AUTH` は従来どおり。

## 設定

| 値 | 出どころ |
|---|---|
| `CERNERE_URL` | Excubitor の topology (`<CODE>_URL`) |
| `CERNERE_PROJECT_CLIENT_ID` / `CERNERE_PROJECT_CLIENT_SECRET` | catalog の `cernere_launch_credentials.target_project: tirocinium` で Excubitor が起動ごとに発行・注入 |
| `TIROCINIUM_PUBLIC_ORIGIN` | 画面を配る公開オリジン (https、ループバック不可、末尾 `/` 無し)。未設定・不正ならログイン口は 503 |
| `CERNERE_AUDIENCE` | Cernere に登録した tirocinium の `hub_url` と同じ値 (projectToken の aud) |
| `CERNERE_PUBLIC_KEY` | 任意。無ければ well-known から取得 |

Cernere 側の前提 (管理者が登録する。Tirocinium からは触らない):
- `managed_projects` に `tirocinium`、`project_credential_issuers` に (tirocinium, excubitor) (Cernere migration 062)。
- project `tirocinium` の `schema_definition.composite_origins` に `TIROCINIUM_PUBLIC_ORIGIN` と同じオリジン、
  `schema_definition.hub_url` に `CERNERE_AUDIENCE` と同じ値。どちらも https かつループバック以外しか登録できない。

## 使えない形

- Tauri の webview (`tauri://localhost` / `http://tauri.localhost`) と `http://localhost:5178` の Vite 直アクセスは、
  Cernere の composite_origins に登録できないためログインできない。Tunnel 等で https 公開したオリジンから開く。
  回避策 (登録できないオリジンの代用・送り先の差し替え) は作らない。
