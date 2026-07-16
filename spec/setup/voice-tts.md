# TTS (VOICEVOX) セットアップ

面接官発話の音声化。設計の正本は
[`spec/feature/voice/voicevox-tts.md`](../feature/voice/voicevox-tts.md)。

## env

| env | 値 | 意味 |
|---|---|---|
| `TIROCINIUM_TTS_BACKEND` | `voicevox` / `off` (既定 `off`) | TTS バックエンド。不正値は起動時 throw |
| `TIROCINIUM_VOICEVOX_URL` | 既定 `http://127.0.0.1:50021` | VOICEVOX engine の base URL |
| `TIROCINIUM_VOICEVOX_SPEAKER` | 既定 `13` | 既定話者 id (`GET /speakers` で一覧) |

## VOICEVOX engine の起動

Docker (moby):

```bash
docker run -d --name voicevox-engine --restart unless-stopped \
  -p 50021:50021 voicevox/voicevox_engine:cpu-latest
# 確認
curl http://127.0.0.1:50021/version
```

Windows ではデスクトップ版 VOICEVOX を起動しても同じ API (50021) が立つ。

## 動作確認

```bash
TIROCINIUM_TTS_BACKEND=voicevox npm run dev:server
# 面接セッション中、response_end 後に WS へ tts_chunk (24kHz mono s16le) が流れる。
# Discord voice mode では playTts が 48kHz stereo で VC 再生する。
```

engine 不達時は WS の system frame (`tts failed: ...`) とサーバログに明示される
(面接のテキスト進行は止まらない)。
