import { describe, expect, it } from 'vitest';
import { VoicevoxTtsProvider, createVoicevoxTtsProvider, extractWavData } from './tts-voicevox-provider.js';
import { createTtsProvider } from './tts-provider.js';

/** 最小の WAV (RIFF/WAVE + fmt + data) を組む。 */
function buildWav(pcm: Uint8Array, extraChunk = false): Uint8Array {
  const fmtSize = 16;
  const extra = extraChunk ? 8 + 4 : 0; // 'LIST' 等の別チャンクを挟むケース
  const total = 12 + (8 + fmtSize) + extra + 8 + pcm.length;
  const buf = new Uint8Array(total);
  const view = new DataView(buf.buffer);
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
  };
  ascii(0, 'RIFF');
  view.setUint32(4, total - 8, true);
  ascii(8, 'WAVE');
  let off = 12;
  ascii(off, 'fmt ');
  view.setUint32(off + 4, fmtSize, true);
  off += 8 + fmtSize;
  if (extraChunk) {
    ascii(off, 'LIST');
    view.setUint32(off + 4, 4, true);
    off += 8 + 4;
  }
  ascii(off, 'data');
  view.setUint32(off + 4, pcm.length, true);
  buf.set(pcm, off + 8);
  return buf;
}

async function collect(iter: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const c of iter) chunks.push(c);
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

describe('extractWavData', () => {
  it('data チャンクの PCM を取り出す (44 byte 決め打ちでない)', () => {
    const pcm = new Uint8Array([1, 2, 3, 4, 5, 6]);
    expect(extractWavData(buildWav(pcm))).toEqual(pcm);
    // fmt と data の間に別チャンクがあっても正しく辿る
    expect(extractWavData(buildWav(pcm, true))).toEqual(pcm);
  });

  it('RIFF でないバイト列は throw', () => {
    expect(() => extractWavData(new Uint8Array([0, 1, 2, 3]))).toThrow(/WAV/);
  });
});

type FetchCall = { url: string; init: RequestInit | undefined };

function mockFetch(pcm: Uint8Array): { calls: FetchCall[]; fetchFn: typeof fetch } {
  const calls: FetchCall[] = [];
  const fetchFn = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/audio_query')) {
      return new Response(JSON.stringify({ accent_phrases: [], outputSamplingRate: 24000, outputStereo: false }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(buildWav(pcm), { status: 200, headers: { 'content-type': 'audio/wav' } });
  }) as typeof fetch;
  return { calls, fetchFn };
}

describe('VoicevoxTtsProvider', () => {
  it('audio_query → synthesis を呼び PCM を yield する', async () => {
    const pcm = new Uint8Array(Array.from({ length: 100 }, (_, i) => i % 256));
    const { calls, fetchFn } = mockFetch(pcm);
    const provider = new VoicevoxTtsProvider({ baseUrl: 'http://vv:50021', defaultSpeaker: 13 }, fetchFn);

    const out = await collect(provider.tts({ text: 'こんにちは。面接を始めます' }));
    expect(out).toEqual(pcm);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toContain('/audio_query?');
    expect(calls[0]!.url).toContain(encodeURIComponent('こんにちは。面接を始めます'));
    expect(calls[0]!.url).toContain('speaker=13');
    expect(calls[1]!.url).toContain('/synthesis?speaker=13');
  });

  it('TtsRequest.format を audio_query 結果へ反映して synthesis に渡す', async () => {
    const { calls, fetchFn } = mockFetch(new Uint8Array([0, 0]));
    const provider = new VoicevoxTtsProvider({ baseUrl: 'http://vv:50021', defaultSpeaker: 3 }, fetchFn);
    await collect(
      provider.tts({
        text: 'a',
        format: { sampleRate: 48000, channels: 2, bitDepth: 16, encoding: 'pcm-s16le' },
      }),
    );
    const body = JSON.parse(String(calls[1]!.init?.body)) as Record<string, unknown>;
    expect(body['outputSamplingRate']).toBe(48000);
    expect(body['outputStereo']).toBe(true);
  });

  it('TtsRequest.voice が数値文字列なら speaker を上書きする', async () => {
    const { calls, fetchFn } = mockFetch(new Uint8Array([0, 0]));
    const provider = new VoicevoxTtsProvider({ baseUrl: 'http://vv:50021', defaultSpeaker: 3 }, fetchFn);
    await collect(provider.tts({ text: 'a', voice: '47' }));
    expect(calls[0]!.url).toContain('speaker=47');
  });

  it('大きな PCM は chunk 分割して yield する', async () => {
    const pcm = new Uint8Array(20000);
    const { fetchFn } = mockFetch(pcm);
    const provider = new VoicevoxTtsProvider({ baseUrl: 'http://vv:50021', defaultSpeaker: 3 }, fetchFn);
    const chunks: Uint8Array[] = [];
    for await (const c of provider.tts({ text: 'a' })) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.reduce((s, c) => s + c.length, 0)).toBe(20000);
  });

  it('engine エラー (HTTP 非 200) は明示 throw', async () => {
    const fetchFn = (async () => new Response('boom', { status: 500 })) as typeof fetch;
    const provider = new VoicevoxTtsProvider({ baseUrl: 'http://vv:50021', defaultSpeaker: 3 }, fetchFn);
    await expect(collect(provider.tts({ text: 'a' }))).rejects.toThrow(/audio_query failed/);
  });
});

describe('createTtsProvider', () => {
  it('既定 (未設定) は null (TTS 無効)', () => {
    expect(createTtsProvider({} as NodeJS.ProcessEnv)).toBeNull();
    expect(createTtsProvider({ TIROCINIUM_TTS_BACKEND: 'off' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('voicevox で provider を返す', () => {
    const p = createTtsProvider({ TIROCINIUM_TTS_BACKEND: 'voicevox' } as NodeJS.ProcessEnv);
    expect(p).not.toBeNull();
  });

  it('不正 backend は即 throw (無言フォールバック禁止)', () => {
    expect(() => createTtsProvider({ TIROCINIUM_TTS_BACKEND: 'polly' } as NodeJS.ProcessEnv)).toThrow(
      /TIROCINIUM_TTS_BACKEND/,
    );
  });

  it('不正 speaker は即 throw', () => {
    expect(() =>
      createVoicevoxTtsProvider({
        TIROCINIUM_TTS_BACKEND: 'voicevox',
        TIROCINIUM_VOICEVOX_SPEAKER: 'abc',
      } as NodeJS.ProcessEnv),
    ).toThrow(/TIROCINIUM_VOICEVOX_SPEAKER/);
  });
});
