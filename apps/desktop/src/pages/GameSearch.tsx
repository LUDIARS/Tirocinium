import { useEffect, useState } from 'react';
import { useGamesApi, type GameSearchRow, type RelatedCompany, type RelatedResult } from '../api/games.js';

const listingLabel = (m: string): string =>
  ({ prime: '一部上場', growth: 'マザーズ', standard: '二部', other: '上場' } as Record<string, string>)[m] ?? '';

function CompanyCard({ c }: { c: RelatedCompany }) {
  const size = c.employee_count > 0 ? `${c.employee_count}名` : '規模不明';
  return (
    <div className="card company-card">
      <div className="company-card-head">
        <span className="company-card-name">{c.name}</span>
      </div>
      <div className="company-card-badges">
        <span className="fd-chip">{c.is_smb ? '中小' : '大手'}</span>
        <span className="fd-chip">{size}</span>
        {listingLabel(c.listing_market) && <span className="fd-chip">{listingLabel(c.listing_market)}</span>}
        {c.is_newgrad && <span className="fd-chip">新卒採用</span>}
        {c.has_opening && <span className="fd-chip">募集中</span>}
        {c.relation === 'direct' && c.role && <span className="fd-chip">{c.role}</span>}
      </div>
      {c.relation === 'related' && c.via_titles && c.via_titles.length > 0 && (
        <div className="company-card-desc">
          つながり {c.shared_games}: {c.via_titles.join(' / ')}
        </div>
      )}
      <div className="company-card-meta">{c.location || '所在地不明'}</div>
      <div className="company-card-actions">
        {c.url && (
          <a className="fd-link-btn" href={c.url} target="_blank" rel="noreferrer">
            会社サイト
          </a>
        )}
        {c.recruit_url && (
          <a className="fd-link-btn" href={c.recruit_url} target="_blank" rel="noreferrer">
            採用ページ
          </a>
        )}
      </div>
    </div>
  );
}

export function GameSearch() {
  const api = useGamesApi();
  const [q, setQ] = useState('');
  const [games, setGames] = useState<GameSearchRow[]>([]);
  const [selected, setSelected] = useState<GameSearchRow | null>(null);
  const [result, setResult] = useState<RelatedResult | null>(null);
  const [filters, setFilters] = useState({ smb: false, newgrad: false, opening: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 検索 (デバウンス)
  useEffect(() => {
    if (!q.trim()) {
      setGames([]);
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        setError(null);
        const r = await api.search(q);
        setGames(r.games);
      } catch (e) {
        setError(e instanceof Error ? e.message : '検索失敗');
      }
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const loadRelated = async (game: GameSearchRow, f = filters) => {
    setSelected(game);
    setBusy(true);
    setError(null);
    try {
      setResult(await api.related(game.id, f));
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得失敗');
    } finally {
      setBusy(false);
    }
  };

  const toggleFilter = (k: keyof typeof filters) => {
    const next = { ...filters, [k]: !filters[k] };
    setFilters(next);
    if (selected) void loadRelated(selected, next);
  };

  return (
    <div className="game-search">
      <h2>関連会社さがし</h2>
      <p className="company-suggest-count">
        作りたい / 関わりたいゲームから、 開発に関わった会社とその共作ネットワークをたどります。
      </p>

      <input
        className="company-search"
        placeholder="ゲーム名で検索 (例: ファイナルファンタジー)"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {error && <div className="company-suggest-count">⚠ {error}</div>}

      {!selected && games.length > 0 && (
        <div className="company-suggest">
          {games.map((g) => (
            <button key={g.id} className="company-suggest-item" onClick={() => void loadRelated(g)}>
              <span>
                {g.title}
                {g.release_year > 0 ? ` (${g.release_year})` : ''}
              </span>
              <span className="company-suggest-count">{g.company_count}社</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div>
          <div className="company-suggest-head">
            <strong>{selected.title}</strong> の関連会社
            <button className="fd-btn-secondary" onClick={() => { setSelected(null); setResult(null); }}>
              ← 別のゲーム
            </button>
          </div>

          <div className="fd-tabs">
            <button className={filters.smb ? 'fd-chip active' : 'fd-chip'} onClick={() => toggleFilter('smb')}>
              中小のみ
            </button>
            <button className={filters.newgrad ? 'fd-chip active' : 'fd-chip'} onClick={() => toggleFilter('newgrad')}>
              新卒採用
            </button>
            <button className={filters.opening ? 'fd-chip active' : 'fd-chip'} onClick={() => toggleFilter('opening')}>
              募集中
            </button>
          </div>

          {busy && <p className="company-suggest-count">読み込み中…</p>}

          {result && (
            <>
              <h3>このゲームに直接関わった会社 ({result.direct.length})</h3>
              <div className="company-grid">
                {result.direct.map((c) => (
                  <CompanyCard key={`d-${c.id}`} c={c} />
                ))}
              </div>

              <h3>関連する会社 — 共作 / 同シリーズ / 取引先 ({result.related.length})</h3>
              {result.related.length === 0 ? (
                <p className="company-suggest-count">関連ネットワークはまだ見つかりません (データ拡充で増えます)。</p>
              ) : (
                <div className="company-grid">
                  {result.related.map((c) => (
                    <CompanyCard key={`r-${c.id}`} c={c} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
