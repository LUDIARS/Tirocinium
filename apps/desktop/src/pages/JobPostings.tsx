import { useEffect, useState, type ReactNode } from 'react';
import { useCompaniesApi, type JobPosting, type ListingSource } from '../api/companies.js';
import { tracker } from '../analytics/tracker.js';

// 求人ニュース (ゲーム業界の新着求人) を一覧表示するページ。
// data/companies/news-sources.json の rss / job-listing ソースをクロールして集めた job_postings を出す。

function fmtDate(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function JobPostings() {
  const api = useCompaniesApi();
  const [postings, setPostings] = useState<JobPosting[]>([]);
  const [total, setTotal] = useState(0);
  const [sources, setSources] = useState<ListingSource[]>([]);
  const [activeSource, setActiveSource] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async (source = activeSource) => {
    try {
      const r = await api.jobPostings({ source: source || undefined, limit: 200 });
      setPostings(r.postings);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    }
  };

  useEffect(() => {
    void reload(activeSource);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSource]);

  useEffect(() => {
    void api.jobSources().then((r) => setSources(r.sources)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchNew = () => {
    setBusy('crawl');
    setError(null);
    setNote(null);
    api
      .crawlJobNews({ source: activeSource || undefined })
      .then(async (r) => {
        const s = r.summary;
        setNote(
          `取得: ${s.fetched} ソース / 抽出 ${s.discovered} 件 / 新着 ${s.inserted} 件` +
            (s.notified > 0 ? ` / 通知 ${s.notified} 件` : '') +
            (s.errors.length > 0 ? ` / エラー ${s.errors.length}` : ''),
        );
        await reload();
      })
      .catch((e) => setError(e instanceof Error ? e.message : '取得に失敗しました'))
      .finally(() => setBusy(null));
  };

  const activeSourceIds = sources.filter((s) => s.active).map((s) => s.id);

  return (
    <div>
      <h2>新規求人</h2>
      <p style={{ fontSize: 13, color: 'var(--c-subtle)', marginTop: 0 }}>
        ゲーム業界ニュース系サイトから採用・求人情報をクロールし、 新着を集めています。
        「新着を取得」 で最新を取り込みます。
      </p>

      {error && <p style={{ color: '#c62828' }}>{error}</p>}
      {note && <p style={{ color: '#2e7d32' }}>{note}</p>}

      <div className="card">
        <div className="company-list-head" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>
            新着求人 ({postings.length !== total ? `${postings.length} / ${total}` : total})
          </h3>
          <button onClick={fetchNew} disabled={busy !== null}>
            {busy === 'crawl' ? '取得中…' : '新着を取得'}
          </button>
        </div>

        {sources.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
            <button
              className={`fd-chip ${activeSource === '' ? 'active' : ''}`}
              onClick={() => setActiveSource('')}
            >
              すべて
            </button>
            {sources.map((s) => (
              <button
                key={s.id}
                className={`fd-chip ${activeSource === s.id ? 'active' : ''}`}
                onClick={() => setActiveSource(s.id)}
                title={s.note}
                style={{ opacity: s.active ? 1 : 0.5 }}
              >
                {s.id}
                {!s.active && ' (停止)'}
              </button>
            ))}
          </div>
        )}

        {sources.length > 0 && activeSourceIds.length === 0 && (
          <p style={{ fontSize: 12, color: 'var(--c-subtle)' }}>
            有効なソースがありません。 news-sources.json で enabled、 もしくは COMPANY_JOB_NEWS_OPTIN_SOURCES で有効化してください。
          </p>
        )}

        {postings.length === 0 ? (
          <p>まだ求人がありません。 「新着を取得」 で取り込んでください。</p>
        ) : (
          <div className="company-grid">
            {postings.map((p) => (
              <div key={p.id} className="company-card">
                <div className="company-card-head">
                  <span className="company-card-name">
                    {p.company_name ? `${p.company_name} — ` : ''}
                    {p.title}
                  </span>
                </div>
                <div className="company-card-badges">
                  <Badge color={p.kind === 'job-listing' ? '#2e7d32' : '#1565c0'}>
                    {p.kind === 'job-listing' ? '求人' : 'ニュース'}
                  </Badge>
                  {p.role && <Badge color="#5e35b1">{p.role}</Badge>}
                  {p.employment_type && <Badge color="#37474f">{p.employment_type}</Badge>}
                  <Badge color="#90a4ae">{p.source}</Badge>
                </div>
                {p.snippet && <div className="company-card-desc">{p.snippet}</div>}
                <div className="company-card-meta">
                  {p.location && <span>{p.location} · </span>}
                  {p.deadline && <span>締切: {p.deadline} · </span>}
                  {(p.posted_at || p.first_seen_at) && (
                    <span>{fmtDate(p.posted_at || p.first_seen_at)} 掲載</span>
                  )}
                </div>
                <div className="company-card-actions">
                  {p.url && (
                    <a
                      className="fd-link-btn"
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => void tracker.pageView(`/jobs/open/${p.source}`)}
                    >
                      詳細 ↗
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{ background: color, color: '#fff', borderRadius: 4, padding: '1px 6px' }}>{children}</span>
  );
}
