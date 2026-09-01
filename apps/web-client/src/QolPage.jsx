import { useState, useEffect } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

const SCALE = [
  { value: 5, label: 'No problem at all' },
  { value: 4, label: 'Slightly affected' },
  { value: 3, label: 'Noticeably affected' },
  { value: 2, label: 'Struggling' },
  { value: 1, label: 'Struggling badly' },
  { value: 0, label: 'Not able to at all' },
];

const BAND_STYLE = {
  good: { background: '#E3E9E1', color: '#33453A' },
  watch: { background: '#FDF6EC', color: '#7A5A22' },
  concern: { background: '#FDF6EC', color: '#7A5A22' },
  urgent: { background: '#F5E3E0', color: '#8C3B2E' },
};

/**
 * Quality of life assessment, for families deciding whether their pet is
 * still comfortable.
 *
 * Open to anyone — no login, nothing stored. Somebody working out
 * whether their dog is suffering should not have to make an account, and
 * we have no business keeping a record of them doing it.
 *
 * The result never says what to do. It gives a picture and points to a
 * vet, because a number cannot examine an animal.
 */
export default function QolPage() {
  const [categories, setCategories] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${API}/qol/questions`)
      .then((r) => r.json())
      .then((d) => setCategories(d.categories))
      .catch(() => setError('Could not load the questions. Please try again.'));
  }, []);

  const answered = categories ? categories.filter((c) => answers[c.key] !== undefined).length : 0;
  const allAnswered = categories && answered === categories.length;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/qol/score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setResult(data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const band = BAND_STYLE[result.interpretation.band] || BAND_STYLE.watch;
    return (
      <div style={styles.page}>
        <div style={styles.inner}>
          <div style={{ ...styles.resultCard, ...band }}>
            <div style={styles.score}>{result.total} <span style={styles.outOf}>/ {result.maxScore}</span></div>
            <h2 style={styles.headline}>{result.interpretation.headline}</h2>
            <p style={styles.resultBody}>{result.interpretation.body}</p>
          </div>

          {/* The worst areas, named. A total of 24 made of eight 3s is a
              different situation from one where breathing scores 0, and
              a vet needs to hear about the second first. */}
          {result.lowest.length > 0 && (
            <div style={styles.card}>
              <h3 style={styles.cardTitle}>Worth mentioning to your vet</h3>
              <p style={styles.hint}>These scored lowest:</p>
              <ul style={styles.list}>
                {result.lowest.map((c) => (
                  <li key={c.key} style={styles.listItem}>
                    <strong>{c.title}</strong> — {c.score} out of 5
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={styles.card}>
            <h3 style={styles.cardTitle}>What to do with this</h3>
            <p style={styles.body}>
              Take it to your vet. It gives them a clear picture of the last week in a way that
              is hard to put into words at an appointment.
            </p>
            <p style={styles.body}>
              It also helps to repeat it every week or two. The direction of travel tells you
              much more than any single score.
            </p>
          </div>

          <button onClick={() => { setResult(null); setAnswers({}); }} style={styles.secondaryBtn}>
            Start again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.inner}>
        <h1 style={styles.title}>How is your pet doing?</h1>
        <p style={styles.intro}>
          Eight short questions about the last week or so. There are no right answers, and
          nothing here is recorded or sent anywhere — it&apos;s just for you.
        </p>
        <p style={styles.intro}>
          This won&apos;t tell you what to do. What it will do is give you something clear to
          take to your vet, and a way to see whether things are changing over time.
        </p>

        {error && <p style={styles.error}>{error}</p>}

        {!categories ? (
          <p style={styles.hint}>Loading…</p>
        ) : (
          categories.map((c) => (
            <div key={c.key} style={styles.card}>
              <h3 style={styles.cardTitle}>
                <span style={styles.letter}>{c.letter}</span> {c.title}
              </h3>
              <p style={styles.hint}>{c.prompt}</p>
              <div style={styles.options}>
                {SCALE.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setAnswers((a) => ({ ...a, [c.key]: s.value }))}
                    style={{
                      ...styles.option,
                      ...(answers[c.key] === s.value ? styles.optionOn : {}),
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}

        {categories && (
          <div style={styles.footer}>
            <p style={styles.progress}>{answered} of {categories.length} answered</p>
            <button onClick={submit} disabled={!allAnswered || busy} style={styles.primaryBtn}>
              {busy ? 'Working it out…' : 'See the result'}
            </button>
            {!allAnswered && (
              <p style={styles.hint}>
                Please answer all eight — a partial score would be misleading.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: 'var(--gm-paper)', padding: '24px 16px 60px' },
  inner: { maxWidth: 560, margin: '0 auto' },
  title: { fontFamily: 'var(--gm-font-display)', fontSize: 26, marginBottom: 10 },
  intro: { fontSize: 15, lineHeight: 1.7, color: 'var(--gm-ink-soft)', marginBottom: 12 },
  card: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius)', padding: 18, marginBottom: 12 },
  cardTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 17, fontWeight: 600, marginBottom: 6 },
  letter: { display: 'inline-block', width: 26, height: 26, lineHeight: '26px', textAlign: 'center', borderRadius: '50%', background: 'var(--gm-forest)', color: '#fff', fontSize: 13, marginRight: 8 },
  hint: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 1.7, marginBottom: 10 },
  options: { display: 'flex', flexDirection: 'column', gap: 6 },
  // Full-width stacked buttons rather than a 0–5 row: labels mean more
  // than numbers when you're upset, and they stay tappable one-handed.
  option: { minHeight: 44, textAlign: 'left', padding: '10px 14px', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', background: '#fff', fontSize: 14, cursor: 'pointer' },
  optionOn: { background: 'var(--gm-forest)', color: '#fff', borderColor: 'var(--gm-forest)', fontWeight: 500 },
  footer: { marginTop: 18 },
  progress: { fontSize: 13, color: 'var(--gm-ink-soft)', marginBottom: 8, textAlign: 'center' },
  primaryBtn: { width: '100%', minHeight: 50, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', fontSize: 16, fontWeight: 500, cursor: 'pointer' },
  secondaryBtn: { width: '100%', minHeight: 46, background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', fontSize: 14, cursor: 'pointer' },
  resultCard: { borderRadius: 'var(--gm-radius)', padding: 22, marginBottom: 14, textAlign: 'center' },
  score: { fontFamily: 'var(--gm-font-display)', fontSize: 44, fontWeight: 600, lineHeight: 1 },
  outOf: { fontSize: 20, opacity: 0.7 },
  headline: { fontFamily: 'var(--gm-font-display)', fontSize: 19, fontWeight: 600, margin: '12px 0 8px' },
  resultBody: { fontSize: 15, lineHeight: 1.7 },
  list: { margin: 0, paddingLeft: 20 },
  listItem: { fontSize: 14, lineHeight: 1.8 },
  error: { fontSize: 14, color: 'var(--gm-brick)', marginBottom: 12 },
};
