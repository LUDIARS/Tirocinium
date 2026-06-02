import type { SttEvent, TtsRequest } from './types.js';
import { type SttProvider, createSttProvider } from './stt-provider.js';

export type IvClientConfig = {
  /** 例: http://localhost:5963 (WebRTC/HTTP 経路。未設定可) */
  baseUrl?: string;
  /** Cernere PASETO token (Bearer) */
  token?: string;
  /** STT 処理の実装 (gRPC 直結 / API など)。あれば stt() がこれに委譲する。 */
  sttProvider?: SttProvider | null;
};

/** Imperativus (Iv) の STT/TTS client。
 *  STT は sttProvider (gRPC 直結 / API 等) へ委譲。TTS / WebRTC 経路は未結線 (TODO)。 */
export class ImperativusClient {
  constructor(private readonly cfg: IvClientConfig) {}

  /** PCM 16kHz mono を投げて認識結果を逐次受け取る。
   *  sttProvider が設定されていれば委譲、無ければ何も yield しない。 */
  async *stt(
    pcmStream: AsyncIterable<Uint8Array>,
  ): AsyncGenerator<SttEvent, void, unknown> {
    if (this.cfg.sttProvider) {
      yield* this.cfg.sttProvider.stt(pcmStream);
      return;
    }
    // STT provider 未設定 → STT 無効 (クライアントは stt_final を別途送る前提)
    return;
  }

  /** テキストを TTS して PCM (16-bit LE) chunk を返す。 */
  async *tts(
    _req: TtsRequest,
  ): AsyncGenerator<Uint8Array, void, unknown> {
    // TODO(impl): Iv の TTS 経路 (WebRTC/HTTP) が固まったら結線
    return;
  }

  /** Iv の生存確認 (HTTP). baseUrl 未設定なら false。 */
  async health(): Promise<boolean> {
    if (!this.cfg.baseUrl) return false;
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

/** IV_URL か STT provider のどちらかが有効なら client を返す。 */
export function createIvClient(env: NodeJS.ProcessEnv = process.env): ImperativusClient | null {
  const url = env['IV_URL'];
  const sttProvider = createSttProvider(env);
  if (!url && !sttProvider) return null;
  return new ImperativusClient({
    baseUrl: url ? url.replace(/\/$/, '') : undefined,
    token: env['CERNERE_PROJECT_TOKEN'],
    sttProvider,
  });
}
