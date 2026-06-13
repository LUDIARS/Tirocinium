import { useEffect, useState, type ReactNode } from 'react';
import {
  useCompaniesApi,
  type Company,
  type CrawlSummary,
  type ListingSource,
  type ListingCrawlSummary,
  type CompanyProfile,
  type NewgradRoleImage,
} from '../api/companies.js';

export function Companies() {
  const api = useCompaniesApi();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [onlyGenerated, setOnlyGenerated] = useState(false);

  const [sources, setSources] = useState<string[]>([]);
  const [source, setSource] = useState('manual');
  const [urls, setUrls] = useState('');
  const [summary, setSummary] = useState<CrawlSummary | null>(null);

  const [listingSources, setListingSources] = useState<ListingSource[]>([]);
  const [listingSource, setListingSource] = useState('');
  const [listingSummary, setListingSummary] = useState<ListingCrawlSummary | null>(null);

  const [profiles, setProfiles] = useState<Record<string, CompanyProfile>>({});
  const [newgradImages, setNewgradImages] = useState<Record<string, NewgradRoleImage[]>>({});
  const [newgradModal, setNewgradModal] = useState<{ id: string; name: string } | null>(null);

  const reload = async () => {
    try {
      // プール全件を一覧表示できるよう limit を上げる (検索時も同様)。
      const r = await api.list({ q: q.trim() || undefined, limit: 200 });
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
    void api.listingSources().then((r) => {
      setListingSources(r.sources);
      const first = r.sources.find((s) => s.active) ?? r.sources[0];
      if (first) setListingSource(first.id);
    });
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

  const crawl = () =>
    wrap('crawl', async () => {
      const urlList = urls.split(/[\n,]/).map((u) => u.trim()).filter(Boolean);
      const res = await api.crawl({ source, urls: urlList });
      setSummary(res.summary);
      setUrls('');
      await reload();
    });

  const crawlListing = () =>
    wrap('listing', async () => {
      const res = await api.crawlListing({ source: listingSource || undefined });
      setListingSummary(res.summary);
      await reload();
    });

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
  const visible = onlyGenerated
    ? companies.filter((c) => c.has_profile || c.has_newgrad_image)
    : companies;

  return (
    <div>
      <h2>企業プール</h2>
      <p style={{ fontSize: 13, opacity: 0.8 }}>
        新卒採用企業・ゲーム企業(募集あり)を listing からクロールしてストックし、各社サイトを巡回して IR/企業理念を取得します。
        robots.txt 遵守・低速・礼節UA で実行します。公開情報のみ保持します。
      </p>

      {/* listing クロール */}
      <div className="foundation-form card">
        <h3 style={{ marginTop: 0 }}>新卒/ゲーム企業を発見 (listing)</h3>
        <p style={{ fontSize: 12, opacity: 0.7, margin: 0 }}>
          条件: 新卒採用あり、または ゲーム企業かつ募集あり。ソースは data/companies/listing-sources.json で設定。
        </p>
        <label>
          ソース
          <select value={listingSource} onChange={(e) => setListingSource(e.target.value)}>
            {listingSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} ({s.kind}){s.active ? '' : ' [無効]'}
              </option>
            ))}
          </select>
        </label>
        <button onClick={crawlListing} disabled={busy !== null}>
          {busy === 'listing' ? '発見中…' : 'listing クロール'}
        </button>
        {listingSummary && (
          <p style={{ fontSize: 13 }}>
            発見 {listingSummary.discovered} / ストック {listingSummary.stocked} / 除外 {listingSummary.skipped}
            {listingSummary.robotsBlocked > 0 && ` / robots遮断 ${listingSummary.robotsBlocked}`}
            {listingSummary.errors.length > 0 && ` / エラー ${listingSummary.errors.length}`}
          </p>
        )}
      </div>

      {/* 手動 URL クロール */}
      <div className="foundation-form card">
        <h3 style={{ marginTop: 0 }}>URL 指定クロール</h3>
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
            <textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} placeholder="https://example.com/recruit" />
          </label>
        )}
        <button onClick={crawl} disabled={busy !== null}>
          {busy === 'crawl' ? 'クロール中…' : 'クロール実行'}
        </button>
        {summary && (
          <p style={{ fontSize: 13 }}>取得 {summary.fetched} / 登録 {summary.upserted}</p>
        )}
      </div>

      {error && <p style={{ color: '#c62828' }}>{error}</p>}
      {note && <p style={{ color: '#2e7d32' }}>{note}</p>}

      <div className="card">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ margin: 0, flex: 1 }}>登録済み一覧 ({total})</h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void reload()} placeholder="検索" />
          <button onClick={() => void reload()}>検索</button>
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
          {onlyGenerated && <span style={{ opacity: 0.7 }}>表示 {visible.length} 社</span>}
        </div>
        {visible.length === 0 && (
          <p>{onlyGenerated ? '生成済みデータのある企業がありません' : 'まだ企業がありません'}</p>
        )}
        {visible.map((c) => (
          <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <strong>{c.name}</strong>
              <span style={{ fontSize: 11, display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                {c.is_newgrad && <Badge color="#1565c0">新卒採用あり</Badge>}
                {!c.is_newgrad && <Badge color="#757575">新卒採用不明</Badge>}
                {c.is_game && <Badge color="#6a1b9a">ゲーム</Badge>}
                {c.has_opening && <Badge color="#2e7d32">募集中</Badge>}
                {c.article_count > 0 && (
                  <Badge color="#e65100">記事 {c.article_count} 件</Badge>
                )}
                {c.has_profile && <Badge color="#37474f">IR/理念済</Badge>}
                {c.has_newgrad_image && <Badge color="#00838f">新卒像済</Badge>}
              </span>
            </div>
            {c.description && <div style={{ fontSize: 13, opacity: 0.85 }}>{c.description}</div>}
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {c.industry && <span>{c.industry} · </span>}
              {c.roles.length > 0 && <span>職種: {c.roles.join(', ')} </span>}
              {c.stock_reason && <span>· {c.stock_reason}</span>}
            </div>
            <div style={{ fontSize: 12, marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {c.url && (
                <a className="fd-link-btn" href={c.url} target="_blank" rel="noreferrer">サイト ↗</a>
              )}
              {c.recruit_url && (
                <a className="fd-link-btn" href={c.recruit_url} target="_blank" rel="noreferrer">採用 ↗</a>
              )}
              <button className="fd-btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => (profiles[c.id] ? loadProfile(c.id) : enrichOne(c.id))} disabled={busy !== null}>
                {busy === `enrich-${c.id}` ? '取得中…' : profiles[c.id] ? 'IR/理念を再読込しない' : c.has_profile ? 'IR/理念を表示' : 'IR/理念取得'}
              </button>
              {c.has_newgrad_image && (
                <button className="fd-btn-secondary" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => void openNewgrad(c.id, c.name)} disabled={busy === `newgrad-${c.id}`}>
                  {busy === `newgrad-${c.id}` ? '読込中…' : '新卒像を表示'}
                </button>
              )}
            </div>
            {profiles[c.id] && <ProfileView p={profiles[c.id]!} />}
          </div>
        ))}
      </div>

      {newgradModal && (
        <NewgradModal
          name={newgradModal.name}
          roles={newgradImages[newgradModal.id]}
          loading={busy === `newgrad-${newgradModal.id}`}
          onClose={() => setNewgradModal(null)}
        />
      )}
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
