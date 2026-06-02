import { useEffect, useState } from 'react';
import { useTrainingApi, type TrainingKind, type TrainingRef } from '../api/training.js';

const KIND_LABEL: Record<TrainingKind, string> = {
  es: 'ES / 履歴書',
  portfolio: 'ポートフォリオ',
  past_qa: '過去の面接 Q&A',
  self_intro: '自己紹介',
};

export function TrainingData() {
  const api = useTrainingApi();
  const [refs, setRefs] = useState<TrainingRef[]>([]);
  const [kind, setKind] = useState<TrainingKind>('es');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    try {
      const r = await api.list();
      setRefs(r.refs);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.add({
        kind,
        body: body.trim(),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setBody('');
      setTags('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '登録失敗');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.remove(id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除失敗');
    }
  };

  return (
    <div>
      <h2>学習データ (本人特化)</h2>
      <p style={{ fontSize: 13, opacity: 0.8 }}>
        ES / ポートフォリオ / 過去 Q&A を登録すると、面接 AI が RAG で参照します。
        本文は Memoria に保管され、ここには参照のみ残ります (MEMORIA_URL 未設定時は参照だけ作成)。
      </p>

      <div className="foundation-form card">
        <label>
          種別
          <select value={kind} onChange={(e) => setKind(e.target.value as TrainingKind)}>
            {(Object.keys(KIND_LABEL) as TrainingKind[]).map((k) => (
              <option key={k} value={k}>{KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label>
          本文
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            placeholder="ES や自己PR、過去の問答などを貼り付け"
          />
        </label>
        <label>
          タグ (カンマ区切り、任意)
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="志望企業, 強み, ..." />
        </label>
        <button onClick={add} disabled={busy || !body.trim()}>登録</button>
        {error && <p style={{ color: '#c62828' }}>{error}</p>}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>登録済み ({refs.length})</h3>
        {refs.length === 0 && <p>まだ登録がありません</p>}
        {refs.map((r) => (
          <div
            key={r.id}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,0.08)' }}
          >
            <div>
              <strong>{KIND_LABEL[r.kind]}</strong>
              {r.tags.length > 0 && <span style={{ fontSize: 12, opacity: 0.7 }}> — {r.tags.join(', ')}</span>}
              <div style={{ fontSize: 11, opacity: 0.55, fontFamily: 'monospace' }}>{r.memoria_uri}</div>
            </div>
            <button onClick={() => remove(r.id)}>削除</button>
          </div>
        ))}
      </div>
    </div>
  );
}
