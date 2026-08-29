import { useState, useEffect } from 'react';
import { API_URL } from './api.js';

/**
 * Fallback copy.
 *
 * Used only if the settings fetch fails. A grieving person shouldn't hit
 * a blank page because a config request timed out, so the form always
 * has usable wording even with no network answer.
 */
const FALLBACK = {
  title: 'Request a visit',
  intro: "We're sorry you're facing this. Fill in as much as you can — only your name and phone number are needed, and we'll call you to talk through the rest.",
  contactSectionTitle: 'How can we reach you?',
  locationSectionTitle: 'Where are you?',
  petSectionTitle: 'About your pet',
  serviceSectionTitle: "What you're after",
  timingLabel: 'When would you like us to come?',
  timingPlaceholder: 'e.g. tomorrow morning, or as soon as possible',
  messageLabel: 'Anything else we should know?',
  submitLabel: 'Send request',
  privacyNote: "We'll only use these details to contact you about this request.",
  serviceOptions: [
    'Euthanasia only',
    'Euthanasia + private cremation (ashes returned)',
    'Euthanasia + communal cremation',
    "I'm not sure yet",
  ],
  thankYouTitle: 'Thank you',
  thankYouBody: "We've received your request and someone will call you shortly.",
  thankYouUrgent: 'If you need to speak with someone right away, please call us directly.',
};

/**
 * Public booking request form.
 *
 * Written for someone who has just decided to put their pet down. That
 * shapes several choices: almost every field is optional, timing is free
 * text rather than a date picker, there's no account to create, and the
 * copy avoids brisk commercial language. Only name and phone are
 * required — enough to call them back, which is what actually happens
 * next.
 */
