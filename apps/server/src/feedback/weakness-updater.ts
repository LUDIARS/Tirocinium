import { sql } from '../db/index.js';
import {
  applyEvaluationToProfile,
  initialSnapshot,
  type ProfileSnapshot,
} from './weakness-math.js';

export { AXES, ALPHA, type Axis, type ProfileSnapshot } from './weakness-math.js';

/** DB から profile を読む。 行が無ければ initial を返す */
export async function loadProfile(userId: string): Promise<ProfileSnapshot> {
  const rows = await sql<{
    axes_ema: Record<string, number> | null;
    axes_variance: Record<string, number> | null;
    weak_top3: string[] | null;
    hint_history: string[] | null;
    session_count: number;
  }[]>`
    SELECT axes_ema, axes_variance, weak_top3, hint_history, session_count
    FROM weakness_profiles WHERE user_id = ${userId}
  `;
  if (rows.length === 0) return initialSnapshot();
  const r = rows[0]!;
  return {
    axes_ema: r.axes_ema ?? initialSnapshot().axes_ema,
    axes_variance: r.axes_variance ?? initialSnapshot().axes_variance,
    weak_top3: r.weak_top3 ?? [],
    hint_history: r.hint_history ?? [],
    session_count: r.session_count ?? 0,
  };
}

/** profile を upsert */
export async function saveProfile(userId: string, next: ProfileSnapshot): Promise<void> {
  await sql`
    INSERT INTO weakness_profiles
      (user_id, axes_ema, axes_variance, weak_top3, hint_history, session_count, updated_at)
    VALUES (
      ${userId},
      ${sql.json(next.axes_ema as never)},
      ${sql.json(next.axes_variance as never)},
      ${next.weak_top3},
      ${sql.json(next.hint_history as never)},
      ${next.session_count},
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      axes_ema = EXCLUDED.axes_ema,
      axes_variance = EXCLUDED.axes_variance,
      weak_top3 = EXCLUDED.weak_top3,
      hint_history = EXCLUDED.hint_history,
      session_count = EXCLUDED.session_count,
      updated_at = now()
  `;
}

/** 評価 1 件を受けて profile を更新 (DB 反映まで) */
export async function applyEvaluation(
  userId: string,
  evalAxes: Partial<Record<string, number>>,
  evalHints: string[],
): Promise<ProfileSnapshot> {
  const cur = await loadProfile(userId);
  const next = applyEvaluationToProfile(cur, evalAxes, evalHints);
  await saveProfile(userId, next);
  return next;
}
