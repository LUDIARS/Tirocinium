# Cernere 埋め込みログイン (Tirocinium Web)

指示: neco「正式なログインまで実装」(2026-10-09)。旧画面 (#21) は Cernere の PASETO token を手で貼る仮実装だった。

## 流れ

1. 画面 `apps/desktop/src/auth/LoginGate.tsx` が `@ludiars/cernere-composite/ui` の `<CompositeLogin>` を出す。
   authApi は Tirocinium サーバの `/api/auth/cernere/{login,register,mfa-verify}` を呼ぶ (ブラウザから Cernere を直接呼ばない。CORS 回避、Actio と同じ形)。
2. サーバは project credential で Cernere の `/ws/project` に接続し、`auth.login` 等を代理する (`apps/server/src/auth/cernere-project-client.ts`)。
   応答は次のいずれか。画面の authApi (`apps/desktop/src/auth/session-api.ts` の `TrCompositeAuthApi`) がどれも扱う。
   - `authCode`: そのまま 3 へ。
   - `mfaRequired` + `mfaToken`: SDK の MFA 画面 → `/api/auth/cernere/mfa-verify`。
   - `ticket` + `wsPath` (パスワードは通り、端末の本人確認が残っている。通常のログインはこれ):
     画面が `/api/auth/cernere/ws?ticket=` に WebSocket を張り、サーバがそれを Cernere の `/auth/composite-ws?ticket=` へ素通しする
     (`apps/server/src/auth/cernere-composite-ws-relay.ts`。ブラウザは Cernere の内部 URL に届かないため)。
     画面は端末 fingerprint を送り、Cernere が確認コードを求めれば SDK の確認コード画面を出す。完了すると WS で authCode が届く。
   どれにも当たらない応答はエラーとして画面に出す (SDK 0.3 はこの場合に黙って何もしなかった。2026-10-10「ログイン押しても反応ない」)。
3. 画面は authCode を `POST /api/auth/exchange` へ送る。サーバは Cernere `/api/auth/exchange` でユーザーの accessToken / refreshToken を得て、
   `POST /api/auth/project-token` (`project_key=tirocinium`、`hub_url=CERNERE_AUDIENCE`) で Tirocinium 向けの user×project token (PASETO V4、15 分) を取り、
   `{token, expiresIn, refreshToken, user}` を返す (`apps/server/src/auth/cernere-session.ts`)。
4. 画面は token と refreshToken をこのブラウザの localStorage に置く。API が 401 を返したら `POST /api/auth/refresh` で 1 回だけ取り直して再試行し、失敗ならログイン画面へ戻す。
5. 認証ミドルウェア (`auth/cernere.ts`) は token を Cernere の公開鍵で検証する。鍵は `CERNERE_PUBLIC_KEY` があればそれ、無ければ起動時に
   `{CERNERE_URL}/.well-known/cernere-public-key` (現行 + 旧鍵) を取得する。鍵が無ければ 503 (黙って素通しにしない)。

Tirocinium のサーバはトークンを保存しない (個人データ・認証トークンは Cernere の責務)。トークンとパスワードはログに出さない。
開発用の `TIROCINIUM_DEV_AUTH` / `VITE_DEV_AUTH` は従来どおり。

## 設定

| 値 | 出どころ |
|---|---|
| `CERNERE_URL` | Excubitor の topology (`<CODE>_URL`) |
| `CERNERE_PROJECT_CLIENT_ID` / `CERNERE_PROJECT_CLIENT_SECRET` | catalog の `cernere_launch_credentials.target_project: tirocinium` で Excubitor が起動ごとに発行・注入 |
| `CERNERE_AUDIENCE` | 既定 `tirocinium` (project-token の aud と一致させる) |
| `CERNERE_PUBLIC_KEY` | 任意。無ければ well-known から取得 |

Cernere 側の前提: `managed_projects` に `tirocinium`、`project_credential_issuers` に (tirocinium, excubitor) (Cernere migration 062、PR #2619)。
migration は Cernere の再起動で適用される。
