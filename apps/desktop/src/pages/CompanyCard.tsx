import { useState } from 'react';
import { useGamesApi, type ObResult, type RelatedCompany } from '../api/games.js';
import { useCompaniesApi } from '../api/companies.js';

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

/** 関連会社 1 社のカード。 OB 集計は遅延取得 (展開時のみ fetch)。 */
export function CompanyCard({ c }: { c: RelatedCompany }) {
  const api = useGamesApi();
  const companiesApi = useCompaniesApi();
  const size = c.employee_count > 0 ? `${c.employee_count}名` : '規模不明';
  const [ob, setOb] = useState<ObResult | null>(null);
  const [obOpen, setObOpen] = useState(false);
  const [obBusy, setObBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichQueued, setEnrichQueued] = useState(false);

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

  const requestEnrich = async () => {
    if (enriching || enrichQueued) return;
    setEnriching(true);
    try {
      await companiesApi.enrich({ company_id: c.id });
      setEnrichQueued(true);
    } catch {
      /* 失敗時は無視 (キューは別途自動処理) */
    } finally {
      setEnriching(false);
    }
  };

  const hasInfo = c.description !== '';

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
        {c.article_count > 0 && <span className="fd-chip">記事 {c.article_count}件</span>}
        {c.has_profile && <span className="fd-chip">IR/理念済</span>}
        {c.ob_total > 0 && (
          <button className="fd-chip ob" onClick={() => void toggleOb()}>
            OB {c.ob_total}名{obOpen ? ' ▲' : ' ▼'}
          </button>
        )}
        {c.relation === 'direct' && c.role && <span className="fd-chip">{c.role}</span>}
      </div>
      {obOpen && (obBusy ? <div className="company-card-desc">OB 集計 読み込み中…</div> : ob && <ObBreakdown ob={ob} />)}
      {hasInfo && <div className="company-card-desc">{c.description}</div>}
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
        {!hasInfo && c.url && (
          <button
            className="fd-link-btn"
            onClick={() => void requestEnrich()}
            disabled={enriching || enrichQueued}
          >
            {enrichQueued ? '依頼済' : enriching ? 'キュー中…' : '情報クロール依頼'}
          </button>
        )}
      </div>
    </div>
  );
}
