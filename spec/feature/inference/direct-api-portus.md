# 直接 API の通信を Portus に寄せる

`@tirocinium/llm` の直接 API (鍵必須) の経路は、`@anthropic-ai/sdk` と `openai` を使わず、
LUDIARS の Portus (`lib/portus`、`@ludiars/portus`、実行時依存ゼロ) の `AnthropicClient` /
`OpenAIClient` で通信する。目的は依存の削減 (2 つの SDK とその推移的依存 `node-fetch`・`form-data` などで 39 パッケージずつ)。

- 呼び出し側の形は変えない。`createAnthropicClient()` は `messages.create` / `messages.stream` を、
  `createOpenAIClient()` は `chat.completions.create` を持つ。型は `anthropic-types.ts` と `openai.ts` に、
  使っている範囲だけを置く。
- 通信の既定は Portus に従う: 標準 fetch、リダイレクト禁止、1 回 120 秒の期限、エラー本文は 500 文字まで。
- 再試行は旧 SDK の既定と同じ条件で残す (`api-retry.ts`: 最大 2 回、408 / 409 / 429 / 5xx と接続失敗・タイムアウト、
  0.5 秒から倍々で上限 8 秒)。Portus のクライアントは再試行しない。
- stream (SSE) は Portus v0.1.0 に無いので `anthropic-stream.ts` に置く (同じ方針: 標準 fetch・リダイレクト禁止・
  期限 10 分・1 イベント 1 MiB まで)。Portus に stream が入ったら置き換える。
- subscription CLI (`@ludiars/one-shot`) とローカル Ollama の経路は変えない。

## セットアップ

`lib/portus` は submodule (タグ `v0.1.0` に固定)。Portus は `dist/` を git に持たないので、npm install の後に build する。

```sh
git submodule update --init lib/lapilli lib/portus
npm install
npm run build:portus        # tsc -p lib/portus/tsconfig.json (dev:server / build:server は先にこれを呼ぶ)
```

Portus は Node 22.12 以上を求める。
