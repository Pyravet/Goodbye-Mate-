import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { fetchJourney, submitConsent, submitPayment, submitReview, API_URL } from './api.js';
import SignaturePad from './SignaturePad.jsx';

const SERVICE_LABELS = {
  euthanasia_only: 'Euthanasia visit',
  private_cremation: 'Euthanasia + private cremation',
  communal_cremation: 'Euthanasia + communal cremation',
};

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}
function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${period}`;
}
function formatMoney(n) {
  return `$${(n || 0).toFixed(2)}`;
}

export default function JourneyPage() {
  const { token } = useParams();
  const [state, setState] = useState('loading'); // loading | error | ready
  const [errorMsg, setErrorMsg] = useState('');
  const [data, setData] = useState(null);

  // Local-only step acknowledgements — the process explanation and
  // aftercare brochure are informational, so "done" here just means the
  // person has read it and tapped through, not something the server
  // needs to track.
  const [welcomeAck, setWelcomeAck] = useState(false);
  const [aftercareAck, setAftercareAck] = useState(false);
  const [paymentSkipped, setPaymentSkipped] = useState(false);
  const [localRating, setLocalRating] = useState(null);

  const load = () => {
    setState('loading');
    fetchJourney(token)
      .then((d) => { setData(d); setState('ready'); })
      .catch((err) => { setErrorMsg(err.message); setState('error'); });
  };
  useEffect(load, [token]);

  if (state === 'loading') {
    return <Centered><p style={styles.muted}>Loading your visit details…</p></Centered>;
  }
  if (state === 'error') {
    return <Centered><p style={styles.errorText}>{errorMsg}</p></Centered>;
  }

  const { job, bill, content, company, eway } = data;
  const hasAftercare = job.serviceType !== 'euthanasia_only';
  // Falls back to the server value until the client submits a rating in
  // this session. Must NOT be its own useState down here — hooks can't
  // live after the early returns above.
  const reviewRating = localRating ?? job.reviewRating;

  const steps = [
    { key: 'welcome', label: 'About your visit', done: welcomeAck || job.consentSigned },
    { key: 'consent', label: 'Consent', done: job.consentSigned },
    { key: 'payment', label: 'Payment', done: job.paymentStatus === 'paid' || paymentSkipped },
  ];
  if (hasAftercare) steps.push({ key: 'aftercare', label: 'Aftercare', done: aftercareAck });
  if (job.procedureDone) steps.push({ key: 'review', label: 'How did we do?', done: reviewRating != null });

  const activeIndex = steps.findIndex((s) => !s.done);
  const active = activeIndex === -1 ? steps.length - 1 : activeIndex;

  const onConsentSigned = () => setData((d) => ({ ...d, job: { ...d.job, consentSigned: true } }));
  const onPaid = () => setData((d) => ({ ...d, job: { ...d.job, paymentStatus: 'paid' } }));

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.brand}>{company?.name || 'Goodbye Mate'}</h1>
        <p style={styles.subhead}>{job.petName} · {SERVICE_LABELS[job.serviceType]}</p>
        <p style={styles.dateLine}>{formatDate(job.jobDate)} at {formatTime(job.jobTime)}</p>
      </header>

      <div style={styles.tracker}>
        {steps.map((s, i) => (
          <div key={s.key} style={styles.trackerStep}>
            <span style={{ ...styles.trackerDot, ...(s.done ? styles.trackerDotDone : i === active ? styles.trackerDotActive : {}) }}>
              {s.done ? '✓' : i + 1}
            </span>
            <span style={{ ...styles.trackerLabel, ...(i === active ? styles.trackerLabelActive : {}) }}>{s.label}</span>
          </div>
        ))}
      </div>

      {steps.map((s, i) => {
        if (i > active) return null; // future steps stay hidden until reached
        const isActive = i === active;
        return (
          <section key={s.key} className="gm-card" style={{ ...styles.card, ...(isActive ? {} : styles.cardCollapsed) }}>
            {s.key === 'welcome' && (
              <WelcomeSection content={content} isActive={isActive} onContinue={() => setWelcomeAck(true)} />
            )}
            {s.key === 'consent' && (
              <ConsentSection token={token} content={content} job={job} isActive={isActive} onSigned={onConsentSigned} />
            )}
            {s.key === 'payment' && (
              <PaymentSection token={token} bill={bill} job={job} eway={eway} isActive={isActive} onPaid={onPaid} onSkip={() => setPaymentSkipped(true)} />
            )}
            {s.key === 'aftercare' && (
              <AftercareSection token={token} content={content} isActive={isActive} onContinue={() => setAftercareAck(true)} />
            )}
            {s.key === 'review' && (
              <ReviewSection token={token} isActive={isActive} rating={reviewRating} onRated={setLocalRating} />
            )}
          </section>
        );
      })}

      {/* Grief resources matter most for euthanasia-only bookings, which
          have no aftercare step — so surface them for every client once
          they've worked through the journey, not just cremation ones. */}
      {!hasAftercare && <ResourceLinks resources={content.resources} />}

      {active === steps.length - 1 && steps[steps.length - 1].done && (
        <div style={styles.doneBanner}>
          <p style={styles.doneBannerText}>Thank you — everything's set for your visit. We're here if you need anything before then.</p>
        </div>
      )}
    </div>
  );
}

function Centered({ children }) {
  return <div style={styles.centeredWrap}>{children}</div>;
}

function SectionHeader({ label, done }) {
  return (
    <div style={styles.sectionHeader}>
      <h3 style={styles.sectionTitle}>{label}</h3>
      {done && <span style={styles.sectionTick}>✓</span>}
    </div>
  );
}

function WelcomeSection({ content, isActive, onContinue }) {
  if (!isActive) return <SectionHeader label="About your visit" done />;
  return (
    <>
      <SectionHeader label="About your visit" done={false} />
      <p style={styles.bodyText}>{content.educationalIntro}</p>
      <button onClick={onContinue} style={styles.primaryBtn}>Continue</button>
    </>
  );
}

function ConsentSection({ token, content, job, isActive, onSigned }) {
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [signature, setSignature] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (job.consentSigned && !isActive) return <SectionHeader label="Consent" done />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await submitConsent(token, { signatureName: name.trim(), agree: true, signatureImage: signature });
      onSigned();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SectionHeader label="Consent" done={false} />
      <p style={styles.bodyText}>{content.consentTemplate}</p>
      <form onSubmit={onSubmit}>
        {error && <p style={styles.errorText}>{error}</p>}
        <label style={styles.label}>Sign here</label>
        <SignaturePad onChange={setSignature} />
        <label style={styles.label}>
          Your full name
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} style={styles.input} />
        </label>
        <label style={styles.checkboxRow}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required />
          <span>I understand and give my consent.</span>
        </label>
        <button type="submit" disabled={submitting || !agree || !signature || name.trim().length < 2} style={styles.primaryBtn}>
          {submitting ? 'Saving…' : 'Sign and continue'}
        </button>
      </form>
    </>
  );
}

function PaymentSection({ token, bill, job, eway, isActive, onPaid, onSkip }) {
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvn, setCvn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const done = job.paymentStatus === 'paid';
  if (done && !isActive) return <SectionHeader label="Payment" done />;

  const publicKey = import.meta.env.VITE_EWAY_PUBLIC_API_KEY;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!window.eCrypt || !publicKey) {
      setError('Payment form is still loading — try again in a moment.');
      return;
    }
    const [expiryMonth, expiryYear] = expiry.split('/');
    if (!expiryMonth || !expiryYear) {
      setError('Enter expiry as MM/YY.');
      return;
    }

    setSubmitting(true);
    try {
      const encryptedCard = {
        number: window.eCrypt.encryptValue(cardNumber.replace(/\s/g, ''), publicKey),
        expiryMonth: window.eCrypt.encryptValue(expiryMonth, publicKey),
        expiryYear: window.eCrypt.encryptValue(expiryYear, publicKey),
        cvn: window.eCrypt.encryptValue(cvn, publicKey),
      };
      await submitPayment(token, encryptedCard);
      onPaid();
    } catch (err) {
      setError(err.declined ? `Card declined: ${err.message}` : err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <SectionHeader label="Payment" done={false} />
      <div style={styles.billBox}>
        {bill.lines.map((l, i) => (
          <div key={i} style={styles.billLine}><span>{l.label}</span><span>{formatMoney(l.amount)}</span></div>
        ))}
        <div style={{ ...styles.billLine, ...styles.billTotal }}><span>Total</span><span>{formatMoney(bill.total)}</span></div>
      </div>

      {!eway.configured ? (
        <>
          <p style={styles.bodyText}>Online payment isn't available for this booking yet — we'll arrange payment with you directly.</p>
          <button onClick={onSkip} style={styles.primaryBtn}>Continue</button>
        </>
      ) : (
        <form onSubmit={onSubmit}>
          {error && <p style={styles.errorText}>{error}</p>}
          <label style={styles.label}>Name on card<input value={cardName} onChange={(e) => setCardName(e.target.value)} required style={styles.input} /></label>
          <label style={styles.label}>
            Card number
            <input value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} inputMode="numeric" autoComplete="cc-number" placeholder="4444 3333 2222 1111" required style={styles.input} />
          </label>
          <div style={styles.row}>
            <label style={{ ...styles.label, flex: 1 }}>
              Expiry (MM/YY)
              <input value={expiry} onChange={(e) => setExpiry(e.target.value)} inputMode="numeric" placeholder="12/28" autoComplete="cc-exp" required style={styles.input} />
            </label>
            <label style={{ ...styles.label, flex: 1 }}>
              CVN
              <input value={cvn} onChange={(e) => setCvn(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" autoComplete="cc-csc" required style={styles.input} />
            </label>
          </div>
          <button type="submit" disabled={submitting} style={styles.primaryBtn}>
            {submitting ? 'Processing…' : `Pay ${formatMoney(bill.total)}`}
          </button>
        </form>
      )}
    </>
  );
}

function AftercareSection({ token, content, isActive, onContinue }) {
  if (!isActive) return <SectionHeader label="Aftercare" done />;
  return (
    <>
      <SectionHeader label="Aftercare" done={false} />
      <p style={styles.bodyText}>{content.brochure}</p>
      <ResourceLinks resources={content.resources} />
      {content.brochurePdf && (
        <a
          href={`${API_URL}/public/journey/${token}/brochure.pdf`}
          target="_blank"
          rel="noreferrer"
          style={styles.pdfLink}
        >
          📄 View brochure (PDF)
        </a>
      )}
      <button onClick={onContinue} style={styles.primaryBtn}>Got it</button>
    </>
  );
}

function ResourceLinks({ resources }) {
  if (!resources || resources.length === 0) return null;
  return (
    <div style={styles.resourceBox}>
      <h4 style={styles.resourceHeading}>Support &amp; resources</h4>
      {resources.map((r) => (
        <a
          key={r.id}
          href={r.href}
          target="_blank"
          rel="noreferrer"
          style={styles.resourceLink}
        >
          <span>{r.isPdf ? '\u{1F4C4}' : '\u{1F517}'} {r.title}</span>
          {r.description && <span style={styles.resourceDesc}>{r.description}</span>}
        </a>
      ))}
    </div>
  );
}

const GOOGLE_REVIEW_URL = 'https://search.google.com/local/writereview?placeid=ChIJ33JNf7ZBKmkRJpZ0x7dhYAI&source=g.page.m.kd._&utm_source=gbp&laa=lu-desktop-review-solicitation';

function ReviewSection({ token, isActive, rating, onRated }) {
  const [hoverStar, setHoverStar] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submittedLowRating, setSubmittedLowRating] = useState(false);

  if (rating != null && !isActive) return <SectionHeader label="How did we do?" done />;

  const submit = async (value, withComment) => {
    setError('');
    setSubmitting(true);
    try {
      await submitReview(token, { rating: value, comment: withComment ? comment.trim() : undefined });
      onRated(value);
      if (value === 5) {
        window.open(GOOGLE_REVIEW_URL, '_blank', 'noopener');
      } else {
        setSubmittedLowRating(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onStarClick = (value) => {
    if (submitting || rating != null) return;
    if (value === 5) {
      submit(5, false);
    } else {
      // For anything under 5, save the rating immediately so it's never
      // lost, then let them optionally add a comment before "done".
      submit(value, false);
    }
  };

  if (rating != null) {
    return (
      <>
        <SectionHeader label="How did we do?" done />
        <p style={styles.bodyText}>
          {rating === 5
            ? 'Thank you — we really appreciate you taking the time to leave a review.'
            : 'Thank you for letting us know. If there\u2019s anything more you\u2019d like to share, we\u2019re listening.'}
        </p>
        {rating < 5 && !submittedLowRating && (
          <>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="Optional — tell us more"
              style={styles.input}
            />
            <button onClick={() => submit(rating, true)} disabled={submitting} style={styles.primaryBtn}>
              {submitting ? 'Sending…' : 'Send feedback'}
            </button>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <SectionHeader label="How did we do?" done={false} />
      <p style={styles.bodyText}>Tap a star to let us know how your visit went.</p>
      {error && <p style={styles.errorText}>{error}</p>}
      <div style={styles.starRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={submitting}
            onClick={() => onStarClick(n)}
            onMouseEnter={() => setHoverStar(n)}
            onMouseLeave={() => setHoverStar(0)}
            style={styles.starBtn}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
          >
            {n <= hoverStar ? '★' : '☆'}
          </button>
        ))}
      </div>
      <p style={styles.starHint}>Five stars will also take you to leave us a Google review.</p>
    </>
  );
}

const styles = {
  page: { maxWidth: 480, margin: '0 auto', padding: '28px 16px 60px' },
  centeredWrap: { display: 'flex', minHeight: '100dvh', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' },
  muted: { color: 'var(--gm-ink-soft)', fontSize: 14 },
  errorText: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 12 },
  header: { textAlign: 'center', marginBottom: 24 },
  brand: { fontSize: 22, marginBottom: 6 },
  subhead: { fontSize: 15, fontWeight: 600, color: 'var(--gm-ink)', margin: 0 },
  dateLine: { fontSize: 13, color: 'var(--gm-ink-soft)', marginTop: 2 },
  tracker: { display: 'flex', justifyContent: 'space-between', marginBottom: 24, padding: '0 4px' },
  trackerStep: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1 },
  trackerDot: { width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, background: 'var(--gm-line-soft)', color: 'var(--gm-ink-soft)' },
  trackerDotDone: { background: 'var(--gm-forest)', color: '#fff' },
  trackerDotActive: { background: 'var(--gm-honey)', color: '#fff' },
  trackerLabel: { fontSize: 10, color: 'var(--gm-ink-soft)', textAlign: 'center' },
  trackerLabelActive: { color: 'var(--gm-ink)', fontWeight: 600 },
  card: { padding: 18, marginBottom: 14 },
  cardCollapsed: { padding: '12px 18px' },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: 600, margin: 0 },
  sectionTick: { color: 'var(--gm-forest)', fontSize: 16, fontWeight: 700 },
  bodyText: { fontSize: 14, color: 'var(--gm-ink)', lineHeight: 1.6, marginBottom: 16 },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 14 },
  input: { display: 'block', width: '100%', marginTop: 6, padding: '10px 11px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 15, background: '#fff' },
  row: { display: 'flex', gap: 12 },
  checkboxRow: { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--gm-ink)', marginBottom: 16 },
  primaryBtn: { width: '100%', padding: '13px', borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 15, fontWeight: 500 },
  billBox: { marginBottom: 16 },
  billLine: { display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' },
  billTotal: { borderTop: '1px solid var(--gm-line)', marginTop: 6, paddingTop: 8, fontWeight: 600, fontSize: 14 },
  doneBanner: { textAlign: 'center', padding: '20px 16px', marginTop: 8 },
  doneBannerText: { fontSize: 14, color: 'var(--gm-forest-dark)', lineHeight: 1.6 },
  pdfLink: { display: 'inline-block', marginBottom: 16, color: 'var(--gm-forest)', fontWeight: 500, fontSize: 14, textDecoration: 'none' },
  starRow: { display: 'flex', gap: 6, marginBottom: 10 },
  starBtn: { background: 'none', border: 'none', fontSize: 36, lineHeight: 1, color: 'var(--gm-honey)', padding: 2, cursor: 'pointer' },
  resourceBox: { marginBottom: 16, paddingTop: 4 },
  resourceHeading: { fontSize: 13, fontWeight: 600, margin: '0 0 8px' },
  resourceLink: { display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', marginBottom: 6, borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', background: '#fff', color: 'var(--gm-forest)', fontSize: 14, fontWeight: 500, textDecoration: 'none' },
  resourceDesc: { fontSize: 12, color: 'var(--gm-ink-soft)', fontWeight: 400 },
  starHint: { fontSize: 12, color: 'var(--gm-ink-soft)', fontStyle: 'italic' },
};
