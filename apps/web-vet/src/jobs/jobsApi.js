import { apiFetch } from '../api.js';

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

// Internal admin<->vet thread for a job.
export async function fetchInternalMessages(jobId) {
  const res = await apiFetch(`/jobs/${jobId}/internal-messages`);
  if (!res.ok) throw new Error('Failed to load messages');
  const data = await res.json();
  return data.messages;
}

export async function sendInternalMessage(jobId, body) {
  const res = await apiFetch(`/jobs/${jobId}/internal-messages`, { method: 'POST', body: JSON.stringify({ body }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send message');
  return data.message;
}
