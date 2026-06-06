import { useState } from 'react';
import { useRecommendApi, type Recommendation } from '../api/recommend.js';

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '指定なし' },
  { value: 'planner', label: '企画 / プランナー' },
  { value: 'programmer', label: 'プログラマ / エンジニア' },
  { value: 'designer', label: 'デザイナー' },
  { value: 'sound', label: 'サウンド' },
];

export function Recommend() {
  const api = useRecommendApi();
  const [role, setRole] = useState('');
  const [targetCompany, setTargetCompany] = useState('');
  const [tags, setTags] = useState('');
  const [esText, setEsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Recommendation | null>(null);
  const [method, setMethod] = useState<'llm' | 'heuristic' | null>(null);
  const [hasEs, setHasEs] = useState(true);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.run({
        target_role: role || undefined,
        target_company: targetCompany.trim() || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        es_text: esText.trim() || undefined,
      });
      setResult(res.recommendation);
      setMethod(res.method);
      setHasEs(res.has_es_material);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'おすすめ生成に失敗しました');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>おすすめ企業 (ES から)</h2>
      <p style={{ fontSize: 13, opacity: 0.8 }}>
        ES / ポートフォリオの内容と希望条件から、クロール済みの企業プールに対して適合度の高い企業を提案します。
        ES 本文はここに貼っても保存されません (生成時のみ利用)。未入力なら登録済み学習データ (Memoria) を参照します。
      </p>

      <div className="foundation-form card">
        <label>
          志望職種
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label>
          志望企業 / 業界 (任意)
          <input
            value={targetCompany}
            onChange={(e) => setTargetCompany(e.target.value)}
            placeholder="ゲーム業界 / 〇〇社 など"
          />
        </label>
        <label>
          興味タグ (カンマ区切り、任意)
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Unity, C#, 自社開発" />
        </label>
        <label>
          ES / 自己PR (任意、保存されません)
          <textarea
            value={esText}
            onChange={(e) => setEsText(e.target.value)}
            rows={6}
            placeholder="登録済み学習データを使う場合は空欄でOK"
          />
        </label>
        <button onClick={run} disabled={busy}>
          {busy ? '生成中…' : 'おすすめを生成'}
        </button>
        {error && <p style={{ color: '#c62828' }}>{error}</p>}
      </div>

      {result && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>
            結果 ({result.items.length} 件)
            <span style={{ fontSize: 12, opacity: 0.6, marginLeft: 8 }}>
              [{method === 'llm' ? `AI: ${result.model}` : 'ヒューリスティック'}]
            </span>
          </h3>
          {!hasEs && (
            <p style={{ fontSize: 12, color: '#b26a00' }}>
              ※ ES 素材が見つからなかったため、職種・タグのみで推定しています。学習データを登録すると精度が上がります。
            </p>
          )}
          {result.items.length === 0 && (
            <p>該当企業がありません。先に「企業プール」でクロールしてください。</p>
          )}
          {result.items.map((it) => (
            <div
              key={it.company_id}
              style={{ padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.08)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong>{it.name}</strong>
                <span style={{ fontSize: 13, opacity: 0.7 }}>適合度 {it.score}</span>
              </div>
              {it.reasons.length > 0 && (
                <ul style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13 }}>
                  {it.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
              {it.concerns.length > 0 && (
                <div style={{ fontSize: 12, color: '#b26a00' }}>
                  懸念: {it.concerns.join(' / ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
