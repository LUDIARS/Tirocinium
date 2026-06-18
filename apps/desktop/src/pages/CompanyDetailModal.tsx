import { useState, useEffect } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock.js';
import {
  useCompaniesApi,
  type CompanyProfile,
  type NewgradRoleImage,
  type CompanyGame,
  type CompanyArticle,
  type ContributeSummary,
} from '../api/companies.js';

/** Company / RelatedCompany 両型を受け取れる最小共通インターフェース */
export type CompanyModalData = {
  id: string;
  name: string;
  url: string;
  recruit_url: string;
  has_profile: boolean;
  description: string;
  is_newgrad: boolean;
  has_opening: boolean;
  article_count: number;
  industry: string;
  location: string;
  // RelatedCompany 固有 (optional)
  is_social?: boolean;
  is_smb?: boolean;
  employee_count?: number;
  listing_market?: string;
  tech?: string[];
  ob_total?: number;
  relation?: string;
  via_titles?: string[];
  shared_games?: number;
  role?: string;
  // Company 固有 (optional)
  is_game?: boolean;
  game_count?: number;
  has_newgrad_image?: boolean;
  size?: string;
  roles?: string[];
};

type Tab = 'overview' | 'profile' | 'newgrad' | 'games' | 'articles';

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '会社概要' },
  { key: 'profile', label: 'IR/理念' },
  { key: 'newgrad', label: '新卒像' },
  { key: 'games', label: 'ゲーム' },
  { key: 'articles', label: '記事' },
];

const ROLE_LABEL: Record<string, string> = {
  general: '全般', planner: 'プランナー', programmer: 'プログラマー',
  designer: 'デザイナー', sound: 'サウンド',
};

