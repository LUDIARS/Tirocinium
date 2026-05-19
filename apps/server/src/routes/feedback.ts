import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import {
  appendFeedback,
  listFeedbackForSession,
  listMyFeedback,
  type FeedbackAction,
  type FeedbackTargetKind,
} from '../feedback/repo.js';

const TARGET_KINDS: FeedbackTargetKind[] = [
  'summary_block',
  'growth_hint',
  'rag_ref',
  'ai_critique',
  'evaluation_axis',
];
const ACTIONS: FeedbackAction[] = ['accept', 'reject', 'edit', 'skip'];

export const feedback = new Hono();
feedback.use('*', cernereAuth);

// POST /api/v1/feedback
feedback.post('/', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => null)) as
    | {
        target_kind: FeedbackTargetKind;
        target_id: string;
        action: FeedbackAction;
        edit_payload?: unknown;
        reason?: string;
      }
    | null;
  if (!body || !body.target_kind || !body.target_id || !body.action) {
    return c.json({ error: 'missing_required_fields' }, 400);
  }
  if (!TARGET_KINDS.includes(body.target_kind)) {
    return c.json({ error: 'invalid_target_kind' }, 400);
  }
  if (!ACTIONS.includes(body.action)) {
    return c.json({ error: 'invalid_action' }, 400);
  }
  const r = await appendFeedback({
    user_id: user.id,
    target_kind: body.target_kind,
    target_id: body.target_id,
    action: body.action,
    edit_payload: body.edit_payload,
    reason: body.reason,
  });
  return c.json({ feedback: r }, 201);
});

// GET /api/v1/feedback?session_id=...
feedback.get('/', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.query('session_id');
  const rows = sessionId
    ? await listFeedbackForSession(sessionId, user.id)
    : await listMyFeedback(user.id);
  return c.json({ feedback: rows });
});
