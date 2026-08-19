import { NavLink } from 'react-router';
import { useAuth } from '../AuthContext.jsx';
import { LOGO_DATA_URI } from '../assets.js';
import NotificationBell from '@goodbye-mate/web-shared/src/NotificationBell.jsx';
import { apiFetch } from '../api.js';

// Nav items are shared between the desktop sidebar and the mobile bottom
// tab bar. `short` is used on mobile where horizontal space is tight.
const navItems = [
  { to: '/', label: 'Jobs', short: 'Jobs', end: true },
  { to: '/vets', label: 'Vets', short: 'Vets' },
  { to: '/calendar', label: 'Calendar', short: 'Cal' },
  { to: '/payouts', label: 'Payouts', short: 'Pay' },
  { to: '/activity', label: 'Activity', short: 'Inbox' },
  { to: '/settings', label: 'Settings', short: 'More' },
];

// Layout is driven entirely by CSS classes rather than inline style
// objects. The previous version used inline styles for the sidebar, which
// always beat media queries on specificity — that's why the mobile
// breakpoint appeared to do nothing and the sidebar kept eating half the
// phone screen. Desktop keeps the sidebar; below 768px it's replaced by a
// bottom tab bar matching the vet app's pattern.
export default function AppShell({ children }) {
  const { user, logout } = useAuth();

  return (
    <div className="gm-shell">
      <aside className="gm-sidebar">
        <div className="gm-sidebar-brand">
          <img src={LOGO_DATA_URI} alt="Goodbye Mate" className="gm-sidebar-logo" />
        </div>
        <nav className="gm-sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `gm-sidebar-link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="gm-sidebar-footer">
          <div className="gm-sidebar-bell"><NotificationBell apiFetch={apiFetch} /></div>
        <div className="gm-sidebar-user">{user?.fullName}</div>
          <button onClick={logout} className="gm-sidebar-logout">Log out</button>
        </div>
      </aside>

      {/* Mobile-only header: brand + log out, since those live in the
          sidebar on desktop and would otherwise be unreachable on a phone. */}
      <header className="gm-mobile-header">
        <img src={LOGO_DATA_URI} alt="Goodbye Mate" className="gm-mobile-logo" />
        <div className="gm-mobile-actions">
          <NotificationBell apiFetch={apiFetch} />
          <button onClick={logout} className="gm-mobile-logout">Log out</button>
        </div>
      </header>

      <main className="gm-main">{children}</main>

      {/* Mobile-only bottom tab bar, mirroring the vet app. */}
      <nav className="gm-tabbar">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `gm-tab${isActive ? ' is-active' : ''}`}
          >
            {item.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
