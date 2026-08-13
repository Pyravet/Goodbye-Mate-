import { NavLink } from 'react-router-dom';

export default function AppShell({ children }) {
  return (
    <div style={styles.wrap}>
      <main style={styles.main}>{children}</main>
      <nav style={styles.tabBar}>
        <NavLink to="/" end style={({ isActive }) => ({ ...styles.tab, ...(isActive ? styles.tabActive : {}) })}>
          <span style={styles.tabLabel}>Jobs</span>
        </NavLink>
        <NavLink to="/profile" style={({ isActive }) => ({ ...styles.tab, ...(isActive ? styles.tabActive : {}) })}>
          <span style={styles.tabLabel}>Profile</span>
        </NavLink>
      </nav>
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', minHeight: '100dvh', background: 'var(--gm-paper)' },
  main: { flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 72 },
  tabBar: {
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
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '14px 0',
    color: 'var(--gm-ink-soft)',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 500,
  },
  tabActive: { color: 'var(--gm-forest-dark)', borderTop: '2px solid var(--gm-forest)' },
  tabLabel: {},
};