function ContributeModal({ id, name, onClose }: { id: string; name: string; onClose: () => void }) {
  useBodyScrollLock();
  const api = useCompaniesApi();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ContributeSummary | null>(null);

  const links = text.split(/[\s\n]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));

  const submit = async () => {
    if (links.length === 0) { setError('http(s) で始まるリンクを 1 つ以上入力してください'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.contribute(id, links);
      setSummary(r.summary);
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
            公式サイト / ゲーム紹介 / 採用・社員インタビュー等のリンクを貼り付けてください。
            AI が「企業 / ゲーム / 新卒」に分類し情報を追加します。1 行 1 URL・最大 8 件。
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

export function CompanyDetailModal({ c, onClose }: { c: CompanyModalData; onClose: () => void }) {
  useBodyScrollLock();
  const api = useCompaniesApi();
  const [tab, setTab] = useState<Tab>('overview');
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [newgrad, setNewgrad] = useState<NewgradRoleImage[] | null>(null);
  const [newgradBusy, setNewgradBusy] = useState(false);
  const [newgradTab, setNewgradTab] = useState('');
  const [games, setGames] = useState<CompanyGame[] | null>(null);
  const [gamesBusy, setGamesBusy] = useState(false);
  const [articles, setArticles] = useState<CompanyArticle[] | null>(null);
  const [articlesBusy, setArticlesBusy] = useState(false);
  const [enrichQueued, setEnrichQueued] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);

  useEffect(() => {
    if (tab === 'profile' && !profile && !profileBusy && c.has_profile) {
      setProfileBusy(true);
      api.profile(c.id).then((r) => setProfile(r.profile)).catch(() => {}).finally(() => setProfileBusy(false));
    }
    if (tab === 'newgrad' && !newgrad && !newgradBusy) {
      setNewgradBusy(true);
      api.newgrad(c.id).then((r) => {
        setNewgrad(r.roles);
        if (r.roles.length > 0) setNewgradTab(r.roles[0]!.role);
      }).catch(() => setNewgrad([])).finally(() => setNewgradBusy(false));
    }
    if (tab === 'games' && !games && !gamesBusy) {
      setGamesBusy(true);
      api.games(c.id).then((r) => setGames(r.games)).catch(() => setGames([])).finally(() => setGamesBusy(false));
    }
    if (tab === 'articles' && !articles && !articlesBusy) {
      setArticlesBusy(true);
      api.articles(c.id).then((r) => setArticles(r.articles)).catch(() => setArticles([])).finally(() => setArticlesBusy(false));
    }
  }, [tab]);

  const requestEnrich = async () => {
    if (enriching || enrichQueued) return;
    setEnriching(true);
    try { await api.enrich({ company_id: c.id }); setEnrichQueued(true); } catch { /* ignore */ } finally { setEnriching(false); }
  };

  const hasInfo = c.description !== '';
  const listingLabel = (m: string) =>
    ({ prime: '一部上場', growth: 'マザーズ', standard: '二部', other: '上場' } as Record<string, string>)[m] ?? '';

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h3 style={{ margin: 0 }}>{c.name}</h3>
            <button className="modal-close" onClick={onClose} aria-label="閉じる">×</button>
          </div>

          {/* リンク行 */}
          <div style={{ display: 'flex', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--c-border)' }}>
            {c.url && <a className="fd-link-btn" href={c.url} target="_blank" rel="noreferrer">会社サイト ↗</a>}
            {c.recruit_url && <a className="fd-link-btn" href={c.recruit_url} target="_blank" rel="noreferrer">採用ページ ↗</a>}
            <button className="fd-btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => setContributeOpen(true)}>
              情報提供
            </button>
          </div>

          {/* タブ */}
          <div className="fd-tabs" style={{ padding: '0 16px' }}>
            {TAB_LABELS.map(({ key, label }) => (
              <button key={key} className={tab === key ? 'fd-tab active' : 'fd-tab'} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>

          <div className="modal-body">
            {/* ── 会社概要 ── */}
            {tab === 'overview' && (
              <div>
                <div className="company-card-badges" style={{ marginBottom: 8 }}>
                  {c.is_newgrad
                    ? <span style={{ background: '#1565c0', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>新卒採用あり</span>
                    : <span style={{ background: '#757575', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>新卒採用不明</span>
                  }
                  {c.has_opening && <span style={{ background: '#2e7d32', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>募集中</span>}
                  {c.is_social && <span style={{ background: '#6a1b9a', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>ソシャゲ</span>}
                  {c.is_game && <span style={{ background: '#6a1b9a', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>ゲーム</span>}
                  {(c.game_count ?? 0) > 0 && <span style={{ background: '#5e35b1', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>ゲーム {c.game_count} 本</span>}
                  {c.article_count > 0 && <span style={{ background: '#e65100', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>記事 {c.article_count}件</span>}
                  {c.has_profile && <span style={{ background: '#37474f', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>IR/理念済</span>}
                  {c.has_newgrad_image && <span style={{ background: '#00838f', color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>新卒像済</span>}
                  {c.is_smb != null && <span className="fd-chip">{c.is_smb ? '中小' : '大手'}</span>}
                  {c.size && <span className="fd-chip">{c.size}</span>}
                  {(c.employee_count ?? 0) > 0 && <span className="fd-chip">{c.employee_count}名</span>}
                  {c.listing_market && listingLabel(c.listing_market) && <span className="fd-chip">{listingLabel(c.listing_market)}</span>}
                  {(c.ob_total ?? 0) > 0 && <span className="fd-chip">OB {c.ob_total}名</span>}
                </div>
                {c.industry && <div style={{ fontSize: 13, color: 'var(--c-subtle)', marginBottom: 8 }}>{c.industry}</div>}
                {hasInfo
                  ? <p style={{ margin: '0 0 12px', lineHeight: 1.7 }}>{c.description}</p>
                  : (
                    <div style={{ padding: '12px 0', color: 'var(--c-subtle)', fontSize: 13 }}>
                      概要未取得。
                      <button
                        className="fd-btn-secondary"
                        style={{ fontSize: 12, padding: '4px 12px', marginLeft: 8 }}
                        onClick={() => void requestEnrich()}
                        disabled={enriching || enrichQueued}
                      >
                        {enrichQueued ? '依頼済' : enriching ? 'キュー中…' : '情報クロール依頼'}
                      </button>
                    </div>
                  )
                }
                {c.tech && c.tech.length > 0 && (
                  <div className="company-card-badges">
                    {c.tech.map((t) => <span key={t} className="fd-chip tech">{t}</span>)}
                  </div>
                )}
                {c.roles && c.roles.length > 0 && (
                  <div style={{ fontSize: 13, color: 'var(--c-subtle)', marginTop: 8 }}>職種: {c.roles.join(', ')}</div>
                )}
                {c.location && <div style={{ fontSize: 13, color: 'var(--c-subtle)', marginTop: 8 }}>{c.location}</div>}
                {c.relation === 'related' && c.via_titles && c.via_titles.length > 0 && (
                  <div style={{ fontSize: 13, marginTop: 8 }}>
                    つながり {c.shared_games}: {c.via_titles.join(' / ')}
                  </div>
                )}
                {c.relation === 'direct' && c.role && (
                  <div style={{ fontSize: 13, marginTop: 8 }}>役割: {c.role}</div>
                )}
              </div>
            )}

            {/* ── IR/理念 ── */}
            {tab === 'profile' && (
              <div>
                {!c.has_profile && !profile && (
                  <div style={{ color: 'var(--c-subtle)', fontSize: 13 }}>
                    IR/理念が未取得です。
                    <button
                      className="fd-btn-secondary"
                      style={{ fontSize: 12, padding: '4px 12px', marginLeft: 8 }}
                      onClick={() => void requestEnrich()}
                      disabled={enriching || enrichQueued || !hasInfo}
                    >
                      {enrichQueued ? '依頼済' : enriching ? 'キュー中…' : 'IR/理念取得'}
                    </button>
                  </div>
                )}
                {profileBusy && <p style={{ opacity: 0.7 }}>読み込み中…</p>}
                {profile && (
                  <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {profile.philosophy && <div><strong>理念:</strong> {profile.philosophy}</div>}
                    {profile.values.length > 0 && <div><strong>バリュー:</strong> {profile.values.join(' / ')}</div>}
                    {profile.business && <div><strong>事業:</strong> {profile.business}</div>}
                    {profile.ir_summary && <div><strong>IR:</strong> {profile.ir_summary}</div>}
                    {!profile.philosophy && !profile.business && !profile.ir_summary && profile.values.length === 0 && (
                      <div style={{ opacity: 0.6 }}>情報が取得できていません</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── 新卒像 ── */}
            {tab === 'newgrad' && (
              <div>
                {newgradBusy && <p style={{ opacity: 0.7 }}>読み込み中…</p>}
                {newgrad && newgrad.length === 0 && <p style={{ opacity: 0.7 }}>新卒像データがありません。</p>}
                {newgrad && newgrad.length > 0 && (
                  <>
                    <div className="fd-tabs" style={{ marginBottom: 12 }}>
                      {newgrad.map((r) => (
                        <button
                          key={r.role}
                          className={r.role === newgradTab ? 'fd-tab active' : 'fd-tab'}
                          onClick={() => setNewgradTab(r.role)}
                        >
                          {ROLE_LABEL[r.role] ?? r.role}
                        </button>
                      ))}
                    </div>
                    {newgrad.filter((r) => r.role === newgradTab).map((r) => (
                      <div key={r.role}>
                        <div style={{ fontSize: 12, color: 'var(--c-subtle)', marginBottom: 10 }}>
                          インタビュー記事 {r.article_count} 件をもとに生成{r.model && ` · ${r.model}`}
                        </div>
                        {r.summary.split(/\n{2,}/).map((para, i) => (
                          <p key={i} style={{ margin: '0 0 10px', lineHeight: 1.75 }}>{para.trim()}</p>
                        ))}
                        {r.themes.length > 0 && (
                          <div className="company-card-badges" style={{ marginTop: 8 }}>
                            {r.themes.map((t) => <span key={t} className="fd-chip">{t}</span>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {/* ── ゲーム ── */}
            {tab === 'games' && (
              <div>
                {gamesBusy && <p style={{ opacity: 0.7 }}>読み込み中…</p>}
                {games && games.length === 0 && <p style={{ opacity: 0.7 }}>ゲームデータがありません。</p>}
                {games && games.length > 0 && (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {games.map((g) => (
                      <li key={g.id} style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <span style={{ minWidth: 36, color: 'var(--c-subtle)' }}>{g.release_year || '—'}</span>
                        <span style={{ fontWeight: 600 }}>{g.title}</span>
                        {g.platform && <span className="fd-chip" style={{ fontSize: 11 }}>{g.platform}</span>}
                        {g.role && <span className="fd-chip" style={{ fontSize: 11 }}>{g.role}</span>}
                        {g.series && <span style={{ color: 'var(--c-subtle)', fontSize: 12 }}>{g.series}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* ── 記事 ── */}
            {tab === 'articles' && (
              <div>
                {articlesBusy && <p style={{ opacity: 0.7 }}>読み込み中…</p>}
                {articles && articles.length === 0 && <p style={{ opacity: 0.7 }}>記事データがありません。</p>}
                {articles && articles.length > 0 && (
                  <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {articles.map((a) => (
                      <li key={a.url} style={{ fontSize: 13, borderBottom: '1px solid var(--c-border)', paddingBottom: 10 }}>
                        <a href={a.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: 'var(--c-accent)' }}>
                          {a.title || a.url}
                        </a>
                        {a.body && (
                          <p style={{ margin: '4px 0 0', color: 'var(--c-subtle)', lineHeight: 1.6, fontSize: 12 }}>
                            {a.body.slice(0, 200)}{a.body.length > 200 ? '…' : ''}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {contributeOpen && (
        <ContributeModal id={c.id} name={c.name} onClose={() => setContributeOpen(false)} />
      )}
    </>
  );
}
