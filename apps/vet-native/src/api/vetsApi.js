import { apiFetch } from './client.js';

export async function fetchMyVetProfile() {
  const res = await apiFetch('/vets/me');
  if (!res.ok) throw new Error('Failed to load profile');
  return res.json(); // { vet, bankDetails }
}

export function saveVetProfile(vetId, payload) {
  return apiFetch(`/vets/${vetId}/profile`, { method: 'PUT', body: JSON.stringify(payload) });
}
