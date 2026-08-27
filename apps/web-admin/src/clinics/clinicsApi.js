import { apiFetch } from '../api.js';

export async function fetchClinics() {
  const res = await apiFetch('/clinics');
  if (!res.ok) throw new Error('Could not load clinics');
  return (await res.json()).clinics;
}

export async function createClinic(payload) {
  const res = await apiFetch('/clinics', { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not add that clinic');
  return data.clinic;
}

export async function updateClinic(id, payload) {
  const res = await apiFetch(`/clinics/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save that clinic');
  return data.clinic;
}

export async function setClinicActive(id, isActive) {
  const res = await apiFetch(`/clinics/${id}/set-active`, {
    method: 'POST', body: JSON.stringify({ isActive }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not update that clinic');
  return data.clinic;
}

export async function fetchClinicUsers(id) {
  const res = await apiFetch(`/clinics/${id}/users`);
  if (!res.ok) throw new Error('Could not load logins');
  return (await res.json()).users;
}

export async function createClinicUser(id, payload) {
  const res = await apiFetch(`/clinics/${id}/users`, { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not create that login');
  return data.user;
}
