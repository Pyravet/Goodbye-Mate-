import { NavLink } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';
import { LOGO_DATA_URI } from '../assets.js';

const navItems = [
  { to: '/', label: 'Jobs', end: true },
  { to: '/vets', label: 'Vets' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/activity', label: 'Activity' },
  { to: '/settings', label: 'Settings' },
];

export default function AppShell({ children }) {
  const { user, logout } = useAuth();

  return (
    <div style={styles.wrap}>
      <aside style={styles.sidebar}>
        <div style={styles.brand}>
          <img src={LOGO_DATA_URI} alt="Goodbye Mate" style={styles.brandLogo} />
        </div>
        <nav style={styles.nav}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                ...styles.navLink,
                ...(isActive ? styles.navLinkActive : {}),
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={styles.sidebarFooter}>
          <div style={styles.userName}>{user?.fullName}</div>
          <button onClick={logout} style={styles.logoutBtn}>Log out</button>
        </div>
      </aside>
      <main style={styles.main}>{children}</main>
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: 'var(--gm-sidebar-w)',
    flexShrink: 0,
    background: 'var(--gm-forest)',
    color: '#F3F0E7',
    display: 'flex',
    flexDirection: 'column',
    padding: '24px 16px',
  },
  brand: {
    padding: '0 8px 24px',
  },
  brandLogo: {
    width: '100%',
    height: 'auto',
    display: 'block',
  },
  nav: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1 },
  navLink: {
    display: 'block',
    padding: '9px 12px',
    borderRadius: 'var(--gm-radius-sm)',
    color: '#D9D3C4',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
  },
  navLinkActive: {
    background: 'rgba(255,255,255,0.12)',
    color: '#fff',
  },
  sidebarFooter: {
    borderTop: '1px solid rgba(255,255,255,0.15)',
    paddingTop: 14,
    marginTop: 14,
  },
  userName: { fontSize: 13, color: '#D9D3C4', padding: '0 8px 8px' },
  logoutBtn: {
    background: 'none',
    border: 'none',
    color: '#D9D3C4',
    fontSize: 13,
    padding: '0 8px',
    textAlign: 'left',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  main: { flex: 1, minWidth: 0, background: 'var(--gm-paper)' },
};
