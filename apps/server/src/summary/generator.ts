import { createAnthropicClient, summarize, type Evaluation, type Turn } from '@tirocinium/llm';
import { sql } from '../db/index.js';
import { upsertSummary } from './repo.js';

/** session の turns / evaluations を取得して Opus でサマリ生成 → DB に格納 */
export async function generateSummaryForSession(sessionId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!process.env['ANTHROPIC_API_KEY']) {
    return { ok: false, reason: 'anthropic_api_key_missing' };
  }

  const turnsRows = await sql<{ turn_no: number; role: 'interviewer' | 'user'; stt_text: string | null; text_uri: string }[]>`
    SELECT turn_no, role, stt_text, text_uri FROM session_turns
    WHERE session_id = ${sessionId}
    ORDER BY turn_no ASC
  `;
  if (turnsRows.length === 0) {
    return { ok: false, reason: 'no_turns' };
  }

  const evalRows = await sql<{ turn_range: string; axes: Record<string, number>; comment: string; hints: string[]; model: string }[]>`
    SELECT turn_range::text AS turn_range, axes, comment, hints, model
    FROM evaluations WHERE session_id = ${sessionId}
    ORDER BY scored_at ASC
  `;

  const turns: Turn[] = turnsRows.map((r) => ({
    turn_no: r.turn_no,
    role: r.role,
    // server 側で text_uri から Memoria に取りに行く設計だが、
    // stt_text があれば利用、 無ければ text_uri をそのまま渡す (LLM が読む前提)
    text: r.stt_text ?? r.text_uri,
  }));
  const evaluations: Evaluation[] = evalRows.map((r) => ({
    turn_range: parseInt4Range(r.turn_range),
    axes: r.axes,
    comment: r.comment,
    hints: r.hints,
    model: r.model,
  }));

  const client = createAnthropicClient();
  const doc = await summarize(client, { turns, evaluations });

  await upsertSummary({
    session_id: sessionId,
    headline: doc.headline,
    highlights: doc.highlights,
    axes_summary: doc.axes_summary,
    growth_points: doc.growth_points,
    carry_over: doc.carry_over,
    interviewer_note: doc.interviewer_note,
    model: 'claude-opus-4-7',
  });
  return { ok: true };
}

/** Postgres int4range の "[a,b]" / "[a,b)" 表記を [number, number] へ */
function parseInt4Range(s: string): [number, number] {
  const m = s.match(/[\[(](\d+),(\d+)[\])]/);
  if (!m) return [0, 0];
  const lo = Number.parseInt(m[1]!, 10);
  let hi = Number.parseInt(m[2]!, 10);
  if (s.endsWith(')')) hi -= 1; // 半開区間
  return [lo, hi];
}
