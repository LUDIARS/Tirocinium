import { useEffect, useState } from 'react';
import { useCompaniesApi, type Company, type CrawlSummary } from '../api/companies.js';

export function Companies() {
  const api = useCompaniesApi();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [sources, setSources] = useState<string[]>([]);
  const [source, setSource] = useState('manual');
  const [urls, setUrls] = useState('');
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<CrawlSummary | null>(null);

  const reload = async () => {
    try {
      const r = await api.list({ q: q.trim() || undefined });
      setCompanies(r.companies);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    }
  };

  useEffect(() => {
    void reload();
    void api.sources().then((r) => {
      setSources(r.sources);
      if (r.sources[0]) setSource(r.sources[0]);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const crawl = async () => {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const urlList = urls.split(/[\n,]/).map((u) => u.trim()).filter(Boolean);
      const res = await api.crawl({ source, urls: urlList });
      setSummary(res.summary);
      setUrls('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'クロール失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>企業プール</h2>
      <p style={{ fontSize: 13, opacity: 0.8 }}>
        企業ページをクロールして基礎情報を自動収集します。収集した企業は「おすすめ企業」のマッチング対象になります。
        企業情報は公開情報のみを保持します。
      </p>

      <div className="foundation-form card">
        <h3 style={{ marginTop: 0 }}>クロール</h3>
        <label>
          ソース
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        {source === 'manual' && (
          <label>
            URL (改行 / カンマ区切り)
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              rows={4}
              placeholder="https://example.com/recruit&#10;https://other.co.jp/about"
            />
          </label>
        )}
        {source === 'seed-file' && (
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            サーバー側の data/companies/seeds.json を読み込んでクロールします。
          </p>
        )}
        <button onClick={crawl} disabled={busy}>
          {busy ? 'クロール中…' : 'クロール実行'}
        </button>
        {error && <p style={{ color: '#c62828' }}>{error}</p>}
        {summary && (
          <p style={{ fontSize: 13 }}>
            取得 {summary.fetched} / 抽出 {summary.extracted} / 登録 {summary.upserted}
            {summary.skipped > 0 && ` / スキップ ${summary.skipped}`}
            {summary.errors.length > 0 && ` / エラー ${summary.errors.length}`}
          </p>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, flex: 1 }}>登録済み ({total})</h3>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void reload()}
            placeholder="検索"
          />
          <button onClick={() => void reload()}>検索</button>
        </div>
        {companies.length === 0 && <p>まだ企業がありません</p>}
        {companies.map((c) => (
          <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>{c.name}</strong>
              {c.industry && <span style={{ fontSize: 12, opacity: 0.7 }}>{c.industry}</span>}
            </div>
            {c.description && <div style={{ fontSize: 13, opacity: 0.85 }}>{c.description}</div>}
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {c.roles.length > 0 && <span>職種: {c.roles.join(', ')} </span>}
              {c.tags.length > 0 && <span>· {c.tags.join(', ')}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
