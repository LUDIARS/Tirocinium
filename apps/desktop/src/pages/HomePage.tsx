import { Link } from 'react-router-dom';

const links: { to: string; label: string; description: string }[] = [
  {
    to: '/companies',
    label: '企業プール',
    description: '182 社の企業データ、新卒像、IR・プロファイルを閲覧',
  },
  {
    to: '/recommend',
    label: 'おすすめ企業',
    description: 'ES をもとにマッチ企業を算出',
  },
];

export function HomePage() {
  return (
    <div style={{ maxWidth: 560, margin: '48px auto', padding: '0 20px' }}>
      <h2 style={{ marginBottom: 24 }}>Tirocinium</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            style={{ textDecoration: 'none' }}
          >
            <div className="card" style={{ cursor: 'pointer' }}>
              <strong style={{ fontSize: 16 }}>{l.label}</strong>
              <span style={{ fontSize: 13, opacity: 0.7 }}>{l.description}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
