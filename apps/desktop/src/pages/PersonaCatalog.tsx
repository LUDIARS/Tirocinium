import { useState } from 'react';
import { useInterviewers, type Interviewer } from '../api/personas.js';

const STAGES = ['', 'hr', 'peer-tech', 'lead-tech', 'final'] as const;

export function PersonaCatalog() {
  const [stage, setStage] = useState<string>('');
  const { data, error, loading } = useInterviewers(stage ? { stage } : undefined);
  return (
    <div>
      <h2>Personas</h2>
      <div className="card">
        <label>
          stage:
          <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ marginLeft: 8 }}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s || '(全て)'}
              </option>
            ))}
          </select>
        </label>
      </div>
      {loading && <p>読み込み中…</p>}
      {error && <p style={{ color: '#c62828' }}>取得失敗: {error.message}</p>}
      {data &&
        data.map((p: Interviewer) => (
          <div key={p.id} className="card">
            <h3 style={{ marginTop: 0 }}>{p.display_name}</h3>
            <p>
              <small>
                {p.stage} / {p.role_lens} / {p.temperament} / pressure {p.pressure}
              </small>
            </p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{p.bio}</p>
          </div>
        ))}
    </div>
  );
}
