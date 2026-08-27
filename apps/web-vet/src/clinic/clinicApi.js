import { apiFetch } from '../api.js';

export async function fetchMyClinic() {
  const res = await apiFetch('/clinics/me');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load your clinic');
  return data.clinic;
}

export async function fetchMyReferrals() {
  const res = await apiFetch('/clinics/referrals');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load your referrals');
  return data;
}

export async function submitReferral(payload) {
  const res = await apiFetch('/clinics/referrals', {
    method: 'POST', body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not send that referral');
  return data.referral;
}
