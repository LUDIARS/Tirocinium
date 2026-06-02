// クラウド STT API を使う SttProvider の差し込み口 (seam)。
//
// gRPC 版 (stt-grpc-client.ts) は stt-service 側が音声をチャンク分割して
// 逐次 final を返すが、OpenAI 等の transcription API は「発話 1 区切り = 1 リクエスト」
// のバッチ呼び出し。そのためクライアント側で VAD (SimpleEnergyVad) により発話境界を
// 検出してバッファを切り出し、WAV 化して POST する実装が必要になる。
//
// 本ファイルは抽象を確立するための seam。実装は後続スライスで埋める
// (TIROCINIUM_STT_BACKEND=api を選んだ時だけ使われる)。

import type { SttEvent } from './types.js';
import type { SttProvider } from './stt-provider.js';

export type SttApiConfig = {
  apiKey: string;
  /** 例: https://api.openai.com/v1 */
  baseUrl: string;
  /** 例: gpt-4o-mini-transcribe / whisper-1 */
  model: string;
  language: string;
};

export class ApiSttProvider implements SttProvider {
  constructor(private readonly cfg: SttApiConfig) {}

  // eslint-disable-next-line require-yield
  async *stt(
    _pcmStream: AsyncIterable<Uint8Array>,
    _sessionId?: string,
  ): AsyncGenerator<SttEvent, void, unknown> {
    // TODO(slice-2): VAD で発話を区切り → WAV(16k/mono/s16le) 化 →
    //   POST {baseUrl}/audio/transcriptions (multipart, model={cfg.model}, language)
    //   → 1 発話ごとに { kind: 'final', text } を yield。
    throw new Error(
      'ApiSttProvider is not implemented yet. Use TIROCINIUM_STT_BACKEND=grpc for now.',
    );
  }
}

/** TIROCINIUM_STT_API_KEY か OPENAI_API_KEY からクラウド STT provider を生成。 */
export function createSttApiProvider(env: NodeJS.ProcessEnv = process.env): ApiSttProvider {
  const apiKey = env['TIROCINIUM_STT_API_KEY'] || env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'TIROCINIUM_STT_BACKEND=api requires TIROCINIUM_STT_API_KEY (or OPENAI_API_KEY).',
    );
  }
  return new ApiSttProvider({
    apiKey,
    baseUrl: env['TIROCINIUM_STT_API_URL'] || 'https://api.openai.com/v1',
    model: env['TIROCINIUM_STT_API_MODEL'] || 'gpt-4o-mini-transcribe',
    language: env['TIROCINIUM_STT_LANGUAGE'] || 'ja',
  });
}
