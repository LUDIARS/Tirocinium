import { NavLink, Outlet } from 'react-router-dom';

const navItems: { to: string; label: string }[] = [
  { to: '/', label: 'Dashboard' },
  { to: '/start', label: 'Session Start' },
  { to: '/personas', label: 'Personas' },
  { to: '/training', label: '学習データ' },
  { to: '/reservation', label: 'Reservation' },
  { to: '/settings', label: 'Settings' },
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
