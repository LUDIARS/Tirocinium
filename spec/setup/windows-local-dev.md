# Windows Local 開発プロファイル — 1 台で面接を一周させる

Cernere・複合 LLM サーバ・Imperativus 等の外部サービス**無し**で、
Windows 1 台に Tirocinium を立ち上げ、テキスト入力で面接練習を一周させるための設定。

> これは **dev プロファイル**であって DESIGN §2.1 の「ローカルモード」(SQLite + ollama +
> ローカル STT/TTS のオフライン完結) ではない。DB は Postgres、LLM は claude CLI 経由。
> オフライン完結の真ローカルモードは別タスク (June 目標では後回し)。

---

## 何が動く / 動かない

| 機能 | dev プロファイル | 理由 |
|---|---|---|
| 面接官応答 (Sonnet) | ✅ テキストで一周 | claude CLI 経由 (鍵不要) |
| Opus 評価 / GPT 補正 | ⚠️ `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` を入れた時だけ | dev は既定で skip |
| 音声 STT/TTS | ❌ | `iv-client` が未結線 (stub)。入力はテキスト欄 |
| RAG (Memoria) | ❌ (任意) | `MEMORIA_URL` 未設定なら skip |
| 予約通知 (Nuntius) | ❌ (任意) | stub |

---

## 前提

- Node.js >= 22
- Docker Desktop **または** ローカル Postgres 16
- `claude` CLI がインストール済み + ログイン済み (`TIROCINIUM_LLM_BACKEND=cli` の場合)
  - Windows では `CLAUDE_CODE_GIT_BASH_PATH` が必要 (例: `C:\Program Files\Git\bin\bash.exe`)。
    server プロセスの環境変数に入れておく。

---

## 手順

### 1. 依存インストール

```powershell
npm install
```

### 2. Postgres を起動 (host port 15432)

```powershell
npm run db:up      # docker compose up -d db
```

> Windows の Docker は 5432 を host から取り回せない事例があるため 15432 に退避している。
> ローカル Postgres を使う場合は 5432 でよい (下の `DATABASE_URL` を合わせる)。

### 3. server の env を用意

```powershell
Copy-Item apps/server/.env.local.example apps/server/.env.local
```

`.env.local` の主なキー (実装根拠付き):

| キー | 既定 | 根拠 |
|---|---|---|
| `TIROCINIUM_DEV_AUTH` | `1` | `config.devAuth`。Cernere を素通しして固定 dev ユーザにする |
| `TIROCINIUM_DEV_USER_ID` | `00000000-...-0001` | `config.devUserId`。session の user_id になる |
| `TIROCINIUM_LLM_BACKEND` | `cli` | `config.llmBackend`。`cli`=claude CLI / `api`=Anthropic SDK |
| `DATABASE_URL` | `...localhost:15432/tirocinium` | `config.databaseUrl` (必須) |
| `CLAUDE_CODE_GIT_BASH_PATH` | (要設定) | Windows で claude CLI を spawn する際に必須 |

### 4. マイグレーション + ペルソナ seed

```powershell
npm run migrate          # スキーマ作成 (001 + 002)
npm run seed-personas    # 面接官/受験者ペルソナを DB へ投入
```

### 5. server 起動

```powershell
npm run dev:server       # http://localhost:8084
```

`GET http://localhost:8084/health` が 200 を返せば OK。

### 6. desktop (Web/Tauri) 起動

```powershell
Copy-Item apps/desktop/.env.local.example apps/desktop/.env.local
npm run dev:desktop      # http://localhost:5178
```

ブラウザで `http://localhost:5178` を開く。
ログイン画面の **「Dev ログイン (Cernere バイパス)」** を押す
(`VITE_DEV_AUTH=1` のとき表示。server 側の `TIROCINIUM_DEV_AUTH=1` と対)。

### 7. 面接を一周

1. セッション開始ページで面接官ペルソナ・志望企業/職種を選ぶ
2. ライブ画面で発言テキストを打って「送信」→ 面接官 (Sonnet) が応答
3. 「終了 → サマリ」で締める (Opus サマリは `ANTHROPIC_API_KEY` がある時のみ生成)

---

## トラブルシュート

| 症状 | 対処 |
|---|---|
| `Missing required env: DATABASE_URL` | `.env.local` が `apps/server/` 直下にあるか。`npm run dev:server` は cwd=apps/server で動く |
| WS が 401 で切れる | server の `TIROCINIUM_DEV_AUTH=1` が効いていない (再起動して確認) |
| `claude CLI exited with 1` | `CLAUDE_CODE_GIT_BASH_PATH` 未設定 / claude 未ログイン。`api` バックエンド + `ANTHROPIC_API_KEY` でも代替可 |
| 5432 が host から見えない | `npm run db:up` の 15432 を使う。`DATABASE_URL` の port を 15432 に |
| 面接官が無言で終わる | cli バックエンドで claude 応答が空。stderr を確認、`api` バックエンドに切替 |

---

## API キーを使うフル評価モード

`.env.local` で:

```
TIROCINIUM_LLM_BACKEND=api
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...        # GPT-5.5 補正も使う場合
```

これで Sonnet ストリーム応答 + Opus 評価 (5 turn) + GPT 補正 (10 turn) + サマリが全て有効になる。
