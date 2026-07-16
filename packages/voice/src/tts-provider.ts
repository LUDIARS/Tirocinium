// TTS 処理の抽象。テキストを受け取り PCM (16-bit LE) chunk を逐次返す。
// stt-provider.ts と対称の provider 注入パターン (spec/feature/voice/voicevox-tts.md)。
// 実装は差し替え可能:
//   - voicevox : ローカル VOICEVOX engine (HTTP)  → tts-voicevox-provider.ts
//   - (将来) iv: Imperativus の TTS 経路が固まったら追加する
// session-runtime / iv-client はこの interface にのみ依存する。

import type { TtsRequest } from './types.js';
import { createVoicevoxTtsProvider } from './tts-voicevox-provider.js';

export interface TtsProvider {
  /** テキストを合成し PCM (16-bit LE) chunk を逐次 yield する。 */
  tts(req: TtsRequest, signal?: AbortSignal): AsyncGenerator<Uint8Array, void, unknown>;
}

export type TtsBackend = 'voicevox' | 'off';

/**
 * TIROCINIUM_TTS_BACKEND で実装を選ぶ。既定 'off' (TTS 無効 → null)。
 * 不正値は即 throw — 無言フォールバック禁止。
 */
export function createTtsProvider(env: NodeJS.ProcessEnv = process.env): TtsProvider | null {
  const raw = (env['TIROCINIUM_TTS_BACKEND'] ?? 'off').toLowerCase();
  switch (raw as TtsBackend) {
    case 'off':
      return null;
    case 'voicevox':
      return createVoicevoxTtsProvider(env);
    default:
      throw new Error(`Unknown TIROCINIUM_TTS_BACKEND: ${raw} (voicevox | off のみ)`);
  }
}
