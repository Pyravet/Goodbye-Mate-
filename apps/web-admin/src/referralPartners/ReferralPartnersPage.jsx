import { useState, useEffect, useCallback } from 'react';
import AppShell from '../layout/AppShell.jsx';
import {
  fetchReferralPartners, fetchReferralPartner, createReferralPartner, updateReferralPartner,
  updateReferralPartnerBankDetails, setReferralPartnerActive,
  fetchReferralPartnerUsers, createReferralPartnerUser,
  fetchReferralPayoutPeriods, approveReferralPayoutPeriod, markReferralPayoutPaid,
  openReferralStatement,
} from './referralPartnersApi.js';

const EMPTY = {
  name: '', type: 'other', phone: '', email: '', address: '',
  suburb: '', postcode: '', state: 'NSW', abn: '', isGstRegistered: false,
  commissionType: 'flat', commissionValue: 0, notes: '',
};

const TYPE_LABELS = {
  clinic: 'Veterinary clinic',
  funeral_home: 'Funeral home',
  pet_store: 'Pet store',
  other: 'Other',
};

/**
 * Third-party referral partners.
 *
 * Any business that refers clients on a commission basis — a clinic, a
 * funeral home, a pet store, or anything else. All treated identically:
 * a portal to submit referrals and see outcomes, a commission rate
 * (flat or percentage, admin's choice), and a payout run once referred
 * jobs complete.
 */
