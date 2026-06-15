import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGamesApi, type GameSearchRow } from '../api/games.js';
import { gameMetaCache, searchState } from './gameSearchCache.js';

/**
 * ゲーム検索ページ (関連会社さがしの入口)。 入力 + 一致ゲーム一覧のみを表示し、
 * ゲームを選ぶと `/game-search/:gameId` の関連会社ページへ遷移する。
 * 検索状態は searchState にキャッシュし、 復帰時は再フェッチせず即描画する。
 */
export function GameSearchList() {
  const api = useGamesApi();
  const navigate = useNavigate();
  const [q, setQ] = useState(searchState.q);
  const [games, setGames] = useState<GameSearchRow[]>(searchState.games);
  const [error, setError] = useState<string | null>(null);

  // 入力・結果をキャッシュへ反映 (ページ復帰時の復元用)。
  useEffect(() => {
    searchState.q = q;
  }, [q]);
  useEffect(() => {
    searchState.games = games;
  }, [games]);

  // 検索 (デバウンス)。 直近検索済みクエリと同じなら再フェッチしない。
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setGames([]);
      return;
    }
    if (term === searchState.lastQ && searchState.games.length > 0) {
      return;
    }
    const t = window.setTimeout(async () => {
      try {
        setError(null);
        const r = await api.search(term);
        searchState.lastQ = term;
        setGames(r.games);
      } catch (e) {
        setError(e instanceof Error ? e.message : '検索失敗');
      }
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const pick = (g: GameSearchRow) => {
    gameMetaCache.set(g.id, g);
    navigate(`/game-search/${g.id}`);
  };

  const term = q.trim();

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

      {term !== '' && games.length > 0 && (
        <ul className="game-list">
          {games.map((g) => (
            <li key={g.id}>
              <button className="company-suggest-item" onClick={() => pick(g)}>
                <span>
                  {g.title}
                  {g.release_year > 0 ? ` (${g.release_year})` : ''}
                </span>
                <span className="company-suggest-count">{g.company_count}社</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {term !== '' && games.length === 0 && (
        <p className="company-suggest-count">「{term}」に一致するゲームが見つかりません。</p>
      )}

      {/* 未検索時の導線 (空白埋め)。 */}
      {term === '' && (
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
    </div>
  );
}
