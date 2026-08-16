import { apiFetch } from '../api.js';

export async function fetchMe() {
  const res = await apiFetch('/vets/me');
  if (!res.ok) throw new Error('Failed to load profile');
  return res.json(); // { vet, bankDetails }
}

export async function updateWeeklyHours(vetId, weeklyHours) {
  const res = await apiFetch(`/vets/${vetId}/weekly-hours`, {
    method: 'PUT',
    body: JSON.stringify(weeklyHours),
  });
  if (!res.ok) throw new Error('Failed to save availability');
  return res.json();
}

export async function setDateOverride(vetId, date, available) {
  const res = await apiFetch(`/vets/${vetId}/date-overrides/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ available }),
  });
  if (!res.ok) throw new Error('Failed to save date override');
  return res.json();
}

export async function fetchEarnings(vetId) {
  const res = await apiFetch(`/vets/${vetId}/earnings`);
  if (!res.ok) throw new Error('Failed to load earnings');
  return res.json();
}
