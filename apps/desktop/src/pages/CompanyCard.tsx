import { useState } from 'react';
import type { RelatedCompany } from '../api/games.js';
import { CompanyDetailModal, type CompanyModalData } from './CompanyDetailModal.js';

const listingLabel = (m: string): string =>
  ({ prime: '一部上場', growth: 'マザーズ', standard: '二部', other: '上場' } as Record<string, string>)[m] ?? '';

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ background: color, color: '#fff', borderRadius: 4, padding: '1px 6px', fontSize: 12 }}>{children}</span>
  );
}

export function CompanyCard({ c }: { c: RelatedCompany }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const size = c.employee_count > 0 ? `${c.employee_count}名` : null;

  return (
    <>
      <div
        className="card company-card"
        style={{ cursor: 'pointer' }}
        onClick={() => setDetailOpen(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setDetailOpen(true)}
      >
        <div className="company-card-head">
          <span className="company-card-name">{c.name}</span>
        </div>
        <div className="company-card-badges">
          {c.is_newgrad
            ? <Badge color="#1565c0">新卒採用あり</Badge>
            : <Badge color="#757575">新卒採用不明</Badge>
          }
          {c.has_opening && <Badge color="#2e7d32">募集中</Badge>}
          {c.is_social && <Badge color="#6a1b9a">ソシャゲ</Badge>}
          {c.article_count > 0 && <Badge color="#e65100">記事 {c.article_count}件</Badge>}
          {c.has_profile && <Badge color="#37474f">IR/理念済</Badge>}
          <span className="fd-chip">{c.is_smb ? '中小' : '大手'}</span>
          {size && <span className="fd-chip">{size}</span>}
          {listingLabel(c.listing_market) && <span className="fd-chip">{listingLabel(c.listing_market)}</span>}
          {c.ob_total > 0 && <span className="fd-chip">OB {c.ob_total}名</span>}
          {c.relation === 'direct' && c.role && <span className="fd-chip">{c.role}</span>}
        </div>
        {c.description && (
          <div className="company-card-desc">
            {c.description.length > 120 ? `${c.description.slice(0, 120)}…` : c.description}
          </div>
        )}
        <div className="company-card-meta">
          {c.industry && <span>{c.industry} · </span>}
          {c.location || '所在地不明'}
        </div>
      </div>
      {detailOpen && <CompanyDetailModal c={c} onClose={() => setDetailOpen(false)} />}
    </>
  );
}
