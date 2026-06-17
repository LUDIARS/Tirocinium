import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { tracker } from './analytics/tracker.js';

// label = 通常幅 / short = スマホ幅 (タブが収まるよう短縮)。
const navItems: { to: string; label: string; short: string }[] = [
  { to: '/companies', label: '企業プール', short: '企業' },
  { to: '/game-search', label: '関連会社さがし', short: '関連会社' },
  { to: '/map', label: '企業マップ', short: 'マップ' },
  { to: '/reference', label: '参考リンク', short: '参考' },
  // 一旦非表示 (おすすめ企業 / 卒業生メッセージ)。ルートは残しているので URL 直アクセスは可能。
  // { to: '/recommend', label: 'おすすめ企業', short: 'おすすめ' },
  // { to: '/ob-messages', label: '卒業生メッセージ', short: '卒業生' },
];

export function App() {
  const location = useLocation();
  useEffect(() => {
    void tracker.pageView(location.pathname);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="brand">Tirocinium</h1>
        <nav className="app-nav">
          {navItems.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            >
              <span className="nav-label-full">{n.label}</span>
              <span className="nav-label-short">{n.short}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
