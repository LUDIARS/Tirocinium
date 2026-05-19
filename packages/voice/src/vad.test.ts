import { describe, expect, it } from 'vitest';
import { SimpleEnergyVad, rms } from './vad.js';

function silenceFrame(samples = 320): Float32Array {
  return new Float32Array(samples); // all zeros
}

function speechFrame(samples = 320, amplitude = 0.3): Float32Array {
  const arr = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    arr[i] = Math.sin((2 * Math.PI * 440 * i) / 16000) * amplitude;
  }
  return arr;
}

describe('rms', () => {
  it('returns 0 for empty', () => {
    expect(rms(new Float32Array(0))).toBe(0);
  });
  it('returns 0 for all zero', () => {
    expect(rms(silenceFrame(100))).toBe(0);
  });
  it('returns positive for sin wave', () => {
    expect(rms(speechFrame(320, 0.5))).toBeGreaterThan(0);
  });
});

describe('SimpleEnergyVad', () => {
  it('transitions silence -> speech after enough speech frames', () => {
    const vad = new SimpleEnergyVad(16000, 0.01, 600, 100, 20);
    // 100ms ぶんの speech (5 frames @ 20ms)
    let transitioned = false;
    for (let i = 0; i < 6; i++) {
      const s = vad.feed(speechFrame());
      if (s === 'speech') transitioned = true;
    }
    expect(transitioned).toBe(true);
    expect(vad.getState()).toBe('speech');
  });

  it('transitions speech -> silence after long silence', () => {
    const vad = new SimpleEnergyVad(16000, 0.01, 600, 100, 20);
    // まず speech に
    for (let i = 0; i < 6; i++) vad.feed(speechFrame());
    expect(vad.getState()).toBe('speech');
    // 600ms ぶんの silence
    let transitioned = false;
    for (let i = 0; i < 35; i++) {
      const s = vad.feed(silenceFrame());
      if (s === 'silence') transitioned = true;
    }
    expect(transitioned).toBe(true);
    expect(vad.getState()).toBe('silence');
  });

  it('returns null mid-state', () => {
    const vad = new SimpleEnergyVad(16000, 0.01, 600, 100, 20);
    expect(vad.feed(silenceFrame())).toBeNull(); // silence -> silence は遷移なし
  });
});
