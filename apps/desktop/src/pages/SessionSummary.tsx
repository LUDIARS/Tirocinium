import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useSessionApi } from '../api/sessions.js';
import { SummaryView } from '../components/summary/SummaryView.js';
import type { Summary, FeedbackAction } from '../types/session.js';

export function SessionSummary() {
  const { id = '' } = useParams();
  const api = useSessionApi();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    api
      .getSummary(id)
      .then((r) => alive && setSummary((r.summary as Summary) ?? null))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const r = await api.generateSummary(id);
      setSummary((r.summary as Summary) ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const handleFeedback = async (block: string, action: FeedbackAction) => {
    try {
      await api.submitFeedback(id, block, action);
    } catch {
      // best-effort
    }
  };

  if (loading) {
    return (
      <div className="app-main">
        <p className="muted">サマリを読み込み中…</p>
      </div>
    );
  }

  return (
    <div>
      <h2>面接サマリ</h2>

      {!summary && (
        <div className="card">
          <p className="muted" style={{ marginBottom: 12 }}>
            面接が終了しました。Opus でサマリを生成します。
          </p>
          <button onClick={generate} disabled={generating}>
            {generating ? '生成中… (Opus)' : 'サマリを生成'}
          </button>
          {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
        </div>
      )}

      {summary && (
        <>
          <SummaryView summary={summary} onFeedback={handleFeedback} />
          <div className="card" style={{ marginTop: 8 }}>
            <button className="fd-btn-secondary" onClick={generate} disabled={generating}>
              {generating ? '再生成中…' : '再生成'}
            </button>
            {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
          </div>
        </>
      )}
    </div>
  );
}
