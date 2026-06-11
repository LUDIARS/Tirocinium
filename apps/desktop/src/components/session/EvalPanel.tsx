import type { Evaluation } from '../../types/session.js';

type Props = {
  evaluation: Evaluation | null;
};

const SCORE_COLORS = ['var(--c-danger)', 'var(--c-danger)', 'var(--c-warn)', 'var(--c-warn)', 'var(--c-ok)', 'var(--c-ok)'];

export function EvalPanel({ evaluation }: Props) {
  if (!evaluation) {
    return (
      <div className="eval-panel card">
        <h3 className="eval-panel-title">評価</h3>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          評価は数ターン後に届きます
        </p>
      </div>
    );
  }

  return (
    <div className="eval-panel card">
      <h3 className="eval-panel-title">
        評価
        {evaluation.turn_no != null && (
          <span className="muted" style={{ fontWeight: 400, marginLeft: 6, fontSize: '0.8rem' }}>
            turn {evaluation.turn_no}
          </span>
        )}
      </h3>

      <div className="eval-axes">
        {evaluation.axes.map((ax) => {
          const pct = Math.round((ax.score / 5) * 100);
          const color = SCORE_COLORS[Math.min(ax.score, 5)];
          return (
            <div key={ax.axis} className="eval-axis">
              <div className="eval-axis-header">
                <span className="eval-axis-name">{ax.axis}</span>
                <span className="eval-axis-score" style={{ color }}>{ax.score}/5</span>
              </div>
              <div className="eval-axis-bar-bg">
                <div
                  className="eval-axis-bar-fill"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
              {ax.comment && (
                <p className="eval-axis-comment">{ax.comment}</p>
              )}
              {ax.hint && (
                <p className="eval-axis-hint">💡 {ax.hint}</p>
              )}
            </div>
          );
        })}
      </div>

      {evaluation.overall && (
        <p className="eval-overall">{evaluation.overall}</p>
      )}
    </div>
  );
}
