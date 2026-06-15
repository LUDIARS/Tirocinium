import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useGamesApi, type RelatedCompany, type RelatedResult } from '../api/games.js';
import { GameGraph } from './GameGraph.js';
import { CompanyCard } from './CompanyCard.js';
import {
  gameMetaCache,
  getRelated,
  relatedKey,
  relatedState,
  setRelated,
  type GameFilters,
  type ResultView,
} from './gameSearchCache.js';

const FILTER_CHIPS: { key: keyof Omit<GameFilters, 'engine'>; label: string }[] = [
  { key: 'smb', label: '中小のみ' },
  { key: 'newgrad', label: '新卒採用' },
  { key: 'opening', label: '募集中' },
  { key: 'social', label: 'ソシャゲ' },
];
const ENGINE_CHIPS = ['Unity', 'Unreal', 'C++'];

/**
 * 関連会社ページ (/game-search/:gameId)。 ゲームに関わった会社をカード/グラフで表示する。
 * 結果は gameId × フィルタ ごとにキャッシュし、 既出の組み合わせは再フェッチせず即描画する。
 */
export function GameRelated() {
  const { gameId } = useParams<{ gameId: string }>();
  const api = useGamesApi();
  const [filters, setFilters] = useState<GameFilters>(() => ({ ...relatedState.filters }));
  const [view, setView] = useState<ResultView>(() => relatedState.view);
  const [result, setResult] = useState<RelatedResult | null>(() =>
    gameId ? getRelated(relatedKey(gameId, relatedState.filters)) ?? null : null,
  );
  const [graphPick, setGraphPick] = useState<RelatedCompany | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // フィルタ / ビュー選択をキャッシュへ反映 (別ゲームを開いても踏襲)。
  useEffect(() => {
    relatedState.filters = filters;
  }, [filters]);
  useEffect(() => {
    relatedState.view = view;
  }, [view]);

  // gameId / filters 変化で取得。 キャッシュ済みなら即反映 (フェッチしない)。
  useEffect(() => {
    if (!gameId) return;
    const key = relatedKey(gameId, filters);
    const cached = getRelated(key);
    setGraphPick(null);
    if (cached) {
      setResult(cached);
      setBusy(false);
      setError(null);
      return;
    }
    let alive = true;
    setBusy(true);
    setError(null);
    api
      .related(gameId, { ...filters, engine: filters.engine || undefined })
      .then((r) => {
        if (!alive) return;
        setRelated(key, r);
        setResult(r);
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : '取得失敗');
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, filters]);

  const toggleFilter = (k: keyof Omit<GameFilters, 'engine'>) =>
    setFilters((f) => ({ ...f, [k]: !f[k] }));
  const toggleEngine = (e: string) =>
    setFilters((f) => ({ ...f, engine: f.engine === e ? '' : e }));

  const title = result?.game?.title ?? (gameId ? gameMetaCache.get(gameId)?.title : undefined) ?? 'ゲーム';

  return (
    <div className="game-search">
      <div className="company-suggest-head">
        <strong>{title}</strong> の関連会社
        <Link className="fd-btn-secondary" to="/game-search">
          ← 別のゲーム
        </Link>
      </div>

      <div className="fd-tabs">
        {FILTER_CHIPS.map((f) => (
          <button
            key={f.key}
            className={filters[f.key] ? 'fd-chip active' : 'fd-chip'}
            onClick={() => toggleFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        {ENGINE_CHIPS.map((e) => (
          <button
            key={e}
            className={filters.engine === e ? 'fd-chip active' : 'fd-chip'}
            onClick={() => toggleEngine(e)}
          >
            {e}
          </button>
        ))}
      </div>

      {error && <p className="company-suggest-count">⚠ {error}</p>}
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
  );
}
