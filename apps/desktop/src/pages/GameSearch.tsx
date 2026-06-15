import { useEffect, useState } from 'react';
import {
  useGamesApi,
  type GameSearchRow,
  type ObResult,
  type RelatedCompany,
  type RelatedResult,
} from '../api/games.js';
import { GameGraph } from './GameGraph.js';

type ResultView = 'card' | 'graph';

const listingLabel = (m: string): string =>
  ({ prime: '一部上場', growth: 'マザーズ', standard: '二部', other: '上場' } as Record<string, string>)[m] ?? '';

function ObBreakdown({ ob }: { ob: ObResult }) {
  const { summary } = ob;
  if (summary.total === 0) {
    return <div className="company-card-desc">OB 就職実績データはまだありません。</div>;
  }
  return (
    <div className="company-card-desc company-ob-detail">
      <div>OB 就職者 累計 <strong>{summary.total}名</strong> ({summary.cells}区分)</div>
      {summary.by_year.length > 0 && (
        <div>年別: {summary.by_year.map((y) => `${y.join_year || '不明'}年 ${y.headcount}名`).join(' / ')}</div>
      )}
      {summary.by_role.length > 0 && (
        <div>職種別: {summary.by_role.map((r) => `${r.role} ${r.headcount}名`).join(' / ')}</div>
      )}
      {summary.by_class.length > 0 && (
        <div>クラス別: {summary.by_class.map((k) => `${k.class_name} ${k.headcount}名`).join(' / ')}</div>
      )}
    </div>
  );
}

function CompanyCard({ c }: { c: RelatedCompany }) {
  const api = useGamesApi();
  const size = c.employee_count > 0 ? `${c.employee_count}名` : '規模不明';
  const [ob, setOb] = useState<ObResult | null>(null);
  const [obOpen, setObOpen] = useState(false);
  const [obBusy, setObBusy] = useState(false);

  const toggleOb = async () => {
    const next = !obOpen;
    setObOpen(next);
    if (next && !ob && !obBusy) {
      setObBusy(true);
      try {
        setOb(await api.ob(c.id));
      } catch {
        /* OB 取得失敗は無視 (任意データ) */
      } finally {
        setObBusy(false);
      }
    }
  };

  return (
    <div className="card company-card">
      <div className="company-card-head">
        <span className="company-card-name">{c.name}</span>
      </div>
      <div className="company-card-badges">
        <span className="fd-chip">{c.is_smb ? '中小' : '大手'}</span>
        <span className="fd-chip">{size}</span>
        {listingLabel(c.listing_market) && <span className="fd-chip">{listingLabel(c.listing_market)}</span>}
        {c.is_social && <span className="fd-chip">ソシャゲ</span>}
        {c.is_newgrad && <span className="fd-chip">新卒採用</span>}
        {c.has_opening && <span className="fd-chip">募集中</span>}
        {c.ob_total > 0 && (
          <button className="fd-chip ob" onClick={() => void toggleOb()}>
            OB {c.ob_total}名{obOpen ? ' ▲' : ' ▼'}
          </button>
        )}
        {c.relation === 'direct' && c.role && <span className="fd-chip">{c.role}</span>}
      </div>
      {obOpen && (obBusy ? <div className="company-card-desc">OB 集計 読み込み中…</div> : ob && <ObBreakdown ob={ob} />)}
      {c.tech && c.tech.length > 0 && (
        <div className="company-card-badges">
          {c.tech.slice(0, 8).map((t) => (
            <span key={t} className="fd-chip tech">{t}</span>
          ))}
        </div>
      )}
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
  const [filters, setFilters] = useState({ smb: false, newgrad: false, opening: false, social: false });
  const [engine, setEngine] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<ResultView>('card');
  const [graphPick, setGraphPick] = useState<RelatedCompany | null>(null);

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

  const loadRelated = async (game: GameSearchRow, f = filters, eng = engine) => {
    setSelected(game);
    setBusy(true);
    setError(null);
    setGraphPick(null);
    try {
      setResult(await api.related(game.id, { ...f, engine: eng || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得失敗');
    } finally {
      setBusy(false);
    }
  };

  const toggleFilter = (k: keyof typeof filters) => {
    const next = { ...filters, [k]: !filters[k] };
    setFilters(next);
    if (selected) void loadRelated(selected, next, engine);
  };

  const toggleEngine = (e: string) => {
    const next = engine === e ? '' : e;
    setEngine(next);
    if (selected) void loadRelated(selected, filters, next);
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

      {!selected && q.trim() !== '' && games.length > 0 && (
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

      {!selected && q.trim() !== '' && games.length === 0 && (
        <p className="company-suggest-count">「{q.trim()}」に一致するゲームが見つかりません。</p>
      )}

      {/* トップ (未検索) の空白を埋める導線。 グラフ領域と誤認させないための初期表示。 */}
      {!selected && q.trim() === '' && (
        <div className="game-search-empty">
          <p className="game-search-empty-lead">
            ゲーム名を入力すると、 そのゲームに関わった会社と、 共作・同シリーズ・取引でつながる会社をたどれます。
          </p>
          <div className="game-search-examples">
            <span className="game-search-examples-label">例:</span>
            {['ファイナルファンタジー', 'ドラゴンクエスト', 'モンスターハンター', 'ポケットモンスター'].map((title) => (
              <button key={title} type="button" className="fd-chip" onClick={() => setQ(title)}>
                {title}
              </button>
            ))}
          </div>
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
            <button className={filters.social ? 'fd-chip active' : 'fd-chip'} onClick={() => toggleFilter('social')}>
              ソシャゲ
            </button>
            <button className={engine === 'Unity' ? 'fd-chip active' : 'fd-chip'} onClick={() => toggleEngine('Unity')}>
              Unity
            </button>
            <button className={engine === 'Unreal' ? 'fd-chip active' : 'fd-chip'} onClick={() => toggleEngine('Unreal')}>
              Unreal
            </button>
            <button className={engine === 'C++' ? 'fd-chip active' : 'fd-chip'} onClick={() => toggleEngine('C++')}>
              C++
            </button>
          </div>

          {busy && <p className="company-suggest-count">読み込み中…</p>}

          {result && (
            <>
              <div className="fd-tabs game-view-toggle">
                <button className={view === 'card' ? 'fd-tab active' : 'fd-tab'} onClick={() => setView('card')}>
                  カード
                </button>
                <button className={view === 'graph' ? 'fd-tab active' : 'fd-tab'} onClick={() => setView('graph')}>
                  グラフ
                </button>
              </div>

              {view === 'graph' ? (
                <div className="game-graph-layout">
                  <GameGraph
                    result={result}
                    selectedId={graphPick ? `${graphPick.relation}-${graphPick.id}` : null}
                    onSelect={setGraphPick}
                  />
                  {graphPick && (
                    <aside className="game-graph-detail">
                      <CompanyCard c={graphPick} />
                    </aside>
                  )}
                </div>
              ) : (
                <>
                  <h3>このゲームに直接関わった会社 ({result.direct.length})</h3>
                  <div className="company-grid">
                    {result.direct.map((c) => (
                      <CompanyCard key={`d-${c.id}`} c={c} />
                    ))}
                  </div>

                  <h3>作り手と他作品を共作した会社 ({result.related.length})</h3>
                  {result.related.length === 0 ? (
                    <p className="company-suggest-count">共作ネットワークはまだ見つかりません (データ拡充で増えます)。</p>
                  ) : (
                    <div className="company-grid">
                      {result.related.map((c) => (
                        <CompanyCard key={`r-${c.id}`} c={c} />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
