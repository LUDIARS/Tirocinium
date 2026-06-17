# 不足機能 — Tirocinium (2026-05-23)

## 1. Imperativus 音声パイプ (優先度: High)

現状: packages/voice/src/iv-client.ts に stt() / tts() generator 定義済、空実装。

DESIGN § 4 要件:
- VAD で 発話→無音 検出 → turn 確定
- バージイン (ユーザ割込) で Sonnet stream 中断
- 全 turn を session_turns に append-only ログ

実装待ち:
- Iv WS /v1/stt に PCM 16kHz 送信、partial/final SttEvent 受信
- Iv /v1/tts に TtsRequest 送信、PCM stream で音声合成
- session-runtime L33-34 audioQueue を Iv TTS 結果に bind
- VAD trigger (packages/voice/src/vad.ts は基盤完成) で turn 境界判定

ブロッカー: Iv API 仕様書未確定 (Imperativus リポ確認待ち)。推定工数: 2-3 days。

## 2. ローカルモード実装 (優先度: Medium)

DESIGN § 2.1 策定済、コード未着手。必要: ollama/Llama/Qwen 軽量モデル選定 + local Whisper + piper TTS。session-runtime が llmEnabled フラグで分岐 (process.env.ANTHROPIC_API_KEY) だが、ローカルモデル呼び出し未実装。推定工数: 3-4 days。

## 3. 多言語対応 (優先度: Low)

DESIGN § 8 で「英語面接練習」言及 (未確定)。現状全プロンプト日本語固定、i18n framework (next-i18n / i18next) 未導入。
