# 直接 API の通信を Portus に寄せる

`@tirocinium/llm` の Anthropic 直接 API は LUDIARS の Portus
(`lib/portus`、`@ludiars/portus`、実行時依存ゼロ) の `AnthropicClient` で通信する。

- `createAnthropicClient()` は `messages.create` / `messages.stream` を提供する。型は `anthropic-types.ts` に置く。
- 通信の既定は Portus に従う: 標準 fetch、リダイレクト禁止、1 回 120 秒の期限、エラー本文は 500 文字まで。
- 再試行は旧 SDK の既定と同じ条件で残す (`api-retry.ts`: 最大 2 回、408 / 409 / 429 / 5xx と接続失敗・タイムアウト、
  0.5 秒から倍々で上限 8 秒)。Portus のクライアントは再試行しない。
- stream (SSE) は Portus v0.1.0 に無いので `anthropic-stream.ts` に置く (同じ方針: 標準 fetch・リダイレクト禁止・
  期限 10 分・1 イベント 1 MiB まで)。Portus に stream が入ったら置き換える。
- REFINE は Codex の購読認証を使う [One-Shot 経路](model-profiles.md) で実行する。

## セットアップ

`lib/portus` は submodule (タグ `v0.1.0` に固定)。Portus は `dist/` を git に持たないので、npm install の後に build する。

```sh
git submodule update --init lib/lapilli lib/portus
npm install
npm run build:portus        # tsc -p lib/portus/tsconfig.json (dev:server / build:server は先にこれを呼ぶ)
```

Portus は Node 22.12 以上を求める。
