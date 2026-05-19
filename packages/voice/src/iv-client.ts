import type { SttEvent, TtsRequest } from './types.js';

export type IvClientConfig = {
  /** 例: http://localhost:5963 */
  baseUrl: string;
  /** Cernere PASETO token (Bearer) */
  token?: string;
};

/** Imperativus (Iv) の STT/TTS client。 仕様未確定の部分は TODO のまま、
 *  HTTP/WS の interface だけ固定する。 */
export class ImperativusClient {
  constructor(private readonly cfg: IvClientConfig) {}

  /** PCM 16kHz mono を投げて部分認識結果を逐次受け取る。
   *  実装は Iv 側の WS API が固まったら結線。 */
  async *stt(
    _pcmStream: AsyncIterable<Uint8Array>,
  ): AsyncGenerator<SttEvent, void, unknown> {
    // TODO(impl): WS /v1/stt に接続し、 audio_chunk を投げ、 partial/final を受け取る
    // ここでは型の整合性のためにダミーで何も yield しない
    return;
  }

  /** テキストを TTS して PCM (16-bit LE) chunk を返す。 */
  async *tts(
    _req: TtsRequest,
  ): AsyncGenerator<Uint8Array, void, unknown> {
    // TODO(impl): POST /v1/tts (or WS) に投げて stream で受け取る
    return;
  }

  /** Iv の生存確認 (HTTP). */
  async health(): Promise<boolean> {
    try {
      const res = await fetch(this.cfg.baseUrl + '/health', {
        headers: this.cfg.token ? { authorization: `Bearer ${this.cfg.token}` } : undefined,
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export function createIvClient(env: NodeJS.ProcessEnv = process.env): ImperativusClient | null {
  const url = env['IV_URL'];
  if (!url) return null;
  return new ImperativusClient({
    baseUrl: url.replace(/\/$/, ''),
    token: env['CERNERE_PROJECT_TOKEN'],
  });
}
