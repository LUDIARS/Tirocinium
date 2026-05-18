# code — ディレクトリ構成 + クラス役割

monorepo 構成。npm workspaces を想定 (Memoria / Ludellus 等と合わせる)。

```
tirocinium/
├── apps/
│   ├── desktop/          # Tauri 2 client (Rust + React)
│   │   ├── src-tauri/    # Rust 側 (音声 IO bridge, ローカル DB)
│   │   └── src/          # React UI (Foundation UI)
│   └── server/           # Hono + WS server
│       ├── src/
│       │   ├── routes/       # /api/v1/* ハンドラ
│       │   ├── ws/           # session live WS
│       │   ├── llm/          # LLM proxy + orchestrator
│       │   ├── reservation/  # 予約 slot 管理
│       │   ├── auth/         # Cernere verify
│       │   └── db/           # postgres client + migration runner
│       └── migrations/   # *.sql (immutable, 後置追加のみ)
├── packages/
│   ├── voice/            # Iv 連携 + VAD (client/server 両用)
│   ├── llm/              # 複合 LLM orchestrator (server 専用)
│   ├── training/         # 教師データの embedding + RAG
│   ├── reservation/      # slot 計算 (server 専用)
│   └── shared/           # 型 + WS frame schema
└── spec/                 # AIFormat 構造化仕様
```

---

## apps/server — 主要クラス

### LLMOrchestrator (`packages/llm/src/orchestrator.ts`)

複合 LLM の中核。

```ts
class LLMOrchestrator {
  constructor(opts: {
    response: AnthropicClient,      // Sonnet
    deep: OpenAIClient,             // GPT-5.5
    eval:   AnthropicClient,        // Opus
    rag:    RAGProvider,
  });

  // Sonnet token stream を返す
  streamResponse(turn: UserTurn, ctx: SessionContext): AsyncIterable<string>;

  // 5-10 turn ごとに GPT-5.5 で system prompt を補正
  refineSystemPrompt(history: Turn[]): Promise<string>;

  // 5-7 turn ごとに Opus で評価
  evaluate(history: Turn[]): Promise<Evaluation>;
}
```

### SessionRuntime (`apps/server/src/ws/session-runtime.ts`)

1 セッション = 1 インスタンス。WS フレームを LLMOrchestrator に流し込む。

```ts
class SessionRuntime {
  onAudioChunk(pcm, seq): void;        // STT (Iv) に転送
  onSttFinal(text): void;              // turn 確定 → LLM へ
  onBargeIn(): void;                   // ストリーム中断
  end(): Promise<void>;
}
```

### ReservationCoordinator (`packages/reservation/src/coordinator.ts`)

```ts
class ReservationCoordinator {
  // 即時 or 予約 offer
  async tryStart(userId: string): Promise<
    | { kind: 'start', session_id: string }
    | { kind: 'offer', slot_start: Date, ... }
    | { kind: 'denied', reason: 'saturated' | 'auth' }>;

  async reserve(userId: string, slotStart: Date): Promise<Reservation>;
  async cancel(reservationId: string, userId: string): Promise<void>;

  // tick (毎分実行) — slot 開始時に WS push & Nuntius 通知
  async tickNow(): Promise<void>;
}
```

### CernereAuth (`apps/server/src/auth/cernere.ts`)

PASETO V4 verify (memory ルール参照: paseto-ed25519-keyobject, paseto-iso-timestamps)。

---

## apps/desktop — 主要モジュール

### VoiceBridge (`apps/desktop/src-tauri/src/voice.rs`)

mic capture (cpal) + VAD (webrtc-vad) + speaker playback (rodio)。
WS で `audio_chunk` を送り、`tts_chunk` を受信再生。

### LocalLlmAdapter (`apps/desktop/src-tauri/src/local_llm.rs`)

ローカルモード時に ollama HTTP を叩く。サーバーと同じ Turn → Response interface。

### LocalDb (`apps/desktop/src-tauri/src/db.rs`)

`tauri-plugin-sql` (SQLite)。サーバ DB の subset を持つ。
migration は `migrations/00X_*.sql` の immutable 追記のみ
(memory: `tauri-plugin-sql は migration の SQL 改変で panic`)。

---

## packages/voice — 共有

```ts
// VAD wrapper
class VAD { feed(pcm): 'speech'|'silence' }

// STT/TTS client (Imperativus 経由)
class IvVoiceClient {
  stt(stream): AsyncIterable<{partial: string, final?: string}>;
  tts(text): AsyncIterable<Uint8Array /* pcm */>;
}
```

---

## デプロイ + Port

| component | 配置 | Host port |
|---|---|---|
| `apps/server` | LUDIARS サーバ | **8084** (Cernere 8080 / Actio 8888 系の隣) |
| `apps/desktop` Vite dev | エンドユーザ PC | **5178** (frontend dev) |
| Postgres | infra (Mm/Cr と共有) — schema 名 `tirocinium` | 5432 (共有) |
| Redis | (任意) slot lock + WS pubsub に使う検討 | 6379 (共有) |

> infra/PORT-MAP.md の正本反映は別 PR で行う (別作業並行中のため保留)。
> 環境変数: `TIROCINIUM_PORT=8084`, `TIROCINIUM_VITE_PORT=5178`。

---

## ローカル開発

- `npm run dev` で `apps/server` (tsx watch) + `apps/desktop` (`tauri dev`) 並列起動。
- ローカルモードのみで進める場合 server 不要、desktop だけで完結。
