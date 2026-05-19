import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSessionApi } from '../api/sessions.js';

export function SessionSummary() {
  const { id = '' } = useParams();
  const api = useSessionApi();
  const [summary, setSummary] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    api
      .getSummary(id)
      .then((r) => alive && setSummary(r.summary ?? null))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.generateSummary(id);
      setSummary(r.summary ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Session Summary</h2>
      <p>session id: <code>{id}</code></p>
      <div className="card">
        <button onClick={generate} disabled={loading}>
          {loading ? '生成中…' : 'サマリを生成 (Opus)'}
        </button>
        {error && <p style={{ color: '#c62828' }}>{error}</p>}
      </div>
      {summary != null ? (
        <div className="card">
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(summary, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}
