import { useEffect, useState } from 'react';
import {
  useResourcesApi,
  type CategorizedSources,
  type ListingSourceEntry,
  type ReferenceLinkCategory,
} from '../api/resources.js';

const KIND_LABEL: Record<string, string> = {
  'newgrad-nav': '新卒ナビ',
  game: 'ゲーム',
  'job-aggregator': '求人アグリゲータ',
  'staff-credits': 'スタッフロール',
};

const TIER_LABEL: Record<string, string> = {
  primary: '一次情報',
  secondary: '二次情報',
};

function SourceCard({ s }: { s: ListingSourceEntry }) {
  const url = s.urls[0];
  const isReal = url && !url.includes('example.com');
  return (
    <div className="fd-card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>{s.id}</span>
        {KIND_LABEL[s.kind] && (
          <span className="fd-chip">{KIND_LABEL[s.kind]}</span>
        )}
        {TIER_LABEL[s.tier] && (
          <span className="fd-chip">{TIER_LABEL[s.tier]}</span>
        )}
      </div>
      {isReal ? (
        <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>
          {url} ↗
        </a>
      ) : (
        <span style={{ fontSize: '0.85rem', color: 'var(--c-subtle)' }}>URL 未確定</span>
      )}
      {s.note && (
        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--c-subtle)', lineHeight: 1.55 }}>
          {s.note}
        </p>
      )}
    </div>
  );
}

function SourceSection({
  title,
  sources,
  emptyText,
}: {
  title: string;
  sources: ListingSourceEntry[];
  emptyText: string;
}) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h3 style={{ marginBottom: 10 }}>{title}</h3>
      {sources.length === 0 ? (
        <p style={{ color: 'var(--c-subtle)', fontSize: '0.9rem' }}>{emptyText}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sources.map((s) => <SourceCard key={s.id} s={s} />)}
        </div>
      )}
    </section>
  );
}

function CuratedSection({ category }: { category: ReferenceLinkCategory }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <h3 style={{ marginBottom: 8 }}>{category.name}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {category.links.map((link) => (
          <div key={link.url} className="fd-card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={link.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
                {link.name} ↗
              </a>
              <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--c-subtle)', lineHeight: 1.5 }}>
                {link.description}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ReferencePage() {
  const api = useResourcesApi();
  const [sources, setSources] = useState<CategorizedSources | null>(null);
  const [curated, setCurated] = useState<ReferenceLinkCategory[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.referenceLinks()
      .then((r) => {
        setSources(r.sources);
        setCurated(r.curated);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '読み込み失敗'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h2>参考リンク</h2>
      {error && <p style={{ color: 'var(--c-danger)' }}>{error}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>クロール対象・状況</h3>
        <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--c-subtle)' }}>
          Tirocinium が情報収集に使っているサイト・使う予定のサイトの一覧です。
        </p>

        {sources ? (
          <>
            <SourceSection
              title="クロール稼働中"
              sources={sources.active}
              emptyText="稼働中のクロール元はありません"
            />
            <SourceSection
              title="クロール予定 (有効化待ち)"
              sources={sources.planned}
              emptyText="予定なし"
            />
            <SourceSection
              title="URL 未確定 / 設定予定"
              sources={sources.template}
              emptyText="なし"
            />
          </>
        ) : (
          !error && <p style={{ color: 'var(--c-subtle)' }}>読み込み中…</p>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>就活に役立つサイト</h3>
        <p style={{ margin: '0 0 16px', fontSize: '0.85rem', color: 'var(--c-subtle)' }}>
          ゲーム業界への就活で参考になるサイトをカテゴリ別にまとめています。
        </p>
        {curated.map((cat) => <CuratedSection key={cat.id} category={cat} />)}
      </div>
    </div>
  );
}
