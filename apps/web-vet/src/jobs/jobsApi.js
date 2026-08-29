import { apiFetch } from '../api.js';
import { downloadPdf } from '@goodbye-mate/web-shared/src/openPdf.js';

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

export async function notifyEnRoute(id, { lat, lng, etaMinutes }) {
  // lat/lng are optional now — the server falls back to the vet's own
  // estimate, or to no estimate at all, rather than refusing.
  const res = await apiFetch(`/jobs/${id}/en-route`, {
    method: 'POST',
    body: JSON.stringify({ lat, lng, etaMinutes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to notify client');
  return data; // { job, etaMinutes, distanceText, smsSent }
}

export async function markProcedureDone(id) {
  const res = await apiFetch(`/jobs/${id}/procedure-done`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to update');
  return res.json();
}

export async function fetchMedicalNotes(id) {
  const res = await apiFetch(`/jobs/${id}/medical-notes`);
  if (!res.ok) throw new Error('Failed to load notes');
  const data = await res.json();
  return data.entries;
}

/** Append a new, timestamped, attributed entry. Notes are never edited. */
export async function addMedicalNote(id, notes) {
  const res = await apiFetch(`/jobs/${id}/medical-notes`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to save note');
  return data.entries;
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

/** Open the veterinary record PDF (auth required, so fetched not linked). */
export async function openVetRecord(jobId) {
  await downloadPdf(
    () => apiFetch(`/jobs/${jobId}/vet-record.pdf`),
    `Veterinary-Record-${jobId}.pdf`
  );
}

export async function emailVetRecord(jobId, { to, message }) {
  const res = await apiFetch(`/jobs/${jobId}/email-vet-record`, {
    method: 'POST',
    body: JSON.stringify({ to: to || null, message: message || null }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send');
  return data;
}

/** The vet's live job offers — their own screen, separate from held jobs. */
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

/**
 * Download a signed consent form.
 *
 * The server already allows the assigned vet; there was simply no way
 * to ask for it. A vet is the person performing the procedure — they
 * should be able to see the form authorising it.
 *
 * @param {string} jobId
 * @param {string} [petId] which pet's form, when a visit covers several
 */
export async function downloadConsent(jobId, petId, filename) {
  const qs = petId ? `?petId=${petId}` : '';
  const res = await apiFetch(`/jobs/${jobId}/consent.pdf${qs}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not open the consent form');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'Consent.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on a timer rather than immediately: Safari on iOS can still
  // be reading the blob when the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
