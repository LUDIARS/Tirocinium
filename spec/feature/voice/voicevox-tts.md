# VOICEVOX TTS — 面接官発話の音声化

面接官の発話テキストを VOICEVOX engine で合成し、WS (desktop) と Discord VC に
PCM で流すための設計。[`README.md`](./README.md) (音声全体) の TTS 節を具体化する。

## 1. 目的と位置付け

- 現状 `ImperativusClient.tts()` は stub で、面接は無音 (テキストのみ)。
- 音声経路の方針 (CLAUDE.md) は「Imperativus (Iv) へ委譲」。ただし Iv の TTS 経路は
  未確定のため、**STT と同じ provider 注入パターン** (`stt-provider.ts` と対称) で
  TTS も差し替え可能にし、最初のバックエンドとして VOICEVOX を結線する。
  - VOICEVOX は外部エンジン (HTTP、既定 `http://127.0.0.1:50021`) であり、
    Tr 内への音声合成の再実装ではない。
  - Iv の経路が固まったら backend `iv` を追加して切り替える (interface は不変)。

## 2. 構成

```
session-runtime ── response_end 後 ──► ivClient.tts(TtsRequest)
                                          │ ttsProvider 委譲
                                          ▼
                              VoicevoxTtsProvider
                                POST /audio_query?text&speaker
                                POST /synthesis?speaker  → WAV
                                WAV data チャンク → PCM s16le chunk yield
        ┌─────────────────────────┴──────────────────────┐
        ▼ WS: tts_chunk / tts_end frame                  ▼ Discord: playTts
   desktop speaker-playback (WebAudio)             48kHz stereo StreamType.Raw
```

## 3. 選択と設定 (無言フォールバック禁止)

| env | 値 | 意味 |
|---|---|---|
| `TIROCINIUM_TTS_BACKEND` | `voicevox` / `off` (既定 `off`) | 不正値は起動時 throw |
| `TIROCINIUM_VOICEVOX_URL` | 既定 `http://127.0.0.1:50021` | engine の base URL |
| `TIROCINIUM_VOICEVOX_SPEAKER` | 既定 `13` | 既定話者 id。`TtsRequest.voice` が数値文字列なら上書き |

- backend=voicevox で engine に到達できない場合、合成時に **明示エラーを WS の
  system frame + ログへ出す** (無音のまま成功を装わない)。面接自体 (テキスト) は続行する
  (音声は付加経路であり、面接進行を止めない)。

## 4. フォーマット

- VOICEVOX には `audio_query` 結果 JSON の `outputSamplingRate` / `outputStereo` を
  `TtsRequest.format` から上書きして要求する。
- WS (desktop) 向け既定: 24kHz mono s16le (VOICEVOX ネイティブ、リサンプル不要)。
  `tts_chunk` frame に `sample_rate` / `channels` を持たせ、再生側が追従する。
- Discord 向け: `playTts` が 48kHz stereo s16le を format で要求 (StreamType.Raw と一致)。
- `/synthesis` の応答 WAV は RIFF チャンクを解析して `data` 部のみを PCM として yield
  (44 byte 固定オフセット決め打ちにしない)。

## 5. 発話の分割と barge-in

- 合成単位は面接官発話 1 turn の全文を句点 (。！？改行) で文単位に分割し、
  文ごとに audio_query→synthesis→送出。先頭文の口出しまでのレイテンシを詰める
  (DESIGN §4 の「句読点区切りで TTS 投入」)。
- barge-in (`barge_in` frame) で合成ループの AbortSignal を発火し、未送出分を破棄。
  クライアント側は `tts_end` を待たず再生キューを破棄する。

## 6. WS フレーム追加

```ts
| { kind: 'tts_chunk'; turn_no: number; pcm: number[]; sample_rate: number; channels: number }
| { kind: 'tts_end'; turn_no: number }
```

- `audio_chunk` (client→server) と対称の素朴な number[] 表現。効率化 (binary frame)
  は測定してから (premature optimization を避ける)。

## 7. 非目標

- Iv 本体への TTS 実装 (Iv リポの作業)。
- 話者スタイル・感情パラメータの調整 UI (話者 id 固定で開始)。
- ローカルモードの piper 結線 (別 backend として将来追加可能な構造のみ担保)。
