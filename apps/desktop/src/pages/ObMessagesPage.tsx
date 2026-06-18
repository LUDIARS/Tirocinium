import { useEffect, useState } from 'react';
import { useResourcesApi, type ObMessage } from '../api/resources.js';

const ROLE_LABEL: Record<string, string> = {
  planner: 'プランナー',
  programmer: 'プログラマー',
  designer: 'デザイナー',
  sound: 'サウンド',
  general: '総合職',
};

function MessageCard({ m }: { m: ObMessage }) {
  // 裏口からの自己投稿は year=0 / role=general。 該当しない断片は出さない。
  const meta = [
    m.year > 0 ? `${m.year}年卒` : '',
    m.company,
    ROLE_LABEL[m.role] && m.role !== 'general' ? ROLE_LABEL[m.role] : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="fd-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>{m.name}</span>
        {meta && (
          <span style={{ fontSize: '0.85rem', color: 'var(--c-subtle)' }}>{meta}</span>
        )}
      </div>
      <p style={{ margin: 0, lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{m.message}</p>
      {m.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {m.tags.map((t) => <span key={t} className="fd-chip">{t}</span>)}
        </div>
      )}
    </div>
  );
}

export function ObMessagesPage() {
  const api = useResourcesApi();
  const [messages, setMessages] = useState<ObMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.obMessages()
      .then((r) => setMessages(r.messages))
      .catch((e) => setError(e instanceof Error ? e.message : '読み込み失敗'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h2>卒業生からのメッセージ</h2>

      <div className="card">
        {loading && <p style={{ color: 'var(--c-subtle)' }}>読み込み中…</p>}
        {error && <p style={{ color: 'var(--c-danger)' }}>{error}</p>}

        {!loading && !error && messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--c-subtle)' }}>
            <p style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>まだメッセージがありません</p>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>
              就職が決まった先輩のメッセージをここに掲載します。<br />
              卒業生は Discord の裏口 Bot で <code>!ob students &lt;本文&gt;</code> から投稿できます。
            </p>
          </div>
        )}

        {messages.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {messages.map((m) => <MessageCard key={m.id} m={m} />)}
          </div>
        )}
      </div>
    </div>
  );
}
