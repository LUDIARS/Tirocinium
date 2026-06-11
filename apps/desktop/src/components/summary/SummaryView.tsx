import { useState } from 'react';
import type { Summary, FeedbackAction } from '../../types/session.js';

type Props = {
  summary: Summary;
  onFeedback?: (block: string, action: FeedbackAction) => void;
};

const SCORE_COLORS = ['var(--c-danger)', 'var(--c-danger)', 'var(--c-warn)', 'var(--c-warn)', 'var(--c-ok)', 'var(--c-ok)'];

type BlockActions = Record<string, FeedbackAction | null>;

export function SummaryView({ summary, onFeedback }: Props) {
  const [actions, setActions] = useState<BlockActions>({});
  const [edits, setEdits] = useState<Record<string, string>>({});

  const act = (block: string, action: FeedbackAction) => {
    setActions((a) => ({ ...a, [block]: action }));
    onFeedback?.(block, action);
  };

  const startEdit = (block: string, original: string) => {
    setEdits((e) => ({ ...e, [block]: original }));
  };

  const submitEdit = (block: string) => {
    const text = edits[block] ?? '';
    act(block, { edited: text });
    setEdits((e) => { const n = { ...e }; delete n[block]; return n; });
  };

  return (
    <div className="summary-view">
      <div className="summary-section">
        <div className="summary-section-header">
          <h3>総評</h3>
          <FeedbackActions
            state={actions['headline'] ?? null}
            editing={'headline' in edits}
            onAccept={() => act('headline', 'accepted')}
            onReject={() => act('headline', 'rejected')}
            onEdit={() => startEdit('headline', summary.headline)}
          />
        </div>
        {'headline' in edits ? (
          <EditBox
            value={edits['headline'] ?? ''}
            onChange={(v) => setEdits((e) => ({ ...e, headline: v }))}
            onSubmit={() => submitEdit('headline')}
          />
        ) : (
          <p className="summary-headline">{summary.headline}</p>
        )}
      </div>

      <div className="summary-section">
        <h3>印象ターン</h3>
        {summary.highlights.map((h, i) => (
          <div key={i} className="summary-highlight">
            <span className="fd-badge fd-badge-muted">T{h.turn_no}</span>
            <span style={{ marginLeft: 8 }}>{h.comment}</span>
          </div>
        ))}
      </div>

      <div className="summary-section">
        <h3>6 軸スコア</h3>
        <div className="eval-axes">
          {summary.axes_summary.map((ax) => {
            const pct = Math.round((ax.score / 5) * 100);
            const color = SCORE_COLORS[Math.min(ax.score, 5)];
            return (
              <div key={ax.axis} className="eval-axis">
                <div className="eval-axis-header">
                  <span className="eval-axis-name">{ax.axis}</span>
                  <span className="eval-axis-score" style={{ color }}>{ax.score}/5</span>
                  {ax.ema_comparison && (
                    <span className="muted" style={{ fontSize: '0.75rem', marginLeft: 6 }}>
                      {ax.ema_comparison}
                    </span>
                  )}
                </div>
                <div className="eval-axis-bar-bg">
                  <div
                    className="eval-axis-bar-fill"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="summary-section">
        <div className="summary-section-header">
          <h3>改善ポイント</h3>
          <FeedbackActions
            state={actions['growth_points'] ?? null}
            editing={'growth_points' in edits}
            onAccept={() => act('growth_points', 'accepted')}
            onReject={() => act('growth_points', 'rejected')}
            onEdit={() => startEdit('growth_points', summary.growth_points.join('\n'))}
          />
        </div>
        {'growth_points' in edits ? (
          <EditBox
            value={edits['growth_points'] ?? ''}
            onChange={(v) => setEdits((e) => ({ ...e, growth_points: v }))}
            onSubmit={() => submitEdit('growth_points')}
          />
        ) : (
          <ol className="summary-list">
            {summary.growth_points.map((p, i) => <li key={i}>{p}</li>)}
          </ol>
        )}
      </div>

      <div className="summary-section">
        <h3>次回テーマ</h3>
        <ul className="summary-list">
          {summary.carry_over.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>

      <div className="summary-section">
        <div className="summary-section-header">
          <h3>面接官の総評</h3>
          <FeedbackActions
            state={actions['interviewer_note'] ?? null}
            editing={'interviewer_note' in edits}
            onAccept={() => act('interviewer_note', 'accepted')}
            onReject={() => act('interviewer_note', 'rejected')}
            onEdit={() => startEdit('interviewer_note', summary.interviewer_note)}
          />
        </div>
        {'interviewer_note' in edits ? (
          <EditBox
            value={edits['interviewer_note'] ?? ''}
            onChange={(v) => setEdits((e) => ({ ...e, interviewer_note: v }))}
            onSubmit={() => submitEdit('interviewer_note')}
          />
        ) : (
          <p className="summary-note">{summary.interviewer_note}</p>
        )}
      </div>
    </div>
  );
}

type FeedbackActionsProps = {
  state: FeedbackAction | null;
  editing: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEdit: () => void;
};

function FeedbackActions({ state, editing, onAccept, onReject, onEdit }: FeedbackActionsProps) {
  if (editing) return null;
  if (state === 'accepted') return <span className="fd-badge fd-badge-ok">✓ 採用</span>;
  if (state === 'rejected') return <span className="fd-badge fd-badge-danger">✗ 却下</span>;
  if (state != null && typeof state === 'object') return <span className="fd-badge fd-badge-warn">✎ 編集済</span>;

  return (
    <div className="feedback-actions">
      <button className="feedback-btn feedback-btn-accept" onClick={onAccept}>採用</button>
      <button className="feedback-btn feedback-btn-reject" onClick={onReject}>却下</button>
      <button className="feedback-btn feedback-btn-edit" onClick={onEdit}>編集</button>
    </div>
  );
}

type EditBoxProps = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
};

function EditBox({ value, onChange, onSubmit }: EditBoxProps) {
  return (
    <div className="summary-edit-box">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        style={{ width: '100%', fontFamily: 'inherit' }}
      />
      <button onClick={onSubmit} style={{ marginTop: 6 }}>確定</button>
    </div>
  );
}