export default function ReferralPartnersPage() {
  const [partners, setPartners] = useState(null);
  const [selectedId, setSelectedId] = useState(null); // id, or 'new'
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchReferralPartners().then(setPartners).catch((e) => { setError(e.message); setPartners([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  if (selectedId) {
    return (
      <AppShell>
        <div style={styles.page}>
          <PartnerDetail
            partnerId={selectedId === 'new' ? null : selectedId}
            onClose={() => { setSelectedId(null); load(); }}
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={styles.page}>
        <div style={styles.head}>
          <h1 style={styles.title}>Referral partners</h1>
          <button onClick={() => setSelectedId('new')} style={styles.newBtn}>+ Add a partner</button>
        </div>
        <p style={styles.subtitle}>
          Any business that refers clients on a commission basis — a vet clinic, a funeral home,
          a pet store, or anything else. Each gets a login to submit referrals and follow what
          happened to them. Referrals land in your Requests inbox like any other enquiry, and a
          commission is owed once a referred job is marked complete.
        </p>

        {error && <p style={styles.error}>{error}</p>}

        {!partners ? (
          <p style={styles.empty}>Loading…</p>
        ) : partners.length === 0 ? (
          <p style={styles.empty}>No referral partners yet.</p>
        ) : (
          partners.map((p) => (
            <div key={p.id} className="gm-card" style={{ ...styles.row, ...(p.is_active ? {} : styles.rowOff) }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={styles.name}>
                  {p.name}
                  <span style={styles.typeTag}>{TYPE_LABELS[p.type] || p.type}</span>
                  {!p.is_active && (
                    /awaiting approval/.test(p.notes || '')
                      ? <span style={styles.warn}> · new application — awaiting approval</span>
                      : <span style={styles.inactive}> · inactive</span>
                  )}
                </div>
                <div style={styles.meta}>
                  {[p.suburb, p.state].filter(Boolean).join(' ') || 'No address'}
                  {p.phone && ` · ${p.phone}`}
                  {' · '}
                  {p.commission_type === 'percentage'
                    ? `${p.commission_value}% commission`
                    : `$${Number(p.commission_value).toFixed(2)} flat commission`}
                </div>
                <div style={styles.stats}>
                  {p.referral_count} referral{p.referral_count === 1 ? '' : 's'}
                  {' · '}{p.job_count} became job{p.job_count === 1 ? '' : 's'}
                  {' · '}{p.user_count} login{p.user_count === 1 ? '' : 's'}
                  {' · '}${Number(p.total_paid_or_owed || 0).toFixed(2)} paid or owed
                  {p.user_count === 0 && (
                    <strong style={styles.warn}> — no login yet, they can&apos;t sign in</strong>
                  )}
                </div>
              </div>
              <button onClick={() => setSelectedId(p.id)} style={styles.openBtn}>Open</button>
            </div>
          ))
        )}
      </div>
    </AppShell>
  );
}

function PartnerDetail({ partnerId, onClose }) {
  const [partner, setPartner] = useState(partnerId ? null : EMPTY);
  const [bankDetails, setBankDetails] = useState(null);
  const [tab, setTab] = useState('details');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!partnerId) return;
    fetchReferralPartner(partnerId)
      .then(({ partner: p, bankDetails: b }) => { setPartner(stripNulls(p)); setBankDetails(b); })
      .catch((e) => setError(e.message));
  }, [partnerId]);

  useEffect(() => { load(); }, [load]);

  if (!partner) return <p style={styles.empty}>Loading…</p>;

  return (
    <>
      <button onClick={onClose} style={styles.back}>← All referral partners</button>
      <h1 style={styles.title}>{partnerId ? partner.name : 'New referral partner'}</h1>

      {error && <p style={styles.error}>{error}</p>}

      {partnerId && (
        <div style={styles.tabs}>
          {['details', 'commission', 'bank', 'logins', 'payouts'].map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ ...styles.tabBtn, ...(tab === t ? styles.tabBtnActive : {}) }}
            >
              {t === 'bank' ? 'Bank details' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      )}

      {(!partnerId || tab === 'details') && (
        <DetailsCard partner={partner} partnerId={partnerId} onSaved={(p) => { setPartner(stripNulls(p)); if (!partnerId) onClose(); }} />
      )}
      {partnerId && tab === 'commission' && (
        <CommissionCard partner={partner} partnerId={partnerId} onSaved={(p) => setPartner(stripNulls(p))} />
      )}
      {partnerId && tab === 'bank' && (
        <BankDetailsCard partnerId={partnerId} bankDetails={bankDetails} onSaved={load} />
      )}
      {partnerId && tab === 'logins' && <LoginsCard partnerId={partnerId} />}
      {partnerId && tab === 'payouts' && <PayoutsCard partnerId={partnerId} />}
      {partnerId && tab === 'details' && (
        <StatusCard partner={partner} partnerId={partnerId} onChanged={onClose} />
      )}
    </>
  );
}

function DetailsCard({ partner, partnerId, onSaved }) {
  const [form, setForm] = useState(partner);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => setForm(partner), [partner]);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setSaved(false); };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = partnerId ? await updateReferralPartner(partnerId, form) : await createReferralPartner(form);
      onSaved(result);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Partner details</h3>
      {error && <p style={styles.error}>{error}</p>}
      {saved && <p style={styles.saved}>Saved.</p>}
      <Field label="Name"><input value={form.name} onChange={set('name')} style={styles.input} /></Field>
      <Field label="Type">
        <select value={form.type} onChange={set('type')} style={styles.input}>
          {Object.entries(TYPE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </Field>
      <div style={styles.formRow}>
        <Field label="Phone"><input value={form.phone} onChange={set('phone')} style={styles.input} /></Field>
        <Field label="Email"><input type="email" value={form.email} onChange={set('email')} style={styles.input} /></Field>
      </div>
      <Field label="Address"><input value={form.address} onChange={set('address')} style={styles.input} /></Field>
      <div style={styles.formRow}>
        <Field label="Suburb"><input value={form.suburb} onChange={set('suburb')} style={styles.input} /></Field>
        <Field label="Postcode"><input value={form.postcode} onChange={set('postcode')} style={styles.input} /></Field>
        <Field label="State">
          <select value={form.state} onChange={set('state')} style={styles.input}>
            {['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <Field label="ABN"><input value={form.abn} onChange={set('abn')} style={styles.input} /></Field>
      <label style={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={form.isGstRegistered === true}
          onChange={(e) => setForm((f) => ({ ...f, isGstRegistered: e.target.checked }))}
        />
        <span>This partner is GST registered</span>
      </label>
      <Field label="Notes (internal)">
        <textarea value={form.notes} onChange={set('notes')} rows={2} style={styles.input} />
      </Field>
      <button onClick={save} disabled={busy || !form.name.trim()} style={styles.saveBtn}>
        {busy ? 'Saving…' : partnerId ? 'Save changes' : 'Add referral partner'}
      </button>
    </div>
  );
}

function CommissionCard({ partner, partnerId, onSaved }) {
  const [type, setType] = useState(partner.commission_type || 'flat');
  const [value, setValue] = useState(partner.commission_value ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await updateReferralPartner(partnerId, { commissionType: type, commissionValue: Number(value) });
      onSaved(result);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Commission</h3>
      <p style={styles.hint}>
        Owed once a referred job is marked completed — not on booking, and not if it&apos;s
        cancelled. Choose whichever suits this partner; each partner can be set up differently.
      </p>
      {error && <p style={styles.error}>{error}</p>}
      {saved && <p style={styles.saved}>Saved.</p>}
      <div style={styles.commissionToggle}>
        <button
          onClick={() => setType('flat')}
          style={{ ...styles.toggleBtn, ...(type === 'flat' ? styles.toggleBtnActive : {}) }}
        >
          Flat amount
        </button>
        <button
          onClick={() => setType('percentage')}
          style={{ ...styles.toggleBtn, ...(type === 'percentage' ? styles.toggleBtnActive : {}) }}
        >
          Percentage of job total
        </button>
      </div>
      <Field label={type === 'percentage' ? 'Percentage (%)' : 'Amount per referral ($)'}>
        <input
          type="number" min="0" step="0.01" value={value}
          onChange={(e) => setValue(e.target.value)}
          style={styles.input}
        />
      </Field>
      <p style={styles.hint}>
        {type === 'percentage'
          ? `A $450 job would owe $${(450 * (Number(value) || 0) / 100).toFixed(2)}.`
          : `Every completed, referred job owes $${Number(value || 0).toFixed(2)}, regardless of the job's size.`}
      </p>
      <button onClick={save} disabled={busy} style={styles.saveBtn}>
        {busy ? 'Saving…' : 'Save commission rate'}
      </button>
    </div>
  );
}

function BankDetailsCard({ partnerId, bankDetails, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ bankAccountName: '', bankBsb: '', bankAccountNumber: '' });
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const onSave = async () => {
    setSaving(true);
    setError('');
    try {
      await updateReferralPartnerBankDetails(partnerId, form);
      setForm({ bankAccountName: '', bankBsb: '', bankAccountNumber: '' });
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Bank details (for payouts)</h3>
      {error && <p style={styles.error}>{error}</p>}
      {bankDetails?.hasBankDetails ? (
        <p style={styles.hint}>
          On file: {bankDetails.accountName || 'account'} · BSB {bankDetails.bsb} · Acc {bankDetails.accountNumber}
        </p>
      ) : (
        <p style={styles.hint}>No bank details on file yet.</p>
      )}
      <Field label="Account name"><input value={form.bankAccountName} onChange={set('bankAccountName')} placeholder="Leave blank to keep current" style={styles.input} /></Field>
      <div style={styles.formRow}>
        <Field label="BSB"><input value={form.bankBsb} onChange={set('bankBsb')} placeholder="123-456" style={styles.input} /></Field>
        <Field label="Account number"><input value={form.bankAccountNumber} onChange={set('bankAccountNumber')} placeholder="12345678" style={styles.input} /></Field>
      </div>
      <button onClick={onSave} disabled={saving} style={styles.saveBtn}>{saving ? 'Saving…' : 'Update bank details'}</button>
      <p style={styles.hint}>Encrypted before storage — only masked digits are ever shown again.</p>
    </div>
  );
}

function LoginsCard({ partnerId }) {
  const [users, setUsers] = useState(null);
  const [newUser, setNewUser] = useState({ fullName: '', email: '', password: '' });
  const [createdLogin, setCreatedLogin] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadUsers = useCallback(() => {
    fetchReferralPartnerUsers(partnerId).then(setUsers).catch(() => setUsers([]));
  }, [partnerId]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const addLogin = async () => {
    setBusy(true);
    setError('');
    try {
      const user = await createReferralPartnerUser(partnerId, newUser);
      setCreatedLogin({ ...user, password: newUser.password });
      setNewUser({ fullName: '', email: '', password: '' });
      loadUsers();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Logins</h3>
      <p style={styles.hint}>
        Each person who submits referrals needs their own login. Passwords are not emailed —
        set one here and pass it on directly.
      </p>
      {error && <p style={styles.error}>{error}</p>}

      {createdLogin && (
        <div style={styles.credBox}>
          <strong>Login created.</strong> Give these to {createdLogin.full_name} now — the
          password can&apos;t be shown again.
          <div style={styles.cred}>{createdLogin.email}</div>
          <div style={styles.cred}>{createdLogin.password}</div>
          <button onClick={() => setCreatedLogin(null)} style={styles.smallBtn}>Done</button>
        </div>
      )}

      {users === null ? (
        <p style={styles.hint}>Loading…</p>
      ) : users.length === 0 ? (
        <p style={styles.hint}>No logins yet — this partner can&apos;t sign in.</p>
      ) : (
        users.map((u) => (
          <div key={u.id} style={styles.userRow}>
            <span>{u.full_name}</span>
            <span style={styles.userEmail}>{u.email}</span>
          </div>
        ))
      )}

      <div style={styles.formRow}>
        <Field label="Name">
          <input value={newUser.fullName} onChange={(e) => setNewUser((u) => ({ ...u, fullName: e.target.value }))} style={styles.input} />
        </Field>
        <Field label="Email">
          <input type="email" value={newUser.email} onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))} style={styles.input} />
        </Field>
      </div>
      <Field label="Password (at least 10 characters)">
        <input value={newUser.password} onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))} style={styles.input} />
      </Field>
      <button
        onClick={addLogin}
        disabled={busy || !newUser.fullName || !newUser.email || newUser.password.length < 10}
        style={styles.secondaryBtn}
      >
        Create login
      </button>
    </div>
  );
}

/** Monday of the week containing `d`. */
function mondayOf(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.toISOString().slice(0, 10);
}

function PayoutsCard({ partnerId }) {
  const [periods, setPeriods] = useState(null);
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    fetchReferralPayoutPeriods(partnerId).then(setPeriods).catch((e) => { setError(e.message); setPeriods([]); });
  }, [partnerId]);

  useEffect(() => { load(); }, [load]);

  const approve = async () => {
    setBusy(true);
    setError('');
    try {
      await approveReferralPayoutPeriod({ partnerId, periodStart: weekStart });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (period) => {
    const ref = window.prompt('Payment reference (optional):') || null;
    try {
      await markReferralPayoutPaid(period.id, ref);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Payouts</h3>
      <p style={styles.hint}>
        Approving a week freezes the commission for every referred job that was completed in
        it — changing the commission rate afterwards will not alter an already-approved
        statement.
      </p>
      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.formRow}>
        <Field label="Week starting (Monday)">
          <input
            type="date" value={weekStart}
            onChange={(e) => setWeekStart(mondayOf(e.target.value))}
            style={styles.input}
          />
        </Field>
      </div>
      <button onClick={approve} disabled={busy} style={styles.saveBtn}>
        {busy ? 'Approving…' : 'Approve this week'}
      </button>

      <h4 style={styles.subheading}>History</h4>
      {periods === null ? (
        <p style={styles.hint}>Loading…</p>
      ) : periods.length === 0 ? (
        <p style={styles.hint}>No payout periods yet.</p>
      ) : (
        periods.map((p) => (
          <div key={p.id} style={styles.userRow}>
            <span>
              {p.statement_number || 'Draft'} · {p.period_start} – {p.period_end}
              {' · '}<strong>{p.status}</strong>
            </span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span>${Number(p.total).toFixed(2)}</span>
              {p.status !== 'draft' && (
                <button onClick={() => openReferralStatement(p.id, p.statement_number)} style={styles.smallBtn}>
                  Statement
                </button>
              )}
              {p.status === 'approved' && (
                <button onClick={() => markPaid(p)} style={styles.smallBtn}>Mark paid</button>
              )}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function StatusCard({ partner, partnerId, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="gm-card" style={styles.card}>
      <h3 style={styles.cardTitle}>Status</h3>
      {error && <p style={styles.error}>{error}</p>}
      <p style={styles.hint}>
        Deactivating stops this partner signing in or submitting referrals. Past referrals and
        payouts stay attributed to them — the record of where a job or a payment came from
        shouldn&apos;t disappear because a partnership ended.
      </p>
      <button
        onClick={async () => {
          setBusy(true);
          try { await setReferralPartnerActive(partnerId, !partner.is_active); onChanged(); }
          catch (err) { setError(err.message); setBusy(false); }
        }}
        style={partner.is_active ? styles.dangerBtn : styles.secondaryBtn}
      >
        {partner.is_active ? 'Deactivate this partner' : (/awaiting approval/.test(partner.notes || '') ? 'Approve this application' : 'Reactivate this partner')}
      </button>
    </div>
  );
}

/** Nulls from the API would render as the string "null" in inputs. */
function stripNulls(obj) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v ?? '']));
}

function Field({ label, children }) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{label}</span>
      {children}
    </label>
  );
}

const styles = {
  page: { padding: '24px 28px', maxWidth: 760 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 24, marginBottom: 4 },
  subtitle: { fontSize: 13, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 18 },
  back: { background: 'none', border: 'none', color: 'var(--gm-ink-soft)', fontSize: 13, marginBottom: 10, padding: 0 },
  newBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '9px 16px', fontSize: 13, fontWeight: 500 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginBottom: 12 },
  saved: { fontSize: 13, color: 'var(--gm-forest)', marginBottom: 12 },
  empty: { fontSize: 13, color: 'var(--gm-ink-soft)' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: 14, marginBottom: 8 },
  rowOff: { opacity: 0.55 },
  name: { fontSize: 15, fontWeight: 600 },
  typeTag: { fontSize: 11, fontWeight: 500, color: 'var(--gm-forest)', background: '#E3E9E1', borderRadius: 999, padding: '2px 9px', marginLeft: 8 },
  inactive: { fontSize: 12, color: 'var(--gm-ink-soft)', fontWeight: 400 },
  meta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 2 },
  stats: { fontSize: 11, color: 'var(--gm-ink-soft)', marginTop: 4 },
  warn: { color: 'var(--gm-brick)' },
  openBtn: { background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '6px 14px', fontSize: 12, flexShrink: 0 },
  tabs: { display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid var(--gm-line)' },
  tabBtn: { background: 'none', border: 'none', padding: '8px 14px', fontSize: 13, color: 'var(--gm-ink-soft)', borderBottom: '2px solid transparent', cursor: 'pointer' },
  tabBtnActive: { color: 'var(--gm-forest)', fontWeight: 600, borderBottomColor: 'var(--gm-forest)' },
  card: { padding: 16, marginBottom: 12 },
  cardTitle: { fontFamily: 'var(--gm-font-display)', fontSize: 15, fontWeight: 600, marginBottom: 10 },
  subheading: { fontSize: 13, fontWeight: 600, marginTop: 16, marginBottom: 6 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', lineHeight: 1.6, marginBottom: 12 },
  field: { display: 'block', flex: 1, minWidth: 0, marginBottom: 10 },
  label: { display: 'block', fontSize: 11, color: 'var(--gm-ink-soft)', marginBottom: 3 },
  input: { width: '100%', padding: '9px 10px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', fontSize: 14, fontFamily: 'inherit', background: '#fff' },
  formRow: { display: 'flex', gap: 8 },
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10 },
  commissionToggle: { display: 'flex', gap: 8, marginBottom: 12 },
  toggleBtn: { flex: 1, padding: '9px 12px', borderRadius: 'var(--gm-radius-sm)', border: '1px solid var(--gm-line)', background: '#fff', fontSize: 13, cursor: 'pointer' },
  toggleBtnActive: { background: 'var(--gm-forest)', color: '#fff', borderColor: 'var(--gm-forest)' },
  saveBtn: { background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '10px 20px', fontSize: 14, fontWeight: 500 },
  secondaryBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 20px', fontSize: 14 },
  dangerBtn: { background: '#fff', color: 'var(--gm-brick)', border: '1px solid var(--gm-brick)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 20px', fontSize: 14 },
  smallBtn: { background: '#fff', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '6px 14px', fontSize: 12 },
  userRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '7px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  userEmail: { color: 'var(--gm-ink-soft)', fontSize: 12 },
  credBox: { background: 'var(--gm-honey-soft)', color: '#7A5A22', padding: '12px 14px', borderRadius: 'var(--gm-radius-sm)', marginBottom: 12, fontSize: 13, lineHeight: 1.6 },
  cred: { fontFamily: 'monospace', fontSize: 14, marginTop: 4, color: 'var(--gm-ink)' },
};
