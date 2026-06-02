# 音声入力 (STT) を Windows Local で動かす

Tr の音声認識は **STT provider 抽象** (`@tirocinium/voice` の `SttProvider`) 越しに行う。
実装は env で差し替える:

| `TIROCINIUM_STT_BACKEND` | 実装 | 用途 |
|---|---|---|
| `grpc` (既定: `TIROCINIUM_STT_GRPC` があれば) | Imperativus `stt-service` の gRPC へ直結 | ローカル完結 (faster-whisper 等) |
| `api` | クラウド transcription API | 将来 (現状 seam のみ、未実装) |
| `off` (既定) | 無効 | テキスト入力のみ |

dev プロファイルでは Iv の WebRTC 層はバイパスし、**stt-service の gRPC に直接**つなぐ。

---

## gRPC バックエンド (faster-whisper) の起動

stt-service は `LUDIARS/Imperativus/stt-service/` にある Python gRPC サービス。
**Iv 本体 (Node) は起動不要** — この Python サービスだけ立てればよい。

### 1. Python 依存

```powershell
cd E:\Document\Ars\Imperativus\stt-service
python -m venv venv ; .\venv\Scripts\Activate.ps1
pip install grpcio grpcio-tools numpy faster-whisper
```

### 2. proto generated code を生成

```powershell
python -m grpc_tools.protoc -I proto --python_out=proto --grpc_python_out=proto proto/stt.proto
```

### 3. サービス起動 (faster-whisper / 日本語)

```powershell
python server.py --backend faster-whisper --model base --language ja --port 50051
```

- `--model`: `base` / `small` / `medium` / `large-v3` (GPU があれば large-v3)。
- 初回は model を自動 DL。`--device cuda` で GPU。
- 起動すると `STT gRPC server listening on [::]:50051 (backend=faster-whisper)`。

### 4. Tr server 側 env

`apps/server/.env.local` に:

```
TIROCINIUM_STT_BACKEND=grpc
TIROCINIUM_STT_GRPC=localhost:50051
```

これで session の音声 (`audio_chunk` フレーム) が stt-service に流れ、
~2 秒チャンクごとに認識テキストが `stt_final` として面接 turn になる。

---

## 制限 / 次スライス

- **マイク取得は未実装** (スライス 2)。現状 `audio_chunk` を送るクライアントが無いため、
  この経路は「サーバ側 STT 配線」までが対象。UI からの実音声入力は desktop の
  `getUserMedia` → PCM16k → `audio_chunk` 実装後に通る。
- stt-service は partial を返さず常に final (発話途中の逐次表示は無し)。
- バージインは Tr 側 VAD (`SimpleEnergyVad`) で検出する設計 (STT レイテンシ非依存)。

---

## API バックエンド (将来)

`stt-api-provider.ts` が seam。クラウドの transcription API は発話 1 区切り = 1 リクエストの
バッチ呼び出しのため、クライアント側で VAD 区切り → WAV 化 → POST の実装が必要
(スライス 2 以降)。env は `TIROCINIUM_STT_BACKEND=api` + `TIROCINIUM_STT_API_KEY`
(or `OPENAI_API_KEY`) + `TIROCINIUM_STT_API_MODEL`。
