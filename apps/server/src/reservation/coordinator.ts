import { sql } from '../db/index.js';
import { config } from '../config.js';
import { currentSlotStart, nextSlotStart } from './slot.js';

export { currentSlotStart, nextSlotStart };

export type StartDecision =
  | { kind: 'start'; sessionId: string }
  | { kind: 'offer'; slotStart: Date }
  | { kind: 'denied'; reason: 'saturated' | 'no_future_slot' };

async function ensureSlotExists(slotStart: Date): Promise<void> {
  await sql`
    INSERT INTO reservation_slots (slot_start, capacity)
    VALUES (${slotStart.toISOString()}, ${config.slotCapacity})
    ON CONFLICT (slot_start) DO NOTHING
  `;
}

async function findFirstFreeSlot(from: Date, lookaheadHours = 48): Promise<Date | null> {
  // 直近 lookahead 時間の slot を先に確保しておく
  const slots: Date[] = [];
  let cur = currentSlotStart(from);
  const max = new Date(from.getTime() + lookaheadHours * 3600 * 1000);
  while (cur <= max) {
    slots.push(cur);
    cur = nextSlotStart(cur);
  }
  for (const s of slots) await ensureSlotExists(s);

  const row = await sql<{ slot_start: Date }[]>`
    SELECT slot_start FROM reservation_slots
    WHERE slot_start >= ${from.toISOString()}
      AND used < capacity
    ORDER BY slot_start ASC
    LIMIT 1
  `;
  return row[0]?.slot_start ?? null;
}

async function serverLoad(): Promise<number> {
  // 簡易: active セッション数 / (slot_capacity * 2) を負荷率の proxy にする
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM sessions WHERE status = 'active'
  `;
  const active = rows[0]?.count ?? 0;
  return Math.min(1, active / (config.slotCapacity * 2));
}

/** 即時開始 or 予約 offer を返す。 実際に session 開始する責務はここでは持たない (caller 側で start) */
export async function tryStart(userId: string): Promise<StartDecision> {
  if ((await serverLoad()) > 0.95) {
    return { kind: 'denied', reason: 'saturated' };
  }

  const now = currentSlotStart();
  await ensureSlotExists(now);

  // current slot に空きあるか? 行ロックで安全に確保
  const taken = await sql.begin(async (tx) => {
    const slot = await tx<{ used: number; capacity: number }[]>`
      SELECT used, capacity FROM reservation_slots
      WHERE slot_start = ${now.toISOString()}
      FOR UPDATE
    `;
    if (!slot[0]) return false;
    if (slot[0].used >= slot[0].capacity) return false;
    await tx`
      UPDATE reservation_slots SET used = used + 1, updated_at = now()
      WHERE slot_start = ${now.toISOString()}
    `;
    return true;
  });

  if (taken) {
    const session = await sql<{ id: string }[]>`
      INSERT INTO sessions (user_id, mode, status, llm_profile)
      VALUES (${userId}, 'server', 'active', '{}'::jsonb)
      RETURNING id
    `;
    return { kind: 'start', sessionId: session[0]!.id };
  }

  const next = await findFirstFreeSlot(nextSlotStart(now));
  if (!next) return { kind: 'denied', reason: 'no_future_slot' };
  return { kind: 'offer', slotStart: next };
}

export async function reserve(userId: string, slotStart: Date): Promise<{ id: string }> {
  return sql.begin(async (tx) => {
    await tx`
      INSERT INTO reservation_slots (slot_start, capacity)
      VALUES (${slotStart.toISOString()}, ${config.slotCapacity})
      ON CONFLICT (slot_start) DO NOTHING
    `;
    const slot = await tx<{ used: number; capacity: number }[]>`
      SELECT used, capacity FROM reservation_slots
      WHERE slot_start = ${slotStart.toISOString()}
      FOR UPDATE
    `;
    if (!slot[0] || slot[0].used >= slot[0].capacity) {
      throw new Error('slot_full');
    }
    const res = await tx<{ id: string }[]>`
      INSERT INTO reservations (user_id, slot_start, status)
      VALUES (${userId}, ${slotStart.toISOString()}, 'held')
      RETURNING id
    `;
    await tx`
      UPDATE reservation_slots SET used = used + 1, updated_at = now()
      WHERE slot_start = ${slotStart.toISOString()}
    `;
    return res[0]!;
  });
}

export async function cancel(reservationId: string, userId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const row = await tx<{ slot_start: Date; status: string }[]>`
      SELECT slot_start, status FROM reservations
      WHERE id = ${reservationId} AND user_id = ${userId}
      FOR UPDATE
    `;
    if (!row[0]) throw new Error('not_found');
    if (row[0].status !== 'held') throw new Error('cannot_cancel');
    await tx`UPDATE reservations SET status = 'canceled' WHERE id = ${reservationId}`;
    await tx`
      UPDATE reservation_slots SET used = GREATEST(used - 1, 0), updated_at = now()
      WHERE slot_start = ${row[0].slot_start.toISOString()}
    `;
  });
}

export async function listSlots(from: Date, hours: number) {
  const max = new Date(from.getTime() + hours * 3600 * 1000);
  return sql<{ slot_start: Date; capacity: number; used: number }[]>`
    SELECT slot_start, capacity, used FROM reservation_slots
    WHERE slot_start >= ${from.toISOString()} AND slot_start <= ${max.toISOString()}
    ORDER BY slot_start ASC
  `;
}

export async function listMyReservations(userId: string) {
  return sql<{ id: string; slot_start: Date; status: string }[]>`
    SELECT id, slot_start, status FROM reservations
    WHERE user_id = ${userId}
    ORDER BY slot_start DESC
    LIMIT 50
  `;
}
