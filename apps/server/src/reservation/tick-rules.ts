// 純粋な判定ロジック (DB 無し)。 vitest で env 不要にテストする。

import { slotDurationMin } from './slot.js';

const MS_PER_MIN = 60_000;
const NO_SHOW_TIMEOUT_MIN_DEFAULT = 5;
const NOTIFY_LEAD_MIN_DEFAULT = 15;
const NOTIFY_LEAD_WINDOW_MIN = 2;

export type ReservationRow = {
  id: string;
  user_id: string;
  slot_start: Date;
  status: 'held' | 'started' | 'no_show' | 'canceled' | 'completed';
  notify_sent: boolean;
};

export type TickAction =
  | { kind: 'notify_lead'; reservation: ReservationRow; leadMin: number }
  | { kind: 'mark_no_show'; reservation: ReservationRow }
  | { kind: 'ready_to_start'; reservation: ReservationRow };

export type TickConfig = {
  now: Date;
  noShowTimeoutMin?: number;
  notifyLeadMin?: number;
};

/** 1 件の予約に対する判定。 該当アクションを 0..n 個返す。 */
export function decideActionsFor(
  r: ReservationRow,
  cfg: TickConfig,
): TickAction[] {
  if (r.status !== 'held') return [];
  const now = cfg.now;
  const start = r.slot_start;
  const noShowMs = (cfg.noShowTimeoutMin ?? NO_SHOW_TIMEOUT_MIN_DEFAULT) * MS_PER_MIN;
  const leadMin = cfg.notifyLeadMin ?? NOTIFY_LEAD_MIN_DEFAULT;

  const actions: TickAction[] = [];

  // 15 分前通知 (slot_start - now が leadMin ± WINDOW 内 で notify_sent=false)
  const minsUntilStart = (start.getTime() - now.getTime()) / MS_PER_MIN;
  if (
    !r.notify_sent &&
    minsUntilStart >= leadMin - NOTIFY_LEAD_WINDOW_MIN &&
    minsUntilStart <= leadMin + NOTIFY_LEAD_WINDOW_MIN
  ) {
    actions.push({ kind: 'notify_lead', reservation: r, leadMin });
  }

  // slot 開始 (now >= start かつ slot 内)
  const slotEnd = new Date(start.getTime() + slotDurationMin * MS_PER_MIN);
  if (now >= start && now < slotEnd) {
    // 5 分以内に start されてなければ no_show
    if (now.getTime() - start.getTime() >= noShowMs) {
      actions.push({ kind: 'mark_no_show', reservation: r });
    } else {
      actions.push({ kind: 'ready_to_start', reservation: r });
    }
  } else if (now >= slotEnd) {
    // slot を過ぎても held のまま → no_show
    actions.push({ kind: 'mark_no_show', reservation: r });
  }

  return actions;
}
