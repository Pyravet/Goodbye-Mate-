import { apiFetch } from './client.js';

export async function fetchMyVetProfile() {
  const res = await apiFetch('/vets/me');
  if (!res.ok) throw new Error('Failed to load profile');
  return res.json(); // { vet, bankDetails }
}

export function saveVetProfile(vetId, payload) {
  return apiFetch(`/vets/${vetId}/profile`, { method: 'PUT', body: JSON.stringify(payload) });
}

// --- Leave ---

export async function fetchLeave(vetId) {
  const res = await apiFetch(`/vets/${vetId}/leave`);
  if (!res.ok) throw new Error('Could not load your leave');
  return (await res.json()).leave;
}

export async function addLeave(vetId, { startsOn, endsOn, reason }) {
  const res = await apiFetch(`/vets/${vetId}/leave`, {
    method: 'POST',
    body: JSON.stringify({ startsOn, endsOn, reason }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save that leave');
  return data;
}

export async function removeLeave(vetId, leaveId) {
  const res = await apiFetch(`/vets/${vetId}/leave/${leaveId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Could not remove that leave');
  return res.json();
}

/**
 * The signed-in vet's own record.
 *
 * Named fetchMe because that's what /vets/me returns — the whole
 * envelope { vet, bankDetails }, not just the vet. Callers that only
 * want the profile use fetchMyVetProfile above, which unwraps it.
 */
export async function fetchMe() {
  const res = await apiFetch('/vets/me');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load your profile');
  return data;
}

/** Today / this week / this month / all-time payout totals. */
export async function fetchEarnings(vetId) {
  const res = await apiFetch(`/vets/${vetId}/earnings`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not load earnings');
  return data;
}
