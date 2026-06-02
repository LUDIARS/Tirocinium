// STT 処理の抽象。PCM ストリームを受け取り認識結果 (SttEvent) を逐次返す。
// 実装は差し替え可能:
//   - gRPC 直結  : ローカル stt-service (faster-whisper / vosk 等)  → stt-grpc-client.ts
//   - クラウド API: OpenAI 等の transcription API                   → stt-api-provider.ts
// session-runtime / iv-client はこの interface にのみ依存する。

import type { SttEvent } from './types.js';
import { createSttGrpcProvider } from './stt-grpc-client.js';
import { createSttApiProvider } from './stt-api-provider.js';

export interface SttProvider {
  /** PCM (16-bit LE, 16kHz, mono) を流し、認識結果を逐次 yield する。 */
  stt(
    pcmStream: AsyncIterable<Uint8Array>,
    sessionId?: string,
  ): AsyncGenerator<SttEvent, void, unknown>;
}

export type SttBackend = 'grpc' | 'api' | 'off';

/**
 * TIROCINIUM_STT_BACKEND で実装を選ぶ。
 * 未設定時は TIROCINIUM_STT_GRPC があれば 'grpc'、無ければ 'off' (STT 無効 → null)。
 */
export function createSttProvider(env: NodeJS.ProcessEnv = process.env): SttProvider | null {
  const raw = env['TIROCINIUM_STT_BACKEND'];
  const backend: SttBackend = (raw?.toLowerCase() as SttBackend)
    ?? (env['TIROCINIUM_STT_GRPC'] ? 'grpc' : 'off');

  switch (backend) {
    case 'off':
      return null;
    case 'grpc':
      return createSttGrpcProvider(env);
    case 'api':
      return createSttApiProvider(env);
    default:
      throw new Error(`Unknown TIROCINIUM_STT_BACKEND: ${raw}`);
  }
}
