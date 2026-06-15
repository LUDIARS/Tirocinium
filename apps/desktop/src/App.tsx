import { NavLink, Outlet } from 'react-router-dom';

const navItems: { to: string; label: string }[] = [
  { to: '/companies', label: '企業プール' },
  { to: '/game-search', label: '関連会社さがし' },
  { to: '/map', label: '企業マップ' },
  { to: '/recommend', label: 'おすすめ企業' },
];

export function App() {
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
