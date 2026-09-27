import { apiFetch } from '../api.js';

export async function fetchMyPartner() {
  const res = await apiFetch('/referral-partners/me');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load your account');
  return data.partner;
}

export async function fetchMyReferrals() {
  const res = await apiFetch('/referral-partners/referrals');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load your referrals');
  return data;
}

export async function submitReferral(payload) {
  const res = await apiFetch('/referral-partners/referrals', {
    method: 'POST', body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not send that referral');
  return data.referral;
}

export async function fetchMyPayouts() {
  const res = await apiFetch('/referral-partners/my-payouts');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load your payout history');
  return data.periods;
}
