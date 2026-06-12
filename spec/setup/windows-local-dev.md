# Windows Local 開発プロファイル — 1 台で面接を一周させる

Cernere・複合 LLM サーバ・Imperativus 等の外部サービス**無し**で、
Windows 1 台に Tirocinium を立ち上げ、テキスト入力で面接練習を一周させるための設定。

> これは **dev プロファイル**であって DESIGN §2.1 の「ローカルモード」(SQLite + ollama +
> ローカル STT/TTS のオフライン完結) ではない。

---

## 設定方式

全 config は **Excubitor secret-agent** (port 17332) に登録する。
`.env` / `.env.local` ファイルは使用しない (secrets/hydrate.ts 参照)。

起動前に Excubitor が動いていること (port 17332 で応答すること) が前提。

### secret-agent に登録する値 (service code: `tirocinium`)

| キー | 値 (dev) | 説明 |
|---|---|---|
| `TIROCINIUM_PORT` | `8084` | サーバーポート |
| `TIROCINIUM_HOST` | `127.0.0.1` | バインドアドレス |
| `DATABASE_URL` | `sqlite:../../data/tirocinium.sqlite` | SQLite ファイルパス (空でも既定パスを使う) |
| `TIROCINIUM_DEV_AUTH` | `1` | Cernere を素通しして固定 dev ユーザにする |
| `TIROCINIUM_DEV_USER_ID` | `00000000-0000-0000-0000-000000000001` | dev session の user_id |
| `TIROCINIUM_LLM_BACKEND` | `cli` | `cli`=claude CLI / `api`=Anthropic SDK |
| `CLAUDE_CODE_GIT_BASH_PATH` | `C:\...\bash.exe` | Windows で claude CLI を spawn する際に必須 |

> 登録は Excubitor の管理 UI または Concordia の secret-agent 設定ページから行う。

---

## 何が動く / 動かない

| 機能 | dev プロファイル | 理由 |
|---|---|---|
| 面接官応答 (Sonnet) | ✅ テキストで一周 | claude CLI 経由 (鍵不要) |
| Opus 評価 / GPT 補正 | ⚠️ `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` を agent に登録した時だけ | dev は既定で skip |
| 音声 STT/TTS | ❌ | `iv-client` が未結線 (stub)。入力はテキスト欄 |
| RAG (Memoria) | ❌ (任意) | `MEMORIA_URL` 未登録なら skip |
| 予約通知 (Nuntius) | ❌ (任意) | stub |

---

## 前提

- Node.js >= 22
- `claude` CLI がインストール済み + ログイン済み (`TIROCINIUM_LLM_BACKEND=cli` の場合)
  - Windows では `CLAUDE_CODE_GIT_BASH_PATH` が必要。secret-agent に登録すること。
- **Excubitor が起動済み** (port 17332) かつ `tirocinium` サービスの config が登録済み

---

## 手順

### 1. 依存インストール

```powershell
npm install
```

### 2. マイグレーション

```powershell
npm run migrate          # スキーマ作成 (001 + 002)
npm run seed-personas    # 面接官/受験者ペルソナを DB へ投入
```

> `npm run migrate` は Excubitor から `DATABASE_URL` を取得して実行する。
> 未設定の場合は `data/tirocinium.sqlite` (SQLite 既定パス) を使用する。

### 3. server 起動

```powershell
npm run dev:server       # http://localhost:8084
```

起動時に `[secrets] hydrated from agent: N key(s)` が表示されれば OK。
`GET http://localhost:8084/health` が 200 を返せば完了。

### 4. desktop (Web/Tauri) 起動

```powershell
npm run dev:desktop      # http://localhost:5178
```

ブラウザで `http://localhost:5178` を開く。
ログイン画面の **「Dev ログイン (Cernere バイパス)」** を押す
(`VITE_DEV_AUTH=1` のとき表示。server 側の `TIROCINIUM_DEV_AUTH=1` と対)。

### 5. 面接を一周

1. セッション開始ページで面接官ペルソナ・志望企業/職種を選ぶ
2. ライブ画面で「テキスト入力」ボタンを押してテキスト欄を開き、発言を打って「送信」
3. 「終了 → サマリ」で締める (Opus サマリは `ANTHROPIC_API_KEY` 登録時のみ生成)

---

## トラブルシュート

| 症状 | 対処 |
|---|---|
| `SecretAgentError: unreachable` | Excubitor が起動していない。`http://localhost:17332` を確認 |
| `SecretAgentError: no_token` | `%APPDATA%/Excubitor/secret-agent.token` が存在しない。Excubitor で生成する |
| `SecretAgentError: no_mapping` | secret-agent に `tirocinium` サービスが未登録 |
| `DB not initialized` | `initSql()` が呼ばれていない (起動フロー不整合) |
| WS が 401 で切れる | server の `TIROCINIUM_DEV_AUTH=1` が agent に登録されているか確認 |
| `claude CLI exited with 1` | `CLAUDE_CODE_GIT_BASH_PATH` 未登録 / claude 未ログイン |
| 面接官が無言で終わる | cli バックエンドで claude 応答が空。stderr を確認、`api` バックエンドに切替 |

---

## API キーを使うフル評価モード

secret-agent の `tirocinium` サービスに追加登録:

```
TIROCINIUM_LLM_BACKEND = api
ANTHROPIC_API_KEY      = sk-ant-...
OPENAI_API_KEY         = sk-...        # GPT 補正も使う場合
```

これで Sonnet ストリーム応答 + Opus 評価 (5 turn) + GPT 補正 (10 turn) + サマリが全て有効になる。