export default function RequestPage() {
  const [form, setForm] = useState({
    clientName: '', clientPhone: '', clientEmail: '',
    address: '', suburb: '', postcode: '', state: '',
    petName: '', petType: '', petBreed: '', petAge: '',
    servicePreference: '', preferredTiming: '', message: '',
    handlingHelp: '', pace: '', petWeight: '',
    website: '', // honeypot — hidden from real users
  });
  const [status, setStatus] = useState('idle'); // idle | sending | sent
  const [error, setError] = useState('');
  const [copy, setCopy] = useState(FALLBACK);

  useEffect(() => {
    fetch(`${API_URL}/booking-requests/form-content`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        // Merge over the fallback so a partially-filled settings object
        // can't blank out individual labels.
        if (d?.content) setCopy({ ...FALLBACK, ...d.content });
      })
      .catch(() => { /* keep the fallback copy */ });
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Roughly the weight above which a vet may need a second person.
  // Parsed loosely because people write "30kg", "approx 30", "30 kilos".
  // Only used to show a prompt — the real decision is made by the
  // server, which applies the admin-configured threshold.
  const weightNum = Number(String(form.petWeight || '').replace(/[^\d.]/g, ''));
  const isHeavy = Number.isFinite(weightNum) && weightNum >= 30;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setStatus('sending');
    try {
      const res = await fetch(`${API_URL}/booking-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please call us instead.');
      setStatus('sent');
    } catch (err) {
      setError(err.message);
      setStatus('idle');
    }
  };

  if (status === 'sent') {
    return (
      <div style={styles.page}>
        <div style={styles.doneBox}>
          <h1 style={styles.doneTitle}>{copy.thankYouTitle}</h1>
          <p style={styles.doneBody}>
            {copy.thankYouBody}{' '}
            <strong>{form.clientPhone}</strong>.
          </p>
          <p style={styles.doneBody}>
            {copy.thankYouUrgent}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>{copy.title}</h1>
      <p style={styles.intro}>
{copy.intro}
      </p>

      <form onSubmit={submit}>
        {error && <p style={styles.error}>{error}</p>}

        <Section title={copy.contactSectionTitle} />
        <Field label="Your name" required>
          <input value={form.clientName} onChange={set('clientName')} required style={styles.input} />
        </Field>
        <Field label="Phone" required>
          <input type="tel" value={form.clientPhone} onChange={set('clientPhone')} required style={styles.input} />
        </Field>
        <Field label="Email">
          <input type="email" value={form.clientEmail} onChange={set('clientEmail')} style={styles.input} />
        </Field>

        <Section title={copy.locationSectionTitle} />
        <Field label="Address">
          <input value={form.address} onChange={set('address')} style={styles.input} />
        </Field>
        <div style={styles.row}>
          <Field label="Suburb" flex>
            <input value={form.suburb} onChange={set('suburb')} style={styles.input} />
          </Field>
          <Field label="Postcode" flex>
            <input value={form.postcode} onChange={set('postcode')} style={styles.input} />
          </Field>
        </div>

        <Section title={copy.petSectionTitle} />
        <div style={styles.row}>
          <Field label="Name" flex>
            <input value={form.petName} onChange={set('petName')} style={styles.input} />
          </Field>
          <Field label="Dog, cat, other" flex>
            <input value={form.petType} onChange={set('petType')} style={styles.input} />
          </Field>
        </div>
        <div style={styles.row}>
          <Field label="Breed" flex>
            <input value={form.petBreed} onChange={set('petBreed')} style={styles.input} />
          </Field>
          <Field label="Age" flex>
            <input value={form.petAge} onChange={set('petAge')} style={styles.input} />
          </Field>
          {/* Asked because a vet works alone. Over ~30kg they may need a
              second person, and that has to be arranged BEFORE the visit
              rather than discovered at the door. An estimate is fine. */}
          <Field label="Rough weight" flex>
            <input
              value={form.petWeight}
              onChange={set('petWeight')}
              placeholder="e.g. 30kg"
              style={styles.input}
            />
          </Field>
        </div>

        <Section title={copy.serviceSectionTitle} />
        <Field label="Service">
          <select value={form.servicePreference} onChange={set('servicePreference')} style={styles.input}>
            <option value="">Choose one…</option>
            {(copy.serviceOptions || []).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        {/* Free text, not a date picker: people say "tomorrow morning if
            possible" or "as soon as you can", and forcing an exact slot
            here would be both unkind and inaccurate — the real time gets
            confirmed on the phone. */}
        <Field label={copy.timingLabel}>
          <input
            value={form.preferredTiming}
            onChange={set('preferredTiming')}
            placeholder={copy.timingPlaceholder}
            style={styles.input}
          />
        </Field>
        {/* Asked here because it decides whether the visit can happen
            at all — a vet works alone, and finding out on the doorstep
            that nobody can lift a large dog is the worst possible
            moment. No prices are shown: if they answer no, admin talks
            it through on the phone, which is kinder than presenting a
            grieving family with a menu of surcharges. */}
        {isHeavy && (
          <p style={styles.heavyNote}>
            Because {form.petName || 'your pet'} is on the larger side, our vet may need a hand
            getting them to the vehicle. The next question matters — please answer honestly, and
            we&apos;ll sort out whatever&apos;s needed.
          </p>
        )}
        <Field label="If your pet needs to be carried to the vehicle, will someone be able to help?">
          <select value={form.handlingHelp} onChange={set('handlingHelp')} style={styles.input}>
            <option value="">Choose one…</option>
            <option value="client_helps">Yes, someone here can help</option>
            <option value="needs_help">No, we won&apos;t be able to help</option>
            <option value="not_needed">My pet is small enough to carry easily</option>
          </select>
        </Field>
        {form.handlingHelp === 'needs_help' && (
          <p style={styles.helpNote}>
            That&apos;s completely fine — we&apos;ll call you to sort it out. We can either send
            an extra person with the vet, or arrange for our cremation partner to collect
            directly. We&apos;ll explain both and what each costs before anything is booked.
          </p>
        )}

        <Field label="How would you like the visit to go?">
          <select value={form.pace} onChange={set('pace')} style={styles.input}>
            <option value="">Choose one…</option>
            <option value="slow">Slowly — we&apos;d like time to say goodbye</option>
            <option value="normal">At a normal pace</option>
            <option value="quick">Fairly quickly, please</option>
          </select>
        </Field>

        <Field label={copy.messageLabel}>
          <textarea value={form.message} onChange={set('message')} rows={4} style={styles.input} />
        </Field>

        {/* Honeypot: hidden from people, filled in by naive bots. Kept
            out of the tab order and hidden from screen readers so it
            never traps a real user. */}
        <div style={styles.honeypot} aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input
            id="website"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={set('website')}
          />
        </div>

        <button type="submit" disabled={status === 'sending'} style={styles.submitBtn}>
          {status === 'sending' ? 'Sending…' : copy.submitLabel}
        </button>
        <p style={styles.privacy}>
{copy.privacyNote}
        </p>
      </form>
    </div>
  );
}

function Section({ title }) {
  return <h2 style={styles.section}>{title}</h2>;
}

function Field({ label, required, children, flex }) {
  return (
    <label style={{ ...styles.field, ...(flex ? { flex: 1, minWidth: 0 } : {}) }}>
      <span style={styles.label}>
        {label}{required && <span style={styles.req}> *</span>}
      </span>
      {children}
    </label>
  );
}

const styles = {
  page: { maxWidth: 480, margin: '0 auto', padding: '28px 16px 60px' },
  title: { fontSize: 24, marginBottom: 8 },
  intro: { fontSize: 14, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 20 },
  section: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--gm-ink-soft)', marginTop: 22, marginBottom: 10 },
  field: { display: 'block', marginBottom: 12 },
  label: { display: 'block', fontSize: 12, color: 'var(--gm-ink-soft)', marginBottom: 4 },
  req: { color: 'var(--gm-brick)' },
  heavyNote: { fontSize: 13, lineHeight: 1.6, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '11px 13px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 12 },
  helpNote: { fontSize: 13, lineHeight: 1.6, color: '#7A5A22', background: 'var(--gm-honey-soft)', padding: '11px 13px', borderRadius: 'var(--gm-radius-sm)', marginTop: -4, marginBottom: 14 },
  input: { width: '100%', padding: '11px 12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 16, fontFamily: 'inherit', background: '#fff' },
  row: { display: 'flex', gap: 10 },
  submitBtn: { width: '100%', padding: '14px', marginTop: 18, borderRadius: 'var(--gm-radius-sm)', border: 'none', background: 'var(--gm-forest)', color: '#fff', fontSize: 16, fontWeight: 500 },
  privacy: { fontSize: 11, color: 'var(--gm-ink-soft)', textAlign: 'center', marginTop: 12 },
  error: { color: 'var(--gm-brick)', fontSize: 13, marginBottom: 12 },
  honeypot: { position: 'absolute', left: '-9999px', width: 1, height: 1, overflow: 'hidden' },
  doneBox: { textAlign: 'center', padding: '48px 8px' },
  doneTitle: { fontSize: 26, marginBottom: 14 },
  doneBody: { fontSize: 15, color: 'var(--gm-ink)', lineHeight: 1.7, marginBottom: 12 },
};
