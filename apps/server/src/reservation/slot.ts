const SLOT_DURATION_MIN = Number.parseInt(process.env.SLOT_DURATION_MIN ?? '30', 10);

export const slotDurationMin = SLOT_DURATION_MIN;

/** UTC 時刻を slot 境界 (HH:00 / HH:30 等) に切り下げる */
export function currentSlotStart(now: Date = new Date()): Date {
  const d = new Date(now);
  const trunc = Math.floor(d.getUTCMinutes() / SLOT_DURATION_MIN) * SLOT_DURATION_MIN;
  d.setUTCMinutes(trunc, 0, 0);
  return d;
}

export function nextSlotStart(after: Date): Date {
  const d = new Date(after);
  d.setUTCMinutes(d.getUTCMinutes() + SLOT_DURATION_MIN, 0, 0);
  return currentSlotStart(d);
}
