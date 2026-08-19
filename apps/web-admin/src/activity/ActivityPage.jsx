import { useState } from 'react';
import AppShell from '../layout/AppShell.jsx';
import AuditLogTab from './AuditLogTab.jsx';
import MessagesTab from './MessagesTab.jsx';
import InboxTab from './InboxTab.jsx';
import Messaging from '@goodbye-mate/web-shared/src/Messaging.jsx';
import { makeConversationsApi } from '@goodbye-mate/web-shared/src/conversationsApi.js';
import { apiFetch } from '../api.js';
import { useAuth } from '../AuthContext.jsx';

// Built once at module scope — recreating it per render would give the
// Messaging component a new `api` identity every time and retrigger its
// data-loading effects endlessly.
const conversationsApi = makeConversationsApi(apiFetch);

const TABS = [
  { key: 'messages', label: 'Messages' },
  { key: 'inbox', label: 'Job threads' },
  { key: 'audit', label: 'Audit log' },
  { key: 'messages', label: 'Client messages' },
];

export default function ActivityPage() {
  const [tab, setTab] = useState('messages');
  const { user } = useAuth();

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

        {tab === 'messages' && (
          <Messaging api={conversationsApi} currentUserId={user?.id} canBroadcast />
        )}
        {tab === 'inbox' && <InboxTab />}
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
