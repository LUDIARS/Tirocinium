import { describe, expect, it } from 'vitest';
import { isClientFrame } from './frames.js';

describe('isClientFrame', () => {
  it('accepts valid client frames', () => {
    expect(isClientFrame({ kind: 'stt_final', text: 'hi' })).toBe(true);
    expect(isClientFrame({ kind: 'barge_in' })).toBe(true);
    expect(isClientFrame({ kind: 'audio_chunk', pcm: [1, 2], seq: 1 })).toBe(true);
    expect(isClientFrame({ kind: 'end_session' })).toBe(true);
    expect(isClientFrame({ kind: 'pong', t: 1 })).toBe(true);
  });

  it('rejects unknown kinds', () => {
    expect(isClientFrame({ kind: 'unknown' })).toBe(false);
    expect(isClientFrame({})).toBe(false);
    expect(isClientFrame(null)).toBe(false);
    expect(isClientFrame('hello')).toBe(false);
  });
});
