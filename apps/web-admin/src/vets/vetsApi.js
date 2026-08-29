import { apiFetch } from '../api.js';

export async function fetchVets() {
  const res = await apiFetch('/vets');
  if (!res.ok) throw new Error('Failed to load vets');
  const data = await res.json();
  return data.vets;
}

export async function fetchVetReliability(vetId) {
  const res = await apiFetch(`/vets/${vetId}/reliability`);
  if (!res.ok) throw new Error('Failed to load reliability');
  return res.json();
}

export async function fetchVet(id) {
  const res = await apiFetch(`/vets/${id}`);
  if (!res.ok) throw new Error('Failed to load vet');
  return res.json(); // { vet, bankDetails }
}

export async function createVet(payload) {
  const res = await apiFetch('/vets', { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create vet');
  return data.vet;
}

export async function updateVetProfile(id, payload) {
  const res = await apiFetch(`/vets/${id}/profile`, { method: 'PUT', body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('Failed to update profile');
  const data = await res.json();
  return data.vet;
}

export async function updateWeeklyHours(id, weeklyHours) {
  const res = await apiFetch(`/vets/${id}/weekly-hours`, { method: 'PUT', body: JSON.stringify(weeklyHours) });
  if (!res.ok) throw new Error('Failed to update availability');
  return res.json();
}

export async function fetchTerritory(id) {
  const res = await apiFetch(`/vets/${id}/territory`);
  if (!res.ok) throw new Error('Failed to load territory');
  const data = await res.json();
  return data.geojson;
}

export async function fetchNearestVets(postcode) {
  const res = await apiFetch(`/vets/nearest?postcode=${encodeURIComponent(postcode)}`);
  if (!res.ok) throw new Error('Failed to check nearest vet');
  const data = await res.json();
  return data.ranked;
}

export async function approveVet(id) {
  const res = await apiFetch(`/vets/${id}/approve`, { method: 'PUT' });
  if (!res.ok) throw new Error('Failed to approve vet');
  return res.json();
}

export async function deactivateVet(id) {
  const res = await apiFetch(`/vets/${id}/deactivate`, { method: 'PUT' });
  if (!res.ok) throw new Error('Failed to deactivate vet');
  return res.json();
}

/**
 * Set or clear a single date's availability.
 *
 * The endpoint has existed since dispatch was built; nothing in admin
 * ever called it, so per-date availability was unreachable.
 *
 * @param {string} value true, false, or undefined to clear the override
 */
export async function setDateOverride(vetId, date, value) {
  const res = await apiFetch(`/vets/${vetId}/date-overrides/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ available: value === undefined ? null : value }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not update that date');
  return data;
}
