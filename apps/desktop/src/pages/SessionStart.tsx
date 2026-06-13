import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInterviewers, type Interviewer } from '../api/personas.js';
import { useSessionApi } from '../api/sessions.js';

export function SessionStart() {
  const navigate = useNavigate();
  const { data, error, loading } = useInterviewers();
  const api = useSessionApi();
  const [selected, setSelected] = useState<string>('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('programmer');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onStart = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await api.start({
        target_company: company || undefined,
        target_role: role,
        interviewer_id: selected || undefined,
      });
      if ('session_id' in r) {
        navigate(`/session/${r.session_id}`);
      } else if ('reservation_offer' in r) {
        const o = r.reservation_offer;
        alert(`サーバが混雑。 ${o.slot_start} (約 ${o.eta_min} 分後) を予約しますか?\n予約画面へ移動します。`);
        navigate('/reservation');
      } else {
        setSubmitError(JSON.stringify(r));
      }
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2>Session Start</h2>
      <div className="card">
        <label>
          志望企業 (任意):
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            style={{ marginLeft: 8, padding: 4 }}
          />
        </label>
      </div>
      <div className="card">
        <label>
          志望職種:
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ marginLeft: 8 }}>
            <option value="planner">planner</option>
            <option value="programmer">programmer</option>
            <option value="designer">designer</option>
            <option value="sound">sound</option>
          </select>
        </label>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>面接官ペルソナ</h3>
        {loading && <p>読み込み中…</p>}
        {error && <p style={{ color: '#c62828' }}>取得失敗: {error.message}</p>}
        {data && (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {data.map((p: Interviewer) => (
              <li key={p.id} style={{ marginBottom: 8 }}>
                <label style={{ display: 'flex', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="interviewer"
                    value={p.id}
                    checked={selected === p.id}
                    onChange={() => setSelected(p.id)}
                  />
                  <span>
                    <strong>{p.display_name}</strong>{' '}
                    <small>({p.stage}, pressure {p.pressure}, {p.temperament})</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <button onClick={onStart} disabled={submitting}>
          {submitting ? '開始中…' : '面接を始める'}
        </button>
        {submitError && <p style={{ color: '#c62828' }}>{submitError}</p>}
      </div>
    </div>
  );
}
