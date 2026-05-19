// 共通型 (apps/server + apps/desktop で共有)

export type AudioFormat = {
  sampleRate: 16000 | 24000 | 48000;
  channels: 1 | 2;
  /** 8/16/24/32 bit */
  bitDepth: 16 | 24 | 32;
  encoding: 'pcm-s16le' | 'pcm-s24le' | 'pcm-f32le';
};

export type SttPartial = { kind: 'partial'; text: string };
export type SttFinal = { kind: 'final'; text: string; durationMs: number };
export type SttEvent = SttPartial | SttFinal;

export type TtsRequest = {
  text: string;
  voice?: string;
  format?: AudioFormat;
};

export type VadState = 'speech' | 'silence';
