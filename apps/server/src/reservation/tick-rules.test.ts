import { describe, expect, it } from 'vitest';
import { decideActionsFor, type ReservationRow } from './tick-rules.js';

function row(overrides: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id: 'r1',
    user_id: 'u1',
    slot_start: new Date('2026-05-19T10:00:00Z'),
    status: 'held',
    notify_sent: false,
    ...overrides,
  };
}

describe('decideActionsFor', () => {
  it('no action when not held', () => {
    const r = row({ status: 'started' });
    expect(decideActionsFor(r, { now: new Date('2026-05-19T09:45:00Z') })).toEqual([]);
  });

  it('emits notify_lead in 14-16 min window when notify_sent=false', () => {
    const r = row();
    const now = new Date('2026-05-19T09:45:00Z'); // 15 min before
    const actions = decideActionsFor(r, { now, notifyLeadMin: 15 });
    expect(actions.find((a) => a.kind === 'notify_lead')).toBeTruthy();
  });

  it('does not re-notify when notify_sent=true', () => {
    const r = row({ notify_sent: true });
    const now = new Date('2026-05-19T09:45:00Z');
    const actions = decideActionsFor(r, { now, notifyLeadMin: 15 });
    expect(actions.find((a) => a.kind === 'notify_lead')).toBeFalsy();
  });

  it('emits ready_to_start within slot, before no-show timeout', () => {
    const r = row();
    const now = new Date('2026-05-19T10:02:00Z'); // 2 min into slot
    const actions = decideActionsFor(r, { now, noShowTimeoutMin: 5 });
    expect(actions.find((a) => a.kind === 'ready_to_start')).toBeTruthy();
    expect(actions.find((a) => a.kind === 'mark_no_show')).toBeFalsy();
  });

  it('emits mark_no_show after timeout within slot', () => {
    const r = row();
    const now = new Date('2026-05-19T10:06:00Z'); // 6 min into slot
    const actions = decideActionsFor(r, { now, noShowTimeoutMin: 5 });
    expect(actions.find((a) => a.kind === 'mark_no_show')).toBeTruthy();
    expect(actions.find((a) => a.kind === 'ready_to_start')).toBeFalsy();
  });

  it('emits mark_no_show after slot end', () => {
    const r = row();
    const now = new Date('2026-05-19T11:00:00Z'); // 1 hour after start
    const actions = decideActionsFor(r, { now, noShowTimeoutMin: 5 });
    expect(actions.find((a) => a.kind === 'mark_no_show')).toBeTruthy();
  });

  it('emits no action when slot is far in future', () => {
    const r = row();
    const now = new Date('2026-05-19T08:00:00Z'); // 2 hours before
    const actions = decideActionsFor(r, { now, notifyLeadMin: 15 });
    expect(actions).toEqual([]);
  });
});
