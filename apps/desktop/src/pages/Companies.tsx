import { useEffect, useState, type ReactNode } from 'react';
import {
  useCompaniesApi,
  type Company,
  type CompanyProfile,
  type ContributeSummary,
  type EnrichQueueStatus,
  type NewgradRoleImage,
} from '../api/companies.js';

export function Companies() {
  const api = useCompaniesApi();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [showSuggest, setShowSuggest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [onlyGenerated, setOnlyGenerated] = useState(false);
  // 既定はノイズ (どのゲームにも未紐付け) を除外。 ユーザが明示したときだけ全件表示。
  const [showNoise, setShowNoise] = useState(false);
  // 既定は情報なし (会社概要が空) を除外。 チェック時のみ表示 (enrich 対象を見たいとき)。
  const [showNoInfo, setShowNoInfo] = useState(false);
  // 新卒採用あり / 募集中 で絞り込む (既定は両方 off = 全件、 ただし該当は優先ソートで上位に出る)。
  const [onlyNewgrad, setOnlyNewgrad] = useState(false);
  const [onlyOpening, setOnlyOpening] = useState(false);

  const [profiles, setProfiles] = useState<Record<string, CompanyProfile>>({});
  const [newgradImages, setNewgradImages] = useState<Record<string, NewgradRoleImage[]>>({});
  const [newgradModal, setNewgradModal] = useState<{ id: string; name: string } | null>(null);
  const [contributeFor, setContributeFor] = useState<{ id: string; name: string } | null>(null);
  const [queue, setQueue] = useState<EnrichQueueStatus | null>(null);

  const reload = async (query = q) => {
    try {
      const search = query.trim();
      const r = await api.list({ limit: 200, q: search || undefined, quality: !showNoise, summarized: !showNoInfo, newgrad: onlyNewgrad, opening: onlyOpening });
      setCompanies(r.companies);
      setTotal(r.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込み失敗');
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload(q);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, showNoise, showNoInfo, onlyNewgrad, onlyOpening]);

  // 自動 enrich キューの状態をポーリング (30 秒ごと)。
  useEffect(() => {
    const poll = () => { void api.enrichQueueStatus().then(setQueue).catch(() => {}); };
    poll();
    const id = window.setInterval(poll, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const wrap = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : '失敗しました');
    } finally {
      setBusy(null);
    }
  };

  const enrichAll = () =>
    wrap('enrich-all', async () => {
      const res = await api.enrich({ limit: 20 });
      setNote(`IR/理念取得: ${res.summary.enriched}/${res.summary.targets} 社`);
      await reload();
    });

  const enrichOne = (id: string) =>
    wrap(`enrich-${id}`, async () => {
      await api.enrich({ company_id: id });
      const p = await api.profile(id).catch(() => null);
      if (p) setProfiles((m) => ({ ...m, [id]: p.profile }));
      else setNote('このサイトからは IR/理念を取得できませんでした');
    });

  const loadProfile = (id: string) =>
    wrap(`profile-${id}`, async () => {
      const p = await api.profile(id);
      setProfiles((m) => ({ ...m, [id]: p.profile }));
    });

  const openNewgrad = async (id: string, name: string) => {
    setNewgradModal({ id, name });
    if (!newgradImages[id]) {
      await wrap(`newgrad-${id}`, async () => {
        const r = await api.newgrad(id);
        setNewgradImages((m) => ({ ...m, [id]: r.roles }));
      });
    }
  };

  // 生成済みデータ (IR/理念 or 新卒像) を持つ企業数。一覧で確認できるようにする。
  const profileCount = companies.filter((c) => c.has_profile).length;
  const newgradCount = companies.filter((c) => c.has_newgrad_image).length;

  // 企業ごとに「タグ語」(バッジ相当のキーワード) を導出。検索/サジェスト両方で使う。
  const tagWords = (c: Company): string[] => {
    const t: string[] = [];
    if (c.is_game) t.push('ゲーム');
    if (c.is_newgrad) t.push('新卒');
    if (c.has_opening) t.push('募集中');
    return t;
  };

  // 検索はサーバ側 q で候補を取り、表示中の role/tag 語だけクライアント側で補完する。
  const needle = q.trim().toLowerCase();
  // 社名を正規化して部分一致を緩く取る (法人格 / 記号 / 空白を落とす)。
  const nameKey = (s: string): string =>
    s.toLowerCase().replace(/株式会社|有限会社|合同会社|（株）|\(株\)/g, '').replace(/[\s　・,.，。]/g, '');
  const needleKey = nameKey(q.trim());

  // 名前優先のランク: 社名前方一致(0) > 社名部分一致(1) > 説明文/業界/タグのみ一致(2)。
  const rankOf = (c: Company): number => {
    if (!needleKey) return 0;
    const nk = nameKey(c.name);
    if (nk.startsWith(needleKey)) return 0;
    if (nk.includes(needleKey)) return 1;
    return 2;
  };

  const filtered = companies
    .filter((c) => (onlyGenerated ? c.has_profile || c.has_newgrad_image : true))
    .filter((c) => {
      if (!needle) return true;
      // 情報なし (概要空) は既定で除外 (サーバ summarized と整合)。 チェック時のみ表示。
      if (!showNoInfo && !c.description.trim()) return false;
      // 社名一致 (正規化部分一致) を最優先で拾い、 説明文/業界/タグ一致も温存 (チップ検索用)。
      const nameHit = needleKey !== '' && nameKey(c.name).includes(needleKey);
      const hay = [c.name, c.description, c.industry, ...c.roles, ...tagWords(c)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return nameHit || hay.includes(needle);
    });
  // 検索時は社名一致を上位へ (同順位はサーバ順 = updated_at を維持する安定ソート)。
  const visible = needle ? [...filtered].sort((a, b) => rankOf(a) - rankOf(b)) : filtered;

  // サジェスト候補: 登録企業に実在する 職種 / 業界 / タグ語 をユニーク化し、
  // 該当社数 (= 利用頻度) を集計する。職種は優先表示するため kind を持たせる。
  type SuggestKind = 'role' | 'industry' | 'tag';
  const suggestPool = (() => {
    const map = new Map<string, { count: number; kind: SuggestKind }>();
    const add = (raw: string | undefined, kind: SuggestKind) => {
      const tok = raw?.trim();
      if (!tok) return;
      const prev = map.get(tok);
      // 既出なら件数を加算。職種を優先したいので role の kind は上書き勝ち。
      map.set(tok, {
        count: (prev?.count ?? 0) + 1,
        kind: prev?.kind === 'role' ? 'role' : kind,
      });
    };
    for (const c of companies) {
      const seen = new Set<string>();
      const push = (raw: string | undefined, kind: SuggestKind) => {
        const tok = raw?.trim();
        if (!tok || seen.has(tok)) return;
        seen.add(tok);
        add(tok, kind);
      };
      for (const r of c.roles) push(r, 'role');
      push(c.industry, 'industry');
      for (const t of tagWords(c)) push(t, 'tag');
    }
    return map;
  })();

  const kindRank: Record<SuggestKind, number> = { role: 0, industry: 1, tag: 2 };
  const allSuggest = [...suggestPool.entries()].map(([token, v]) => ({ token, ...v }));
  const suggestions = !showSuggest
    ? []
    : needle
      ? // 入力中: 部分一致を頻度順に (オートコンプリート)
        allSuggest
          .filter((s) => {
            const low = s.token.toLowerCase();
            return low.includes(needle) && low !== needle;
          })
          .sort((a, b) => b.count - a.count)
          .slice(0, 8)
      : // 未入力でフォーカス時: よく使われるキーワードを先出し (職種優先)
        allSuggest
          .sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || b.count - a.count)
          .slice(0, 10);

  return (
    <div>
      <h2>企業プール</h2>

      {queue && (queue.pending > 0 || queue.running) && (
        <div className="enrich-queue-banner">
          {queue.running ? (
            <>
              <span className="enrich-queue-dot" />
              自動クロール稼働中 — 概要なし <strong>{queue.pending}</strong> 社を 1 分に 1 件ずつ取得しています
              {queue.lastDetail && <span className="enrich-queue-last">（直近: {queue.lastDetail}）</span>}
            </>
          ) : (
            <>
              概要なしのゲーム関連企業 <strong>{queue.pending}</strong> 社（自動クロール停止中
              {queue.disabledReason ? `: ${queue.disabledReason}` : ''}）。 各社の「情報クロール依頼 / 情報提供」から個別に追加できます。
            </>
          )}
        </div>
      )}

      {error && <p style={{ color: '#c62828' }}>{error}</p>}
      {note && <p style={{ color: '#2e7d32' }}>{note}</p>}

      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, flex: 1 }}>
            登録済み一覧 ({visible.length !== total ? `${visible.length} / ${total}` : total})
          </h3>
          <div className="company-search">
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShowSuggest(true);
              }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 120)}
              placeholder="名前 / 業界 / 職種 / タグで絞り込み"
            />
            {suggestions.length > 0 && (
              <ul className="company-suggest">
                {!needle && (
                  <li className="company-suggest-head">よく使われるキーワード</li>
                )}
                {suggestions.map((s) => (
                  <li key={s.token}>
                    <button
                      type="button"
                      className="company-suggest-item"
                      onMouseDown={(e) => {
                        // blur より先に発火させて選択を確定する。
                        e.preventDefault();
                        setQ(s.token);
                        setShowSuggest(false);
                      }}
                    >
                      <span>
                        {s.token}
                        {!needle && (
                          <span className={`company-suggest-kind kind-${s.kind}`}>
                            {s.kind === 'role' ? '職種' : s.kind === 'industry' ? '業界' : 'タグ'}
                          </span>
                        )}
                      </span>
                      <span className="company-suggest-count">{s.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={enrichAll} disabled={busy !== null}>
            {busy === 'enrich-all' ? 'IR/理念取得中…' : '未取得をIR/理念取得'}
          </button>
        </div>
        {/* 生成済みデータの俯瞰 + 絞り込み (検索とは独立) */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, fontSize: 12, opacity: 0.85, flexWrap: 'wrap' }}>
          <span>IR/理念クロール済 <strong>{profileCount}</strong> 社</span>
          <span>新卒像生成済 <strong>{newgradCount}</strong> 社</span>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={onlyGenerated} onChange={(e) => setOnlyGenerated(e.target.checked)} />
            生成済みデータがある企業のみ表示
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title="既定では会社概要のある企業のみ表示します。 チェックで概要未取得 (enrich 待ち) の企業も表示します">
            <input type="checkbox" checked={showNoInfo} onChange={(e) => setShowNoInfo(e.target.checked)} />
            情報がない会社も表示
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title="既定ではいずれかのゲームに紐付く企業のみ表示します">
            <input type="checkbox" checked={showNoise} onChange={(e) => setShowNoise(e.target.checked)} />
            ゲーム未紐付けの企業も表示
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title="新卒採用がある (と判定された) 企業のみに絞り込みます">
            <input type="checkbox" checked={onlyNewgrad} onChange={(e) => setOnlyNewgrad(e.target.checked)} />
            新卒採用ありのみ
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }} title="現在募集中 (と判定された) 企業のみに絞り込みます。 判定はキーワードベースのため目安です">
            <input type="checkbox" checked={onlyOpening} onChange={(e) => setOnlyOpening(e.target.checked)} />
            募集中のみ
          </label>
        </div>
        {visible.length === 0 && (
          <p>{q.trim() || onlyGenerated || onlyNewgrad || onlyOpening || !showNoise || !showNoInfo ? '条件に一致する企業がありません' : 'まだ企業がありません'}</p>
        )}
        <div className="company-grid">
          {visible.map((c) => (
            <div key={c.id} className="company-card">
              <div className="company-card-head">
                <span className="company-card-name">{c.name}</span>
              </div>
              <div className="company-card-badges">
                {c.is_newgrad && <Badge color="#1565c0">新卒採用あり</Badge>}
                {!c.is_newgrad && <Badge color="#757575">新卒採用不明</Badge>}
                {c.is_game && <Badge color="#6a1b9a">ゲーム</Badge>}
                {c.game_count > 0 && <Badge color="#5e35b1">ゲーム {c.game_count} 本</Badge>}
                {c.has_opening && <Badge color="#2e7d32">募集中</Badge>}
                {c.article_count > 0 && (
                  <Badge color="#e65100">記事 {c.article_count} 件</Badge>
                )}
                {c.has_profile && <Badge color="#37474f">IR/理念済</Badge>}
                {c.has_newgrad_image && <Badge color="#00838f">新卒像済</Badge>}
              </div>
              {c.description && <div className="company-card-desc">{c.description}</div>}
              <div className="company-card-meta">
                {c.industry && <span>{c.industry} · </span>}
                {c.roles.length > 0 && <span>職種: {c.roles.join(', ')} </span>}
                {c.stock_reason && <span>· {c.stock_reason}</span>}
              </div>
              {profiles[c.id] && <ProfileView p={profiles[c.id]!} />}
              <div className="company-card-actions">
                {c.url && (
                  <a className="fd-link-btn" href={c.url} target="_blank" rel="noreferrer">サイト ↗</a>
                )}
                {c.recruit_url && (
                  <a className="fd-link-btn" href={c.recruit_url} target="_blank" rel="noreferrer">採用 ↗</a>
                )}
                <button
                  className="fd-btn-secondary"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => (profiles[c.id] ? loadProfile(c.id) : enrichOne(c.id))}
                  disabled={busy !== null || (!c.url && !profiles[c.id] && !c.has_profile)}
                  title={!c.url && !c.has_profile ? 'URL 未登録 — 「情報提供」からリンクを追加してください' : ''}
                >
                  {busy === `enrich-${c.id}`
                    ? '取得中…'
                    : profiles[c.id]
                      ? 'IR/理念を再読込しない'
                      : c.has_profile
                        ? 'IR/理念を表示'
                        : c.description
                          ? 'IR/理念取得'
                          : '情報クロール依頼'}
                </button>
                <button
                  className="fd-btn-secondary"
                  style={{ fontSize: 12, padding: '4px 12px' }}
                  onClick={() => setContributeFor({ id: c.id, name: c.name })}
                  disabled={busy !== null}
                >
                  情報提供
                </button>
                {c.has_newgrad_image && (
                  <button className="fd-btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => void openNewgrad(c.id, c.name)} disabled={busy === `newgrad-${c.id}`}>
                    {busy === `newgrad-${c.id}` ? '読込中…' : '新卒像を表示'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {newgradModal && (
        <NewgradModal
          name={newgradModal.name}
          roles={newgradImages[newgradModal.id]}
          loading={busy === `newgrad-${newgradModal.id}`}
          onClose={() => setNewgradModal(null)}
        />
      )}

      {contributeFor && (
        <ContributeModal
          id={contributeFor.id}
          name={contributeFor.name}
          onClose={() => setContributeFor(null)}
          onApplied={() => void reload()}
        />
      )}
    </div>
  );
}

function ContributeModal({
  id,
  name,
  onClose,
  onApplied,
}: {
  id: string;
  name: string;
  onClose: () => void;
  onApplied: () => void;
}) {
  const api = useCompaniesApi();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ContributeSummary | null>(null);

  const links = text
    .split(/[\s\n]+/)
    .map((s) => s.trim())
    .filter((s) => /^https?:\/\//.test(s));

  const submit = async () => {
    if (links.length === 0) {
      setError('http(s) で始まるリンクを 1 つ以上入力してください');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.contribute(id, links);
      setSummary(r.summary);
      if (r.summary.applied > 0) onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : '取り込みに失敗しました');
    } finally {
      setBusy(false);
    }
  };

  const TYPE_LABEL: Record<string, string> = { company: '企業情報', game: 'ゲーム情報', newgrad: '新卒情報', other: '対象外' };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{name} — 情報提供</h3>
          <button className="modal-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--c-subtle)', marginTop: 0 }}>
            この会社に関するリンク (公式サイト / ゲーム紹介 / 採用・社員インタビュー 等) を貼り付けてください。
            取得・キャッシュして AI が「企業 / ゲーム / 新卒」に分類し、 情報を追加します。 1 行 1 URL・最大 8 件。
          </p>
          <textarea
            className="foundation-form"
            style={{ width: '100%', minHeight: 110, resize: 'vertical' }}
            placeholder={'https://example.co.jp/about\nhttps://example.co.jp/recruit'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
          />
          {error && <p style={{ color: '#c62828' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <button onClick={() => void submit()} disabled={busy || links.length === 0}>
              {busy ? '取り込み中…' : `取り込む (${links.length})`}
            </button>
            <span style={{ fontSize: 12, color: 'var(--c-subtle)' }}>検出リンク {links.length} 件</span>
          </div>

          {summary && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                結果: {summary.applied} / {summary.processed} 件を反映
              </div>
              <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {summary.results.map((r) => (
                  <li key={r.url} style={{ fontSize: 12, lineHeight: 1.5 }}>
                    <span className={`fd-chip ${r.applied ? 'active' : ''}`} style={{ marginRight: 6 }}>
                      {TYPE_LABEL[r.type] ?? r.type}
                    </span>
                    <span style={{ color: r.applied ? 'var(--c-text)' : 'var(--c-subtle)' }}>{r.detail}</span>
                    <div style={{ color: 'var(--c-subtle)', wordBreak: 'break-all' }}>{r.url}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{ background: color, color: '#fff', borderRadius: 4, padding: '1px 6px' }}>{children}</span>
  );
}

const ROLE_LABEL: Record<string, string> = {
  general: '全般',
  planner: 'プランナー',
  programmer: 'プログラマー',
  designer: 'デザイナー',
  sound: 'サウンド',
};

function NewgradModal({
  name,
  roles,
  loading,
  onClose,
}: {
  name: string;
  roles: NewgradRoleImage[] | undefined;
  loading: boolean;
  onClose: () => void;
}) {
  const list = roles ?? [];
  const [active, setActive] = useState<string>('');
  // roles 確定後、最初のタブを選択 (未選択 or 既存タブが消えた場合)。
  useEffect(() => {
    if (list.length > 0 && !list.some((r) => r.role === active)) {
      setActive(list[0]!.role);
    }
  }, [list, active]);

  const current = list.find((r) => r.role === active);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{name} — 求める新卒像</h3>
          <button className="modal-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>

        {list.length > 0 && (
          <div className="fd-tabs">
            {list.map((r) => (
              <button
                key={r.role}
                className={r.role === active ? 'fd-tab active' : 'fd-tab'}
                onClick={() => setActive(r.role)}
              >
                {ROLE_LABEL[r.role] ?? r.role}
              </button>
            ))}
          </div>
        )}

        <div className="modal-body">
          {loading && list.length === 0 && <p style={{ opacity: 0.7 }}>読み込み中…</p>}
          {!loading && list.length === 0 && <p style={{ opacity: 0.7 }}>新卒像データがありません。</p>}
          {current && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--c-subtle)', marginBottom: 10 }}>
                インタビュー記事 {current.article_count} 件をもとに生成
                {current.model && ` · ${current.model}`}
              </div>
              {current.summary.split(/\n{2,}/).map((para, i) => (
                <p key={i} style={{ margin: '0 0 10px', lineHeight: 1.75 }}>{para.trim()}</p>
              ))}
              {current.themes.length > 0 && (
                <>
                  <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 6px', color: 'var(--c-subtle)' }}>
                    キーテーマ
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {current.themes.map((t) => (
                      <span key={t} className="fd-chip">{t}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ProfileView({ p }: { p: CompanyProfile }) {
  return (
    <div style={{ marginTop: 6, padding: 8, background: 'rgba(0,0,0,0.03)', borderRadius: 6, fontSize: 13 }}>
      {p.philosophy && <div><strong>理念:</strong> {p.philosophy}</div>}
      {p.values.length > 0 && <div><strong>バリュー:</strong> {p.values.join(' / ')}</div>}
      {p.business && <div><strong>事業:</strong> {p.business}</div>}
      {p.ir_summary && <div><strong>IR:</strong> {p.ir_summary}</div>}
      {!p.philosophy && !p.business && !p.ir_summary && p.values.length === 0 && <div style={{ opacity: 0.6 }}>情報が取得できていません</div>}
    </div>
  );
}
