import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { fetchJourney, submitConsent, submitPayment, submitReview, API_URL } from './api.js';
import SignaturePad from './SignaturePad.jsx';
import { formatTime, formatMoney, formatExpiry } from '@goodbye-mate/web-shared/src/format.js';

const SERVICE_LABELS = {
  euthanasia_only: 'Euthanasia visit',
  private_cremation: 'Euthanasia + private cremation',
  communal_cremation: 'Euthanasia + communal cremation',
};

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}

/**
 * Turn a stored ETA into something true right now.
 *
 * en_route_eta_minutes is a snapshot from when the vet set off, so
 * showing it verbatim would still read "25 minutes" an hour later. This
 * counts down from when it was recorded and stops claiming a number once
 * the estimate has lapsed — "arriving any moment" is honest, a negative
 * or stale figure is not.
 */
function etaText(enRoute) {
  if (enRoute.etaMinutes == null) return 'On the way now.';
  const elapsedMin = Math.floor((Date.now() - new Date(enRoute.at).getTime()) / 60000);
  const remaining = enRoute.etaMinutes - elapsedMin;
  if (remaining <= 0) return 'Arriving any moment.';
  if (remaining === 1) return 'About 1 minute away.';
  if (remaining < 60) return `About ${remaining} minutes away.`;
  return 'On the way.';
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
  // Completed steps collapse to a tick. Clients want to look back at
  // what they consented to or what they were charged, so a collapsed
  // step can be reopened rather than being gone for good.
  const [expandedStep, setExpandedStep] = useState(null);

  // Refresh while the vet is en route so the estimate stays current.
  // Reads from `data` rather than the destructured content/job, because
  // those are defined AFTER the early returns below and a hook cannot
  // live after an early return.
  useEffect(() => {
    if (!data?.content?.enRoute || data?.job?.procedureDone) return undefined;
    const t = setInterval(() => {
      fetchJourney(token).then(setData).catch(() => {});
    }, 60000);
    return () => clearInterval(t);
  }, [data?.content?.enRoute, data?.job?.procedureDone, token]);

  // Refresh while the vet is en route so the arrival estimate stays
  // current. Only then: the rest of the journey is static, and polling
  // it would be load for nothing.
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

  // Every step the client can currently act on is finished. Declared
  // AFTER steps — const isn't hoisted, so reading it earlier throws.
  const allStepsDone = steps.every((st) => st.done);

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

      {content.enRoute && !job.procedureDone && (
        <div style={styles.enRouteBanner}>
          <div style={styles.enRouteTitle}>
            {content.vet?.fullName || 'Your vet'} is on the way
          </div>
          <div style={styles.enRouteEta}>
            {etaText(content.enRoute)}
          </div>
          {content.enRoute.distanceText && (
            <div style={styles.enRouteMeta}>{content.enRoute.distanceText} away</div>
          )}
          <div style={styles.enRouteMeta}>
            There's nothing you need to do — this updates on its own.
          </div>
        </div>
      )}

      {steps.map((s, i) => {
        if (i > active) return null; // future steps stay hidden until reached
        const isActive = i === active;
        return (
          <section key={s.key} className="gm-card" style={{ ...styles.card, ...(isActive ? {} : styles.cardCollapsed) }}>
            {s.key === 'welcome' && (
              <WelcomeSection
                content={content}
                isActive={isActive}
                expanded={expandedStep === 'welcome'}
                onToggle={() => setExpandedStep(expandedStep === 'welcome' ? null : 'welcome')}
                onContinue={() => setWelcomeAck(true)}
              />
            )}
            {s.key === 'consent' && (
              <ConsentSection
                token={token} content={content} job={job} isActive={isActive}
                onSigned={onConsentSigned}
                expanded={expandedStep === 'consent'}
                onToggle={() => setExpandedStep(expandedStep === 'consent' ? null : 'consent')}
              />
            )}
            {s.key === 'payment' && (
              <PaymentSection
                token={token} bill={bill} job={job} eway={eway} isActive={isActive}
                onPaid={onPaid} onSkip={() => setPaymentSkipped(true)}
                expanded={expandedStep === 'payment'}
                onToggle={() => setExpandedStep(expandedStep === 'payment' ? null : 'payment')}
              />
            )}
            {s.key === 'aftercare' && (
              <AftercareSection
                token={token} content={content} isActive={isActive}
                onContinue={() => setAftercareAck(true)}
                expanded={expandedStep === 'aftercare'}
                onToggle={() => setExpandedStep(expandedStep === 'aftercare' ? null : 'aftercare')}
              />
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

      {/* After the last available step, say what happens next. Without
          this the journey simply stops on a "Got it" button with no
          indication that a final step appears later, which reads as the
          page being broken. The review step only exists once the vet has
          marked the procedure done — asking someone to rate a visit that
          hasn't happened would be worse than waiting. */}
      {allStepsDone && !job.procedureDone && (
        <div className="gm-card" style={styles.card}>
          <h3 style={styles.sectionTitle}>That's everything for now</h3>
          <p style={styles.bodyText}>
            Thank you — there's nothing else you need to do before the visit.
            {hasAftercare
              ? " We'll be in touch about aftercare afterwards."
              : ''}
          </p>
          <p style={styles.reviewHint}>
            After the visit, this page will ask how we did — your feedback genuinely helps us.
          </p>
        </div>
      )}

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

function SectionHeader({ label, done, onToggle, expanded }) {
  // Completed steps become a button so they can be reopened; the active
  // step stays a plain heading, since there's nothing to toggle.
  if (done && onToggle) {
    return (
      <button type="button" onClick={onToggle} style={styles.sectionHeaderBtn}>
        <h3 style={styles.sectionTitle}>{label}</h3>
        <span style={styles.headerRight}>
          <span style={styles.reviewHint}>{expanded ? 'Hide' : 'View'}</span>
          <span style={styles.sectionTick}>✓</span>
        </span>
      </button>
    );
  }
  return (
    <div style={styles.sectionHeader}>
      <h3 style={styles.sectionTitle}>{label}</h3>
      {done && <span style={styles.sectionTick}>✓</span>}
    </div>
  );
}

function WelcomeSection({ content, isActive, onContinue, expanded, onToggle }) {
  if (!isActive) {
    return (
      <>
        <SectionHeader label="About your visit" done onToggle={onToggle} expanded={expanded} />
        {expanded && <p style={styles.bodyText}>{content.educationalIntro}</p>}
      </>
    );
  }
  return (
    <>
      <SectionHeader label="About your visit" done={false} />
      <p style={styles.bodyText}>{content.educationalIntro}</p>
      <button onClick={onContinue} style={styles.primaryBtn}>Continue</button>
    </>
  );
}

function ConsentSection({ token, content, job, isActive, onSigned, expanded, onToggle }) {
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [signature, setSignature] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // A visit can cover two or three animals, each needing its own form.
  // Defaults to an empty list so a payload without `pets` — an older
  // cached response — still renders as a normal single-pet consent.
  const pets = content.pets || [];
  const signedCount = pets.filter((p) => p.consentSigned).length;
  // The next form to sign. undefined on a single-pet booking, which is
  // exactly what the server treats as "the first unsigned pet".
  const currentPet = pets.find((p) => !p.consentSigned);

  if (job.consentSigned && !isActive) {
    return (
      <>
        <SectionHeader label="Consent" done onToggle={onToggle} expanded={expanded} />
        {expanded && (
          <>
            <p style={styles.bodyText}>{content.consentTemplate}</p>
            <p style={styles.reviewHint}>
              You signed this. A copy was emailed to you, and is available here at any time.
            </p>
          </>
        )}
        <a
          href={`${API_URL}/public/journey/${token}/consent.pdf`}
          target="_blank"
          rel="noreferrer"
          style={styles.pdfLink}
        >
          📄 Download signed consent
        </a>
      </>
    );
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // petId names which form this is. The server defaults to the
      // first unsigned pet when it's omitted, so single-pet bookings are
      // unaffected.
      const result = await submitConsent(token, {
        signatureName: name.trim(), agree: true, signatureImage: signature,
        petId: currentPet?.id,
      });
      // More pets to sign: clear the pad and name rather than advancing
      // the journey. Carrying the previous signature over would let
      // someone submit the same drawing for a different animal without
      // noticing.
      if (result?.remaining?.length > 0) {
        setSignature(null);
        setName('');
        setError('');
        onSigned();
        return;
      }
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
        {/* Who will actually attend, and under what registration. A
            client signing consent for this is entitled to know exactly
            who is carrying it out — a name alone doesn't establish that
            they're a registered vet. */}
        {/* Which animal this form covers. On a multi-pet visit an
            unlabelled form is a real risk: the client could sign twice
            believing they'd covered both. */}
        {pets.length > 1 && currentPet && (
          <div style={styles.petBanner}>
            <div style={styles.petBannerLabel}>
              Consent {signedCount + 1} of {pets.length}
            </div>
            <div style={styles.petBannerName}>For {currentPet.name}</div>
            <div style={styles.petBannerHint}>
              Each pet needs its own form. You&apos;ll be asked to sign again for
              {' '}{pets.filter((p) => !p.consentSigned && p.id !== currentPet.id).map((p) => p.name).join(', ')}.
            </div>
          </div>
        )}

        {content.vet && (
          <div style={styles.vetBox}>
            <div style={styles.vetLabel}>Your attending veterinarian</div>
            <div style={styles.vetName}>{content.vet.fullName}</div>
            {content.vet.regNumber && (
              <div style={styles.vetMeta}>
                Veterinary registration no. {content.vet.regNumber}
                {content.vet.regState ? ` (${content.vet.regState})` : ''}
              </div>
            )}
          </div>
        )}

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

function PaymentSection({ token, bill, job, eway, isActive, onPaid, onSkip, expanded, onToggle }) {
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvn, setCvn] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const done = job.paymentStatus === 'paid';
  // Collapsed-but-paid still offers the receipt: the client will often
  // come back for it days later, long after this step stopped being the
  // active one.
  if (done && !isActive) {
    return (
      <>
        <SectionHeader label="Payment" done onToggle={onToggle} expanded={expanded} />
        {expanded && (
          <div style={styles.billBox}>
            {bill.lines.map((l, i) => (
              <div key={i} style={styles.billLine}><span>{l.label}</span><span>{formatMoney(l.amount)}</span></div>
            ))}
            <div style={{ ...styles.billLine, ...styles.billTotal }}>
              <span>Paid</span><span>{formatMoney(bill.total)}</span>
            </div>
          </div>
        )}
        <a href={`${API_URL}/public/journey/${token}/receipt.pdf`} target="_blank" rel="noreferrer" style={styles.pdfLink}>
          📄 Download receipt
        </a>
      </>
    );
  }

  const publicKey = import.meta.env.VITE_EWAY_PUBLIC_API_KEY;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!window.eCrypt || !publicKey) {
      setError('Payment form is still loading — try again in a moment.');
      return;
    }
    // eWay's Client Side Encryption key is a long RSA public key (~400+
    // characters). The eWay *API key* (epk-XXXX-...) is a different
    // credential entirely and cannot encrypt anything — passing it here
    // produces the cryptic "message too long for RSA", because the
    // library derives a tiny modulus from it and any card number
    // overflows. Checking the length turns that into an answer.
    if (!publicKey || publicKey.length < 100) {
      setError(
        'Card payments are not configured correctly: the eWay Client Side Encryption key is missing '
        + 'or is an API key rather than an encryption key. It should be a long block of characters, '
        + 'not "epk-...". Get it from eWay under My Account > API Key > Client Side Encryption.'
      );
      setSubmitting(false);
      return;
    }
    const [rawMonth, rawYear] = expiry.split('/');
    if (!rawMonth || !rawYear) {
      setError('Enter expiry as MM/YY.');
      return;
    }
    // eWay wants a zero-padded 2-digit month and a 2-digit year. A month
    // typed as "1" rather than "01", or a year pasted as "2028", is
    // rejected as an invalid expiry even though what the person entered
    // was perfectly valid — so normalise rather than blame the input.
    const expiryMonth = String(rawMonth).trim().padStart(2, '0');
    const expiryYear = String(rawYear).trim().slice(-2);
    if (!/^(0[1-9]|1[0-2])$/.test(expiryMonth)) {
      setError('That expiry month doesn\u2019t look right — use MM/YY, e.g. 03/29.');
      return;
    }

    setSubmitting(true);
    try {
      const encryptedCard = {
        number: window.eCrypt.encryptValue(cardNumber.replace(/\s/g, ''), publicKey),
        // eWay's Client Side Encryption encrypts the CARD NUMBER and CVN
        // ONLY. Expiry month and year must be sent as plain values —
        // encrypting them makes eWay unable to read them, which it
        // reports as "Invalid card expiry month/year" even when the
        // expiry entered was perfectly valid. The sensitive fields are
        // still never sent in the clear.
        expiryMonth,
        expiryYear,
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
      <SectionHeader label="Payment" done={done} />
      {done && (
        <a href={`${API_URL}/public/journey/${token}/receipt.pdf`} target="_blank" rel="noreferrer" style={styles.pdfLink}>
          📄 Download receipt
        </a>
      )}
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
              <input
                value={expiry}
                onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                inputMode="numeric"
                placeholder="MM/YY"
                autoComplete="cc-exp"
                maxLength={5}
                required
                style={styles.input}
              />
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

function AftercareSection({ token, content, isActive, onContinue, expanded, onToggle }) {
  if (!isActive) {
    return (
      <>
        <SectionHeader label="Aftercare" done onToggle={onToggle} expanded={expanded} />
        {expanded && (
          <>
            <p style={styles.bodyText}>{content.brochure}</p>
            {content.brochurePdf && (
              <a href={`${API_URL}/public/journey/${token}/brochure.pdf`} target="_blank" rel="noreferrer" style={styles.pdfLink}>
                📄 View brochure (PDF)
              </a>
            )}
          </>
        )}
      </>
    );
  }
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
  // Tracks whether the FEEDBACK COMMENT has been sent — not whether the
  // rating has. The previous version set this as soon as a low rating
  // was saved, which instantly hid the comment box, so a client who
  // rated us 1-4 was thanked and then given no way to say why.
  const [commentSent, setCommentSent] = useState(false);

  if (rating != null && !isActive) return <SectionHeader label="How did we do?" done />;

  const submit = async (value, withComment) => {
    setError('');
    setSubmitting(true);
    try {
      await submitReview(token, { rating: value, comment: withComment ? comment.trim() : undefined });
      onRated(value);
      if (withComment) setCommentSent(true);
      // Re-rating reopens the feedback prompt: someone who corrects 5
      // stars down to 2 has something to tell us, and the box would
      // otherwise stay closed from the earlier submission.
      else setCommentSent(false);
      // Five stars: hand off to Google. Opened synchronously-ish right
      // after the await; if a popup blocker stops it, the fallback link
      // below still gets them there.
      if (value === 5 && !withComment) {
        window.open(GOOGLE_REVIEW_URL, '_blank', 'noopener');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Save the rating immediately on tap so it's never lost, then invite
  // detail separately.
  const onStarClick = (value) => {
    if (submitting) return;
    // Deliberately NOT blocked when a rating already exists — changing
    // your mind is the whole point.
    if (value === rating) return;
    submit(value, false);
  };

  if (rating != null) {
    const isHigh = rating === 5;
    return (
      <>
        <SectionHeader label="How did we do?" done={isHigh || commentSent} />

        {/* Stays tappable after submitting. A mis-tap on a 5-point
            scale is easy and was previously permanent from the client's
            side, even though the server already accepts a changed
            rating. Nobody should be stuck having told us their goodbye
            was 1 star when they meant 5. */}
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
              aria-label={`Change rating to ${n} star${n === 1 ? '' : 's'}`}
            >
              {n <= (hoverStar || rating) ? '\u2605' : '\u2606'}
            </button>
          ))}
        </div>
        <p style={styles.reviewHint}>Tap a different star if that wasn&apos;t what you meant.</p>

        {isHigh ? (
          <>
            <p style={styles.bodyText}>
              Thank you — that means a great deal to us. If the Google review page didn't open, you can
              leave your review here.
            </p>
            <a href={GOOGLE_REVIEW_URL} target="_blank" rel="noreferrer" style={styles.pdfLink}>
              Leave a Google review
            </a>
          </>
        ) : commentSent ? (
          <p style={styles.bodyText}>
            Thank you — your feedback has been passed to our team, and we read every word of it.
          </p>
        ) : (
          <>
            <p style={styles.bodyText}>
              Thank you for being honest with us. We're sorry it wasn't better. If you're willing,
              please tell us what we could have done differently — it goes straight to our team.
            </p>
            {error && <p style={styles.errorText}>{error}</p>}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="What could we have done better?"
              style={{ ...styles.input, resize: 'vertical' }}
            />
            <button
              onClick={() => submit(rating, true)}
              disabled={submitting || !comment.trim()}
              style={styles.primaryBtn}
            >
              {submitting ? 'Sending\u2026' : 'Send feedback'}
            </button>
            <button onClick={() => setCommentSent(true)} style={styles.skipBtn}>
              No thanks
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
            {n <= hoverStar ? '\u2605' : '\u2606'}
          </button>
        ))}
      </div>
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
  sectionHeaderBtn: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  reviewHint: { fontSize: 11, color: 'var(--gm-ink-soft)' },
  sectionHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: 600, margin: 0 },
  sectionTick: { color: 'var(--gm-forest)', fontSize: 16, fontWeight: 700 },
  enRouteBanner: { background: 'var(--gm-forest)', color: '#fff', borderRadius: 'var(--gm-radius)', padding: '16px 18px', marginBottom: 18 },
  enRouteTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 18, fontWeight: 600, marginBottom: 4 },
  enRouteEta: { fontSize: 15, marginBottom: 4 },
  enRouteMeta: { fontSize: 12, opacity: 0.85, marginTop: 2 },
  petBanner: { background: 'var(--gm-honey-soft)', borderRadius: 'var(--gm-radius-sm)', padding: '12px 14px', marginBottom: 16 },
  petBannerLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#7A5A22', marginBottom: 3 },
  petBannerName: { fontSize: 17, fontWeight: 600, color: 'var(--gm-ink)' },
  petBannerHint: { fontSize: 12, color: '#7A5A22', marginTop: 4, lineHeight: 1.5 },
  vetBox: { background: 'var(--gm-line-soft)', borderRadius: 'var(--gm-radius-sm)', padding: '12px 14px', marginBottom: 16 },
  vetLabel: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginBottom: 4 },
  vetName: { fontSize: 16, fontWeight: 600, color: 'var(--gm-ink)' },
  vetMeta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 3 },
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
  starRowStatic: { display: 'flex', gap: 4, marginBottom: 12 },
  starStatic: { fontSize: 26, color: 'var(--gm-honey)', lineHeight: 1 },
  skipBtn: { width: '100%', background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 13, padding: '10px 0', marginTop: 4, textDecoration: 'underline', cursor: 'pointer' },
  starHint: { fontSize: 12, color: 'var(--gm-ink-soft)', fontStyle: 'italic' },
};
