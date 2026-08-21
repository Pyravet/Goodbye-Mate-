import { NavLink } from 'react-router';
import NotificationBell from '@goodbye-mate/web-shared/src/NotificationBell.jsx';
import { LOGO_DATA_URI } from '../assets.js';
import { apiFetch } from '../api.js';

export default function AppShell({ children }) {
  return (
    <div style={styles.wrap}>
      {/* Compact header purely to host the bell — the vet app had no
          header at all, and the tab bar is the wrong place for it. */}
      <header style={styles.header}>
        <img src={LOGO_DATA_URI} alt="Goodbye Mate" style={styles.headerLogo} />
        <NotificationBell apiFetch={apiFetch} />
      </header>
      <main style={styles.main}>{children}</main>
      <nav style={styles.tabBar}>
        <NavLink to="/" end style={({ isActive }) => ({ ...styles.tab, ...(isActive ? styles.tabActive : {}) })}>
          <span style={styles.tabLabel}>Jobs</span>
        </NavLink>
        <NavLink to="/calendar" style={({ isActive }) => ({ ...styles.tab, ...(isActive ? styles.tabActive : {}) })}>
          <span style={styles.tabLabel}>Calendar</span>
        </NavLink>
        <NavLink to="/offers" style={({ isActive }) => ({ ...styles.tab, ...(isActive ? styles.tabActive : {}) })}>
          <span style={styles.tabLabel}>Offers</span>
        </NavLink>
        <NavLink to="/messages" style={({ isActive }) => ({ ...styles.tab, ...(isActive ? styles.tabActive : {}) })}>
          <span style={styles.tabLabel}>Messages</span>
        </NavLink>
        <NavLink to="/earnings" style={({ isActive }) => ({ ...styles.tab, ...(isActive ? styles.tabActive : {}) })}>
          <span style={styles.tabLabel}>Earnings</span>
        </NavLink>
        <NavLink to="/profile" style={({ isActive }) => ({ ...styles.tab, ...(isActive ? styles.tabActive : {}) })}>
          <span style={styles.tabLabel}>Profile</span>
        </NavLink>
      </nav>
    </div>
  );
}

const styles = {
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px', background: 'var(--gm-forest)',
    position: 'sticky', top: 0, zIndex: 20,
  },
  headerLogo: { height: 20, width: 'auto', display: 'block' },
  wrap: { display: 'flex', flexDirection: 'column', minHeight: '100dvh', background: 'var(--gm-paper)' },
  main: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 72 },
  tabBar: {
    overflowX: 'auto',
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    display: 'flex',
    background: '#fff',
    borderTop: '1px solid var(--gm-line)',
    paddingBottom: 'env(safe-area-inset-bottom)',
  },
  tab: {
    // Six tabs no longer fit a phone. Scrolling keeps every label
    // readable instead of shrinking them all to an illegible width.
    flex: '1 0 auto',
    minWidth: '22vw',
    padding: '14px 2px',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--gm-ink-soft)',
    textDecoration: 'none',
    fontSize: 12,
    fontWeight: 500,
  },
  tabActive: { color: 'var(--gm-forest-dark)', borderTop: '2px solid var(--gm-forest)' },
  tabLabel: {},
};
