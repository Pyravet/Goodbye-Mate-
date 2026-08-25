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

/** Medical note entries — append-only, timestamped and attributed. */
export async function fetchMedicalNotes(id) {
  const res = await apiFetch(`/jobs/${id}/medical-notes`);
  if (!res.ok) throw new Error('Failed to load notes');
  return (await res.json()).entries;
}

export async function addMedicalNote(id, notes) {
  const res = await apiFetch(`/jobs/${id}/medical-notes`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save note');
  return data.entries;
}

export async function emailVetRecord(id, { to, message }) {
  const res = await apiFetch(`/jobs/${id}/email-vet-record`, {
    method: 'POST',
    body: JSON.stringify({ to: to || null, message: message || null }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send');
  return data;
}

/**
 * The vet's live offers. Its own endpoint rather than a filter on the
 * jobs list, because the server withholds client name, phone and street
 * address until a vet accepts — a job broadcast to five vets shouldn't
 * hand one family's details to the four who won't attend.
 */
export async function fetchMyOffers() {
  const res = await apiFetch('/jobs/offers/mine');
  if (!res.ok) throw new Error('Could not load your offers');
  return (await res.json()).offers;
}

/** Suggest a different date/time instead of accepting or declining. */
export async function proposeTime(jobId, { date, time, note }) {
  const res = await apiFetch(`/jobs/${jobId}/offer/propose-time`, {
    method: 'POST',
    body: JSON.stringify({ date, time, note }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not send your suggestion');
  return data;
}
