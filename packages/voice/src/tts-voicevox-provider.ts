// VOICEVOX engine (https://voicevox.hiroshiba.jp/) の TTS provider。
// spec/feature/voice/voicevox-tts.md。
// 経路: POST /audio_query?text&speaker → POST /synthesis?speaker → WAV → PCM chunk。
// TtsRequest.format を audio_query の outputSamplingRate / outputStereo に反映する。

import type { TtsRequest } from './types.js';
import type { TtsProvider } from './tts-provider.js';

export type VoicevoxConfig = {
  /** 例: http://127.0.0.1:50021 */
  baseUrl: string;
  /** 既定話者 id。TtsRequest.voice が数値文字列なら上書きされる */
  defaultSpeaker: number;
};

const PCM_CHUNK_BYTES = 8192;

/** WAV (RIFF) から data チャンクの PCM 部分を取り出す。
 *  44 byte 固定オフセット決め打ちにせず、チャンクを順に歩く。 */
export function extractWavData(wav: Uint8Array): Uint8Array {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const ascii = (off: number, len: number) =>
    String.fromCharCode(...wav.subarray(off, off + len));
  if (wav.byteLength < 12 || ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') {
    throw new Error('voicevox synthesis 応答が WAV (RIFF/WAVE) でない');
  }
  let off = 12;
  while (off + 8 <= wav.byteLength) {
    const id = ascii(off, 4);
    const size = view.getUint32(off + 4, true);
    if (id === 'data') {
      return wav.subarray(off + 8, Math.min(off + 8 + size, wav.byteLength));
    }
    // チャンクは 2 byte 境界に padding される
    off += 8 + size + (size % 2);
  }
  throw new Error('voicevox WAV に data チャンクが見つからない');
}

export class VoicevoxTtsProvider implements TtsProvider {
  constructor(
    private readonly cfg: VoicevoxConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async *tts(req: TtsRequest, signal?: AbortSignal): AsyncGenerator<Uint8Array, void, unknown> {
    const voiceNum = req.voice != null ? Number.parseInt(req.voice, 10) : NaN;
    const speaker = Number.isFinite(voiceNum) ? voiceNum : this.cfg.defaultSpeaker;

    const queryRes = await this.fetchFn(
      `${this.cfg.baseUrl}/audio_query?text=${encodeURIComponent(req.text)}&speaker=${speaker}`,
      { method: 'POST', signal },
    );
    if (!queryRes.ok) {
      throw new Error(`voicevox audio_query failed: HTTP ${queryRes.status}`);
    }
    const query = (await queryRes.json()) as Record<string, unknown>;
    if (req.format) {
      query['outputSamplingRate'] = req.format.sampleRate;
      query['outputStereo'] = req.format.channels === 2;
    }

    const synthRes = await this.fetchFn(`${this.cfg.baseUrl}/synthesis?speaker=${speaker}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'audio/wav' },
      body: JSON.stringify(query),
      signal,
    });
    if (!synthRes.ok) {
      throw new Error(`voicevox synthesis failed: HTTP ${synthRes.status}`);
    }
    const pcm = extractWavData(new Uint8Array(await synthRes.arrayBuffer()));
    for (let i = 0; i < pcm.length; i += PCM_CHUNK_BYTES) {
      if (signal?.aborted) return;
      yield pcm.subarray(i, Math.min(i + PCM_CHUNK_BYTES, pcm.length));
    }
  }
}

export function createVoicevoxTtsProvider(env: NodeJS.ProcessEnv = process.env): TtsProvider {
  const baseUrl = (env['TIROCINIUM_VOICEVOX_URL'] ?? 'http://127.0.0.1:50021').replace(/\/$/, '');
  const rawSpeaker = env['TIROCINIUM_VOICEVOX_SPEAKER'] ?? '13';
  const defaultSpeaker = Number.parseInt(rawSpeaker, 10);
  if (!Number.isFinite(defaultSpeaker) || defaultSpeaker < 0) {
    throw new Error(`TIROCINIUM_VOICEVOX_SPEAKER が不正: "${rawSpeaker}" (非負整数のみ)`);
  }
  return new VoicevoxTtsProvider({ baseUrl, defaultSpeaker });
}
