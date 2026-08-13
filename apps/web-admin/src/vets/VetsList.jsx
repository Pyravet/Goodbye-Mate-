import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../layout/AppShell.jsx';
import { fetchVets } from './vetsApi.js';

export default function VetsList() {
  const [vets, setVets] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchVets().then(setVets).catch(() => setVets([])).finally(() => setLoading(false));
  }, []);

  return (
    <AppShell>
      <div style={styles.page}>
        <div style={styles.headerRow}>
          <h1 style={styles.title}>Vets</h1>
          <Link to="/vets/new" style={styles.newBtn}>+ Add vet</Link>
        </div>

        {loading ? (
          <p style={styles.empty}>Loading…</p>
        ) : vets.length === 0 ? (
          <div style={styles.emptyState}>
            <p style={styles.emptyTitle}>No vets added yet.</p>
            <p style={styles.emptyBody}>Add your first subcontracted vet to start dispatching jobs.</p>
          </div>
        ) : (
          <div>
            {vets.map((vet) => (
              <Link key={vet.id} to={`/vets/${vet.id}`} style={styles.link}>
                <div className="gm-card" style={styles.card}>
                  <div style={{ ...styles.colorDot, background: vet.color }} />
                  <div style={styles.mainCol}>
                    <div style={styles.name}>{vet.full_name}</div>
                    <div style={styles.subline}>
                      {vet.email}
                      {vet.postcodes?.length > 0 && ` · ${vet.postcodes.length} postcode${vet.postcodes.length === 1 ? '' : 's'}`}
                      {!vet.is_active && ' · Inactive'}
                    </div>
                  </div>
                  {vet.reg_number && <span className="gm-badge gm-badge--forest">Reg. {vet.reg_number}</span>}
                </div>
              </Link>
            ))}
          </div>
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
  link: { textDecoration: 'none', color: 'inherit', display: 'block' },
  card: { display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', marginBottom: 8 },
  colorDot: { width: 12, height: 12, borderRadius: '50%', flexShrink: 0 },
  mainCol: { flex: 1, minWidth: 0 },
  name: { fontFamily: 'var(--gm-font-display)', fontSize: 16, fontWeight: 600 },
  subline: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2 },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13 },
  emptyState: { padding: '48px 0', textAlign: 'center' },
  emptyTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 17, marginBottom: 4 },
  emptyBody: { color: 'var(--gm-ink-soft)', fontSize: 13 },
};
