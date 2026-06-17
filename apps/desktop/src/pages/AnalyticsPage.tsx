import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { fetchJson } from '../api/client.js';
import { SERVER_URL } from '../config.js';

type DailySummary = {
  date: string;
  total_events: number;
  unique_ips: number;
  page_views: { path: string; views: number }[];
  top_companies: { entity_id: string; entity_name: string; views: number }[];
  browsers: { browser: string; count: number }[];
};

type DailyTrend = { date: string; total: number; unique_ips: number };

const PATH_LABEL: Record<string, string> = {
  '/': 'ホーム',
  '/companies': '企業プール',
  '/game-search': '関連会社さがし',
  '/map': '企業マップ',
  '/recommend': 'おすすめ企業',
  '/reference': '参考リンク',
  '/ob-messages': '卒業生メッセージ',
};

function Bar({ value, max, color = 'var(--c-accent)' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
      <div style={{ flex: 1, height: 8, background: 'var(--c-muted)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.3s' }} />
      </div>
      <span style={{ minWidth: 28, textAlign: 'right', fontSize: '0.85rem' }}>{value}</span>
    </div>
  );
}

export function AnalyticsPage() {
  const { token } = useAuth();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [trend, setTrend] = useState<DailyTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchJson<DailySummary>(`${SERVER_URL}/api/v1/analytics/daily?date=${date}`, token),
      fetchJson<{ trend: DailyTrend[] }>(`${SERVER_URL}/api/v1/analytics/trend?days=14`, token),
    ])
      .then(([s, t]) => { setSummary(s); setTrend(t.trend); })
      .catch((e) => setError(e instanceof Error ? e.message : '読み込み失敗'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const maxPageView = summary ? Math.max(...summary.page_views.map((p) => p.views), 1) : 1;
  const maxCompany = summary ? Math.max(...summary.top_companies.map((c) => c.views), 1) : 1;
  const maxBrowser = summary ? Math.max(...summary.browsers.map((b) => b.count), 1) : 1;
  const trendMax = Math.max(...trend.map((t) => t.total), 1);

  return (
    <div>
      <h2>アクセス解析</h2>

      {error && <p style={{ color: 'var(--c-danger)' }}>{error}</p>}

      {/* 直近14日トレンド */}
      {trend.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 12px' }}>直近 14 日間のアクセス推移</h3>
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 80, overflowX: 'auto' }}>
            {trend.map((t) => {
              const h = Math.max(4, Math.round((t.total / trendMax) * 72));
              const isSelected = t.date === date;
              return (
                <button
                  key={t.date}
                  title={`${t.date}: ${t.total}件 / ユニーク${t.unique_ips}IP`}
                  onClick={() => setDate(t.date)}
                  style={{
                    flex: '1 0 20px',
                    height: h,
                    background: isSelected ? 'var(--c-accent)' : 'var(--c-muted)',
                    border: isSelected ? '2px solid var(--c-accent)' : '1px solid var(--c-border)',
                    borderRadius: 4,
                    cursor: 'pointer',
                    minWidth: 20,
                    alignSelf: 'flex-end',
                    padding: 0,
                  }}
                />
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 4, overflowX: 'auto' }}>
            {trend.map((t) => (
              <span key={t.date} style={{ flex: '1 0 20px', fontSize: '0.65rem', color: 'var(--c-subtle)', textAlign: 'center', minWidth: 20, whiteSpace: 'nowrap' }}>
                {t.date.slice(5)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 日付選択 + サマリ */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          style={{ width: 'auto' }}
        />
        <span style={{ fontSize: '0.85rem', color: 'var(--c-subtle)' }}>の統計</span>
      </div>

      {loading && <p style={{ color: 'var(--c-subtle)' }}>読み込み中…</p>}

      {summary && !loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>

          {/* KPI */}
          <div className="card" style={{ gridColumn: '1 / -1', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '2rem', fontWeight: 700 }}>{summary.total_events}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--c-subtle)' }}>総イベント数</div>
            </div>
            <div>
              <div style={{ fontSize: '2rem', fontWeight: 700 }}>{summary.unique_ips}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--c-subtle)' }}>ユニーク IP</div>
            </div>
            <div>
              <div style={{ fontSize: '2rem', fontWeight: 700 }}>
                {summary.page_views.reduce((s, p) => s + p.views, 0)}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--c-subtle)' }}>ページビュー</div>
            </div>
            <div>
              <div style={{ fontSize: '2rem', fontWeight: 700 }}>
                {summary.top_companies.reduce((s, c) => s + c.views, 0)}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--c-subtle)' }}>企業ビュー</div>
            </div>
          </div>

          {/* ページ別 */}
          <div className="card">
            <h3 style={{ margin: '0 0 12px' }}>ページ別アクセス</h3>
            {summary.page_views.length === 0 ? (
              <p style={{ color: 'var(--c-subtle)', fontSize: '0.9rem' }}>データなし</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {summary.page_views.map((p) => (
                  <div key={p.path} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ minWidth: 120, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {PATH_LABEL[p.path] ?? p.path}
                    </span>
                    <Bar value={p.views} max={maxPageView} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ブラウザ */}
          <div className="card">
            <h3 style={{ margin: '0 0 12px' }}>ブラウザ</h3>
            {summary.browsers.length === 0 ? (
              <p style={{ color: 'var(--c-subtle)', fontSize: '0.9rem' }}>データなし</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {summary.browsers.map((b) => (
                  <div key={b.browser} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ minWidth: 80, fontSize: '0.85rem' }}>{b.browser}</span>
                    <Bar value={b.count} max={maxBrowser} color="var(--c-ok)" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 企業ランキング */}
          {summary.top_companies.length > 0 && (
            <div className="card" style={{ gridColumn: '1 / -1' }}>
              <h3 style={{ margin: '0 0 12px' }}>よく見られた企業 Top {Math.min(summary.top_companies.length, 20)}</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {summary.top_companies.map((c, i) => (
                  <div key={c.entity_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ minWidth: 24, fontSize: '0.8rem', color: 'var(--c-subtle)', textAlign: 'right' }}>
                      {i + 1}
                    </span>
                    <span style={{ minWidth: 200, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.entity_name}
                    </span>
                    <Bar value={c.views} max={maxCompany} color="#8b5cf6" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.total_events === 0 && (
            <div className="card" style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--c-subtle)', padding: '32px 0' }}>
              {date} のアクセスデータはありません
            </div>
          )}
        </div>
      )}
    </div>
  );
}
