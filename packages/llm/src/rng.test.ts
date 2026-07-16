import { describe, expect, it } from 'vitest';
import { mulberry32, newSessionSeed, shuffled } from './rng.js';

describe('mulberry32', () => {
  it('同じ seed から同じ乱数列を返す (決定性)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('異なる seed は異なる列を返す', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('値域は [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('shuffled', () => {
  it('同じ rng で同じ並び (決定性) + 入力を破壊しない', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const snapshot = [...input];
    const a = shuffled(input, mulberry32(42));
    const b = shuffled(input, mulberry32(42));
    expect(a).toEqual(b);
    expect(input).toEqual(snapshot);
    expect([...a].sort((x, y) => x - y)).toEqual(snapshot);
  });
});

describe('newSessionSeed', () => {
  it('32bit 非負整数を返す', () => {
    for (let i = 0; i < 10; i++) {
      const s = newSessionSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(0xffffffff);
    }
  });
});
