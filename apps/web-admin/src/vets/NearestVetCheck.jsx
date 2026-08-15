import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchNearestVets } from './vetsApi.js';

const LABEL_BADGE = {
  'Within drawn territory': 'gm-badge--forest',
  'Exact postcode match': 'gm-badge--forest',
  'Nearby region': 'gm-badge--honey',
  'Outside territory': 'gm-badge--brick',
};

export default function NearestVetCheck() {
  const [postcode, setPostcode] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const onCheck = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const ranked = await fetchNearestVets(postcode.trim());
      setResults(ranked);
    } catch {
      setError('Could not check that postcode — try again.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.title}>Nearest vet check</h3>
      <p style={styles.hint}>Enter a postcode to see which vets cover it, ranked closest first — handy before assigning a job manually.</p>
      <form onSubmit={onCheck} style={styles.form}>
        <input
          value={postcode}
          onChange={(e) => setPostcode(e.target.value)}
          placeholder="e.g. 3121"
          maxLength={4}
          style={styles.input}
        />
        <button type="submit" disabled={loading || postcode.trim().length < 3} style={styles.btn}>
          {loading ? 'Checking…' : 'Check'}
        </button>
      </form>

      {error && <p style={styles.error}>{error}</p>}

      {results && (
        results.length === 0 ? (
          <p style={styles.empty}>No active vets found.</p>
        ) : (
          <div style={styles.results}>
            {results.map((r, i) => (
              <Link key={r.vetId} to={`/vets/${r.vetId}`} style={styles.resultLink}>
                <div style={styles.resultRow}>
                  <span style={styles.rank}>#{i + 1}</span>
                  <span style={styles.name}>{r.name}</span>
                  <span className={`gm-badge ${LABEL_BADGE[r.label]}`}>{r.label}</span>
                  {r.activeJobCount > 0 && (
                    <span style={styles.workload}>{r.activeJobCount} active job{r.activeJobCount === 1 ? '' : 's'}</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )
      )}
    </div>
  );
}

const styles = {
  card: { padding: 18, marginBottom: 20 },
  title: { fontSize: 14, fontWeight: 600, fontFamily: 'var(--gm-font-display)', marginBottom: 4 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 12 },
  form: { display: 'flex', gap: 8 },
  input: { width: 100, padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14 },
  btn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 'var(--gm-radius-sm)', fontSize: 13, fontWeight: 500 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginTop: 10 },
  empty: { color: 'var(--gm-ink-soft)', fontSize: 13, marginTop: 12 },
  results: { marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 },
  resultLink: { textDecoration: 'none', color: 'inherit' },
  resultRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 'var(--gm-radius-sm)', background: 'var(--gm-line-soft)' },
  rank: { fontSize: 12, color: 'var(--gm-ink-soft)', width: 20 },
  name: { fontSize: 13, fontWeight: 600, flex: 1 },
  workload: { fontSize: 11, color: 'var(--gm-ink-soft)' },
};
