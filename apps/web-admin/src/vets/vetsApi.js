import { apiFetch } from '../api.js';

export async function fetchVets() {
  const res = await apiFetch('/vets');
  if (!res.ok) throw new Error('Failed to load vets');
  const data = await res.json();
  return data.vets;
}

export async function fetchVet(id) {
  const res = await apiFetch(`/vets/${id}`);
  if (!res.ok) throw new Error('Failed to load vet');
  const data = await res.json();
  return data.vet;
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
