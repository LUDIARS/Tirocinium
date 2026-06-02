// Imperativus stt-service の gRPC (StreamingRecognize) に直結する STT クライアント。
//
// Iv のクライアント向け入口は WebRTC だが、Tr が必要とするのは「PCM を流して
// 認識テキストを受ける」だけ。dev プロファイルでは Iv の WebRTC 層をバイパスし、
// stt-service の gRPC に直接つなぐ (Cernere バイパスと同じ思想)。
// 本番の Tr↔Iv WebRTC 経路は将来。

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type { SttEvent } from './types.js';
import type { SttProvider } from './stt-provider.js';
import { AsyncQueue } from './queue.js';

const PROTO_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'proto', 'stt.proto');

// proto-loader (keepCase:false) は snake_case → camelCase に変換する。
type TranscriptResult = {
  text: string;
  confidence: number;
  isFinal: boolean;
  sessionId: string;
};

export type SttGrpcConfig = {
  /** 例: localhost:50051 */
  address: string;
};

export class SttGrpcClient implements SttProvider {
  private readonly client: grpc.Client & Record<string, (...args: unknown[]) => unknown>;

  constructor(cfg: SttGrpcConfig) {
    const pkgDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(pkgDef) as unknown as {
      imperativus: { stt: { SpeechToText: new (addr: string, creds: grpc.ChannelCredentials) => never } };
    };
    this.client = new proto.imperativus.stt.SpeechToText(
      cfg.address,
      grpc.credentials.createInsecure(),
    ) as never;
  }

  /**
   * PCM (16-bit LE, 16kHz, mono) のストリームを gRPC StreamingRecognize へ流し、
   * 認識結果を SttEvent として逐次 yield する。
   * - stt-service は現状 ~2 秒チャンクごとに is_final=true を返す (partial は無し)。
   * - pcmStream が尽きるか close されたら gRPC stream も終端する。
   */
  async *stt(
    pcmStream: AsyncIterable<Uint8Array>,
    sessionId = 'tirocinium',
  ): AsyncGenerator<SttEvent, void, unknown> {
    const out = new AsyncQueue<SttEvent>();
    const call = (this.client['StreamingRecognize'] as () => grpc.ClientDuplexStream<
      { audioData: Buffer; sessionId: string },
      TranscriptResult
    >)();

    call.on('data', (r: TranscriptResult) => {
      const text = (r.text ?? '').trim();
      if (!text) return;
      out.push(r.isFinal ? { kind: 'final', text, durationMs: 0 } : { kind: 'partial', text });
    });
    call.on('end', () => out.close());
    call.on('error', () => out.close());

    // producer: PCM チャンクを順次 write し、尽きたら end()
    void (async () => {
      try {
        for await (const chunk of pcmStream) {
          call.write({ audioData: Buffer.from(chunk), sessionId });
        }
      } catch {
        // pcmStream 側のエラーは無視 (out.close は call の end/error で行う)
      } finally {
        call.end();
      }
    })();

    yield* out;
  }
}

/** gRPC STT provider を生成。TIROCINIUM_STT_GRPC 未設定なら localhost:50051。 */
export function createSttGrpcProvider(env: NodeJS.ProcessEnv = process.env): SttGrpcClient {
  const addr = env['TIROCINIUM_STT_GRPC'] || 'localhost:50051';
  return new SttGrpcClient({ address: addr });
}
