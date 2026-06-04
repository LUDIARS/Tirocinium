// WS フレームの型定義 (spec/web/README.md 準拠)

import type { Evaluation } from '@tirocinium/llm';

export type ClientFrame =
  | { kind: 'audio_chunk'; pcm: number[]; seq: number }
  | { kind: 'start_interview' }
  | { kind: 'stt_final'; text: string }
  | { kind: 'barge_in' }
  | { kind: 'end_session' }
  | { kind: 'pong'; t: number };

export type ServerFrame =
  | { kind: 'session_ready'; session_id: string; turn_no: number }
  | { kind: 'stt_partial'; text: string }
  | { kind: 'stt_final'; text: string; turn_no: number }
  | { kind: 'response_token'; token: string; turn_no: number }
  | { kind: 'response_end'; turn_no: number; text_uri: string }
  | { kind: 'eval'; evaluation: Evaluation }
  | { kind: 'system'; code: 'closing' | 'kicked' | 'no_show' | 'error'; message?: string };

export function isClientFrame(x: unknown): x is ClientFrame {
  if (!x || typeof x !== 'object') return false;
  const k = (x as { kind?: string }).kind;
  return [
    'audio_chunk',
    'start_interview',
    'stt_final',
    'barge_in',
    'end_session',
    'pong',
  ].includes(k ?? '');
}
