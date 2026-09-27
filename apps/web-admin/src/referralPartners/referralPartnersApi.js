import { apiFetch } from '../api.js';
import { downloadPdf } from '@goodbye-mate/web-shared/src/openPdf.js';

export async function fetchReferralPartners() {
  const res = await apiFetch('/referral-partners');
  if (!res.ok) throw new Error('Could not load referral partners');
  return (await res.json()).partners;
}

export async function fetchReferralPartner(id) {
  const res = await apiFetch(`/referral-partners/${id}`);
  if (!res.ok) throw new Error('Could not load that partner');
  return res.json(); // { partner, bankDetails }
}

export async function createReferralPartner(payload) {
  const res = await apiFetch('/referral-partners', { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not add that partner');
  return data.partner;
}

export async function updateReferralPartner(id, payload) {
  const res = await apiFetch(`/referral-partners/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save that partner');
  return data.partner;
}

/**
 * Split from updateReferralPartner deliberately — the same separation
 * the vet profile uses — so a plain details edit can never accidentally
 * touch payout information.
 */
export async function updateReferralPartnerBankDetails(id, payload) {
  const res = await apiFetch(`/referral-partners/${id}/bank-details`, {
    method: 'PUT', body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save bank details');
  return data;
}

export async function setReferralPartnerActive(id, isActive) {
  const res = await apiFetch(`/referral-partners/${id}/set-active`, {
    method: 'POST', body: JSON.stringify({ isActive }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not update that partner');
  return data.partner;
}

export async function fetchReferralPartnerUsers(id) {
  const res = await apiFetch(`/referral-partners/${id}/users`);
  if (!res.ok) throw new Error('Could not load logins');
  return (await res.json()).users;
}

export async function createReferralPartnerUser(id, payload) {
  const res = await apiFetch(`/referral-partners/${id}/users`, { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not create that login');
  return data.user;
}

// --- Payouts ---

export async function fetchReferralPayoutPeriods(partnerId) {
  const res = await apiFetch(`/referral-partners/${partnerId}/payout-periods`);
  if (!res.ok) throw new Error('Could not load payout periods');
  return (await res.json()).periods;
}

export async function approveReferralPayoutPeriod({ partnerId, periodStart }) {
  const res = await apiFetch('/referral-partners/payout-periods/approve', {
    method: 'POST', body: JSON.stringify({ partnerId, periodStart }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not approve that period');
  return data.period;
}

export async function markReferralPayoutPaid(periodId, paymentReference) {
  const res = await apiFetch(`/referral-partners/payout-periods/${periodId}/mark-paid`, {
    method: 'POST', body: JSON.stringify({ paymentReference }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not mark that period paid');
  return data.period;
}

/**
 * Open a commission statement PDF. Fetched via apiFetch rather than a
 * plain link so the Authorization header is attached — the endpoint
 * requires auth, and a bare <a href> would just 401.
 */
export async function openReferralStatement(periodId, statementNumber) {
  await downloadPdf(
    () => apiFetch(`/referral-partners/payout-periods/${periodId}/statement.pdf`),
    `${statementNumber || 'statement'}.pdf`
  );
}
