import { useState } from 'react';
import AppShell from '../layout/AppShell.jsx';
import AuditLogTab from './AuditLogTab.jsx';
import MessagesTab from './MessagesTab.jsx';

const TABS = [
  { key: 'audit', label: 'Audit log' },
  { key: 'messages', label: 'Messages' },
];

export default function ActivityPage() {
  const [tab, setTab] = useState('audit');

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Activity</h1>

        <div style={styles.tabs}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ ...styles.tab, ...(tab === t.key ? styles.tabActive : {}) }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'audit' && <AuditLogTab />}
        {tab === 'messages' && <MessagesTab />}
      </div>
    </AppShell>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: 860 },
  title: { fontSize: 26, marginBottom: 20 },
  tabs: { display: 'flex', gap: 4, background: 'var(--gm-line-soft)', padding: 3, borderRadius: 'var(--gm-radius-sm)', width: 'fit-content', marginBottom: 20 },
  tab: { background: 'none', border: 'none', padding: '6px 14px', borderRadius: 5, fontSize: 13, fontWeight: 500, color: 'var(--gm-ink-soft)' },
  tabActive: { background: '#fff', color: 'var(--gm-forest-dark)', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' },
};
