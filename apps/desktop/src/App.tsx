import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { tracker } from './analytics/tracker.js';

const navItems: { to: string; label: string }[] = [
  { to: '/companies', label: '企業プール' },
  { to: '/game-search', label: '関連会社さがし' },
  { to: '/map', label: '企業マップ' },
  { to: '/recommend', label: 'おすすめ企業' },
  { to: '/reference', label: '参考リンク' },
  { to: '/ob-messages', label: '卒業生メッセージ' },
  { to: '/analytics', label: 'アクセス解析' },
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
              {n.label}
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
