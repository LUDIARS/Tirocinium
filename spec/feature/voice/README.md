# voice モジュール

音声入出力。**Imperativus (Iv)** に STT/TTS を委譲し、Tirocinium 内では
VAD と stream の取り回しに徹する。

---

## 責務範囲

| Tirocinium が持つ | Iv に投げる |
|---|---|
| mic capture (Tauri / cpal) | STT (speech → text) |
| VAD (発話 / 無音判定) | TTS (text → speech, 面接官の声質) |
| 発話 → turn 確定の logic | language detection |
| バージイン検出 | (将来) 多言語切替 |
| speaker 再生 (rodio) | |

---

## VAD

- `webrtc-vad` (Rust) を `src-tauri` で動かす
- 16kHz mono PCM、20ms frame
- 「無音 600ms 連続 → 発話終了」を基本ヒューリスティック (調整可)
- 「音声 → 無音 → 音声」(0.3 秒以内) は同一発話に結合 (息継ぎ吸収)

---

## Iv 連携

Iv は STT/TTS の HTTP/WS 窓口を持つ前提 (本実装で確認)。

```ts
// pseudo
const iv = new IvVoiceClient({ url: env.IV_URL, token: cernereToken });

// STT (stream-in, stream-out)
for await (const evt of iv.stt(pcmStream)) {
  if (evt.partial) ws.send({ kind: 'stt_partial', text: evt.partial });
  if (evt.final)   ws.send({ kind: 'stt_final', text: evt.final, turn_no });
}

// TTS (text → pcm chunks)
for await (const chunk of iv.tts(responseText, { voice: 'interviewer-male-30s' })) {
  ws.send({ kind: 'tts_chunk', pcm: chunk });
}
```

---

## 応答 token と TTS の並走

Sonnet がトークンを吐く速度と TTS の合成速度は揃わない。

戦略:
- 句読点 (`。`, `、`, `?`, `!`, 改行) で切って **句単位で TTS 投入**
- 直前 TTS が再生中なら queue に積む
- バージインが来たら **Sonnet stream を abort + TTS queue を flush + 再生停止**

---

## ローカルモード

- Iv が利用不可なら **whisper.cpp** (STT) + **piper** (TTS) を embedded で使う
- 品質は劣るが反復練習目的には足る
- 切り替えは起動時の Iv ヘルスチェックで自動 + 設定 override
