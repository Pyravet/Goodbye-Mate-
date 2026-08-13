import { apiFetch } from '../api/client.js';

export async function fetchMyJobs(view) {
  const qs = view ? `?view=${view}` : '';
  const res = await apiFetch(`/jobs${qs}`);
  if (!res.ok) throw new Error('Failed to load jobs');
  const data = await res.json();
  return data.jobs;
}

export async function fetchJob(id) {
  const res = await apiFetch(`/jobs/${id}`);
  if (!res.ok) throw new Error('Failed to load job');
  return res.json();
}

export async function acceptOffer(id) {
  const res = await apiFetch(`/jobs/${id}/dispatch/accept`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to accept');
  return data.job;
}

export async function declineOffer(id) {
  const res = await apiFetch(`/jobs/${id}/dispatch/decline`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to decline');
  return data;
}

export async function markProcedureDone(id) {
  const res = await apiFetch(`/jobs/${id}/procedure-done`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to update');
  return res.json();
}

export async function saveMedicalNotes(id, notes) {
  const res = await apiFetch(`/jobs/${id}/medical-notes`, { method: 'PUT', body: JSON.stringify({ notes }) });
  if (!res.ok) throw new Error('Failed to save notes');
  return res.json();
}
