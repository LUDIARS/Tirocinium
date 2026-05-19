import { describe, expect, it } from 'vitest';
import {
  ALPHA,
  AXES,
  applyEvaluationToProfile,
  initialSnapshot,
} from './weakness-math.js';

describe('initialSnapshot', () => {
  it('all axes start at 3 (neutral)', () => {
    const s = initialSnapshot();
    for (const a of AXES) {
      expect(s.axes_ema[a]).toBe(3);
    }
    expect(s.weak_top3).toEqual([]);
    expect(s.session_count).toBe(0);
  });
});

describe('applyEvaluationToProfile', () => {
  it('moves axes toward eval values with EMA alpha=0.3', () => {
    const cur = initialSnapshot(); // all 3
    const next = applyEvaluationToProfile(
      cur,
      { clarity: 1, demeanor: 5 },
      ['hint1'],
    );
    // alpha * new + (1-alpha) * old
    // clarity: 0.3 * 1 + 0.7 * 3 = 2.4
    // demeanor: 0.3 * 5 + 0.7 * 3 = 3.6
    expect(next.axes_ema['clarity']).toBeCloseTo(2.4, 5);
    expect(next.axes_ema['demeanor']).toBeCloseTo(3.6, 5);
    // untouched axes stay at 3
    expect(next.axes_ema['consistency']).toBe(3);
  });

  it('increments session_count', () => {
    const next = applyEvaluationToProfile(initialSnapshot(), { clarity: 2 }, []);
    expect(next.session_count).toBe(1);
  });

  it('weak_top3 picks lowest 3 axes', () => {
    // 3 評価を順次反映して特定の軸を低くする
    let s = initialSnapshot();
    for (let i = 0; i < 5; i++) {
      s = applyEvaluationToProfile(
        s,
        { clarity: 1, demeanor: 1, depth_resilience: 1 },
        [],
      );
    }
    expect(s.weak_top3.slice().sort()).toEqual(
      ['clarity', 'demeanor', 'depth_resilience'].sort(),
    );
  });

  it('hint_history retains last 50 in FIFO', () => {
    let s = initialSnapshot();
    for (let i = 0; i < 30; i++) {
      s = applyEvaluationToProfile(s, {}, [`h${i}`, `h${i}-b`]);
    }
    expect(s.hint_history.length).toBe(50);
    // 直近のものが末尾に
    expect(s.hint_history[s.hint_history.length - 1]).toBe('h29-b');
    // 古いものは捨てられる
    expect(s.hint_history.includes('h0')).toBe(false);
  });

  it('exposes ALPHA constant for transparency', () => {
    expect(ALPHA).toBe(0.3);
  });
});
