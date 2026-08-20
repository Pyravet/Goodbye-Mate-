import { useState } from 'react';
import AppShell from '../layout/AppShell.jsx';
import PricingTab from './PricingTab.jsx';
import ContentTab from './ContentTab.jsx';
import ExportsTab from './ExportsTab.jsx';
import TemplatesTab from './TemplatesTab.jsx';
import NotificationsTab from './NotificationsTab.jsx';

const TABS = [
  { key: 'pricing', label: 'Pricing' },
  { key: 'content', label: 'Content' },
  { key: 'templates', label: 'Message templates' },
  { key: 'exports', label: 'Exports' },
  { key: 'notifications', label: 'Notifications' },
];

export default function SettingsPage() {
  const [tab, setTab] = useState('pricing');

  return (
    <AppShell>
      <div style={styles.page}>
        <h1 style={styles.title}>Settings</h1>

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

        {tab === 'pricing' && <PricingTab />}
        {tab === 'content' && <ContentTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'exports' && <ExportsTab />}
        {tab === 'notifications' && <NotificationsTab />}
      </div>
    </AppShell>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: 760 },
  title: { fontSize: 26, marginBottom: 20 },
  tabs: { display: 'flex', gap: 4, background: 'var(--gm-line-soft)', padding: 3, borderRadius: 'var(--gm-radius-sm)', width: 'fit-content', marginBottom: 20 },
  tab: { background: 'none', border: 'none', padding: '6px 14px', borderRadius: 5, fontSize: 13, fontWeight: 500, color: 'var(--gm-ink-soft)' },
  tabActive: { background: '#fff', color: 'var(--gm-forest-dark)', boxShadow: '0 1px 2px rgba(0,0,0,0.06)' },
};
