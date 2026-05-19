import { sql } from '../db/index.js';
import { config } from '../config.js';
import { pushNotification } from '../notifications/nuntius.js';
import { decideActionsFor, type ReservationRow } from './tick-rules.js';

const MS_PER_MIN = 60_000;

/** 直近 24 時間以内 (前後) で held の予約をすべて検査 + アクション実行 */
export async function tickNow(now: Date = new Date()): Promise<{
  notified: number;
  marked_no_show: number;
  ready_to_start: number;
}> {
  const horizonMs = 24 * 60 * MS_PER_MIN;
  const min = new Date(now.getTime() - horizonMs);
  const max = new Date(now.getTime() + horizonMs);

  const rows = await sql<ReservationRow[]>`
    SELECT id, user_id, slot_start, status, notify_sent
    FROM reservations
    WHERE status = 'held'
      AND slot_start BETWEEN ${min.toISOString()} AND ${max.toISOString()}
  `;

  let notified = 0;
  let marked_no_show = 0;
  let ready_to_start = 0;

  for (const r of rows) {
    const actions = decideActionsFor(r, {
      now,
      noShowTimeoutMin: config.noShowTimeoutMin,
      notifyLeadMin: config.notifyLeadMin,
    });
    for (const a of actions) {
      if (a.kind === 'notify_lead') {
        const res = await pushNotification({
          user_id: a.reservation.user_id,
          title: 'Tirocinium 面接の開始時刻が近づいています',
          body: `${a.leadMin} 分後に開始予定の面接 slot です。 開始ボタンの準備を。`,
          data: { reservation_id: a.reservation.id, slot_start: a.reservation.slot_start },
        });
        if (res.ok) {
          await sql`
            UPDATE reservations SET notify_sent = true WHERE id = ${a.reservation.id}
          `;
          notified++;
        }
      } else if (a.kind === 'mark_no_show') {
        await sql.begin(async (tx) => {
          await tx`
            UPDATE reservations SET status = 'no_show'
            WHERE id = ${a.reservation.id} AND status = 'held'
          `;
          await tx`
            UPDATE reservation_slots
            SET used = GREATEST(used - 1, 0), updated_at = now()
            WHERE slot_start = ${a.reservation.slot_start.toISOString()}
          `;
        });
        marked_no_show++;
      } else if (a.kind === 'ready_to_start') {
        ready_to_start++;
        // 開始準備の WS push は WS endpoint を経由する必要があるが、
        // tick からは直接接続を持たないので Nuntius 経由で「開始してください」 push
        await pushNotification({
          user_id: a.reservation.user_id,
          title: 'Tirocinium 面接の時間です',
          body: '予約 slot が開始しました。 5 分以内に開始ボタンを押してください。',
          data: { reservation_id: a.reservation.id, slot_start: a.reservation.slot_start },
        });
      }
    }
  }

  return { notified, marked_no_show, ready_to_start };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startTickScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tickNow().catch((err) => {
      console.error('[reservation tick] error', err);
    });
  }, 60_000);
  // 起動直後にも 1 回
  void tickNow().catch((err) => {
    console.error('[reservation tick] initial error', err);
  });
}

export function stopTickScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
