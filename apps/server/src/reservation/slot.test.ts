import { describe, expect, it } from 'vitest';
import { currentSlotStart, nextSlotStart } from './slot.js';

describe('slot boundary helpers', () => {
  it('truncates to 30-min boundary', () => {
    const d = new Date('2026-05-18T12:17:42.000Z');
    const s = currentSlotStart(d);
    expect(s.toISOString()).toBe('2026-05-18T12:00:00.000Z');
  });

  it('advances 30 min', () => {
    const d = new Date('2026-05-18T12:00:00.000Z');
    expect(nextSlotStart(d).toISOString()).toBe('2026-05-18T12:30:00.000Z');
  });

  it('rolls over to next hour', () => {
    const d = new Date('2026-05-18T12:30:00.000Z');
    expect(nextSlotStart(d).toISOString()).toBe('2026-05-18T13:00:00.000Z');
  });
});
