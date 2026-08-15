import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../layout/AppShell.jsx';
import NearestVetCheck from './NearestVetCheck.jsx';
import { fetchVets, approveVet } from './vetsApi.js';

export default function VetsList() {
  const [vets, setVets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approvingId, setApprovingId] = useState(null);

  const load = () => {
    fetchVets().then(setVets).catch(() => setVets([])).finally(() => setLoading(false));
  };
  useEffect(load, []);

  const onApprove = async (id, e) => {
    e.preventDefault();
    e.stopPropagation();
    setApprovingId(id);
    try {
      await approveVet(id);
      load();
    } finally {
      setApprovingId(null);
    }
  };

  const pending = vets.filter((v) => !v.is_active);
  const active = vets.filter((v) => v.is_active);

  return (
    <AppShell>
      <div style={styles.page}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>Vets</h1>
          <Link to="/vets/new" style={styles.newBtn}>+ Add vet</Link>
        </div>

        <NearestVetCheck />

        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : vets.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>No vets added yet.</p>
            <p style={styles.emptyBody}>Add your first subcontracted vet, or wait for a self-signup application.</p>
          </div>
        ) : (
          <>
            {pending.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h3 style={styles.sectionTitle}>Pending approval ({pending.length})</h3>
                {pending.map((vet) => (
                  <Link key={vet.id} to={`/vets/${vet.id}`} style={styles.link}>
                    <div className="gm-card" style={{ ...styles.card, ...styles.pendingCard }}>
                      <div style={{ ...styles.colorDot, background: vet.color }} />
                      <div style={styles.mainCol}>
                        <div style={styles.name}>{vet.full_name}</div>
                        <div style={styles.subline}>
                          {vet.email}
                          {vet.reg_number && ` · Reg. ${vet.reg_number}${vet.reg_state ? ` (${vet.reg_state})` : ''}`}
                        </div>
                      </div>
                      <button onClick={(e) => onApprove(vet.id, e)} disabled={approvingId === vet.id} style={styles.approveBtn}>
                        {approvingId === vet.id ? 'Approving…' : 'Approve'}
                      </button>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {active.length > 0 && (
              <div>
                {pending.length > 0 && <h3 style={styles.sectionTitle}>Active</h3>}
                {active.map((vet) => (
                  <Link key={vet.id} to={`/vets/${vet.id}`} style={styles.link}>
                    <div className="gm-card" style={styles.card}>
                      <div style={{ ...styles.colorDot, background: vet.color }} />
                      <div style={styles.mainCol}>
                        <div style={styles.name}>{vet.full_name}</div>
                        <div style={styles.subline}>
                          {vet.email}
                          {vet.postcodes?.length > 0 && ` · ${vet.postcodes.length} postcode${vet.postcodes.length === 1 ? '' : 's'}`}
                        </div>
                      </div>
                      {vet.reg_number && <span className="gm-badge gm-badge--forest">Reg. {vet.reg_number}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

const styles = {
  page: { padding: '32px 40px', maxWidth: 720 },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 26 },
  newBtn: { background: 'var(--gm-forest)', color: '#fff', padding: '9px 16px', borderRadius: 'var(--gm-radius-sm)', textDecoration: 'none', fontSize: 13, fontWeight: 500 },
  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 10, fontWeight: 600 },
  link: { textDecoration: 'none', color: 'inherit', display: 'block' },
  card: { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', marginBottom: 8 },
  pendingCard: { borderColor: 'var(--gm-honey)' },
  colorDot: { width: 12, height: 12, borderRadius: '50%', flexShrink: 0 },
  mainCol: { flex: 1, minWidth: 0 },
  name: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600 },
  subline: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2 },
  approveBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '7px 14px', borderRadius: 'var(--gm-radius-sm)', fontSize: 12, fontWeight: 500, flexShrink: 0 },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13 },
  emptyState: { padding: '48px 0', textAlign: 'center' },
  emptyTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 17, marginBottom: 4 },
  emptyBody: { color: 'var(--gm-ink-soft)', fontSize: 13 },
};
