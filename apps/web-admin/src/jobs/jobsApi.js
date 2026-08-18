import { apiFetch } from '../api.js';

export async function fetchJobs(view) {
  const qs = view ? `?view=${view}` : '';
  const res = await apiFetch(`/jobs${qs}`);
  if (!res.ok) throw new Error('Failed to load jobs');
  const data = await res.json();
  return data.jobs;
}

export async function fetchJob(id) {
  const res = await apiFetch(`/jobs/${id}`);
  if (!res.ok) throw new Error('Failed to load job');
  return res.json(); // { job, bill, payout }
}

export async function fetchAlerts() {
  const res = await apiFetch('/jobs/alerts/list');
  if (!res.ok) throw new Error('Failed to load alerts');
  const data = await res.json();
  return data.alerts;
}

export async function advanceStatus(id, status) {
  const res = await apiFetch(`/jobs/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
  if (!res.ok) throw new Error('Failed to update status');
  return res.json();
}

export async function completeJob(id) {
  const res = await apiFetch(`/jobs/${id}/complete`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Cannot complete job');
    err.missing = data.missing;
    throw err;
  }
  return data;
}

// PDF downloads need the auth header, so a plain <a href> won't work —
// fetch as a blob and trigger the browser's save dialog manually.
async function downloadPdf(path, fallbackFilename) {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error('Failed to generate PDF');
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match ? match[1] : fallbackFilename;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadInvoice(jobId, jobNumber) {
  return downloadPdf(`/jobs/${jobId}/invoice.pdf`, `Invoice-${jobNumber}.pdf`);
}

export function downloadQuote(jobId, jobNumber) {
  return downloadPdf(`/jobs/${jobId}/invoice.pdf?quote=1`, `Quote-${jobNumber}.pdf`);
}

export function downloadRcti(jobId, jobNumber) {
  return downloadPdf(`/jobs/${jobId}/rcti.pdf`, `RCTI-${jobNumber}.pdf`);
}

export async function emailDocument(jobId, type) {
  const res = await apiFetch(`/jobs/${jobId}/email-document`, { method: 'POST', body: JSON.stringify({ type }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send email');
  return data;
}

export async function smsQuote(jobId) {
  const res = await apiFetch(`/jobs/${jobId}/sms-quote`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send SMS');
  return data;
}

export async function assignVet(jobId, vetId) {
  const res = await apiFetch(`/jobs/${jobId}/assign`, {
    method: 'POST',
    body: JSON.stringify({ vetId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to assign vet');
  return data.job;
}

export async function sendJourneyLink(jobId) {
  const res = await apiFetch(`/jobs/${jobId}/send-journey-link`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send journey link');
  return data; // { ok, link, email, sms }
}

export async function whatsappQuote(jobId) {
  const res = await apiFetch(`/jobs/${jobId}/whatsapp-quote`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send WhatsApp message');
  return data;
}

// Sends the quote through every configured channel at once. Runs each
// independently so one failing (e.g. no phone on file, or WhatsApp not
// yet configured) doesn't block the others — callers get back which
// channels actually succeeded.
export async function sendQuoteEverywhere(jobId, { hasEmail, hasPhone }) {
  const results = { email: null, sms: null, whatsapp: null };
  if (hasEmail) {
    try { await emailDocument(jobId, 'quote'); results.email = 'sent'; }
    catch (err) { results.email = err.message; }
  } else {
    // Previously this branch silently did nothing, so a booking with no
    // client email looked identical to a failed send — the admin just saw
    // "no email arrived" with no explanation anywhere.
    results.email = 'no email address on file for this client';
  }
  if (hasPhone) {
    try { await smsQuote(jobId); results.sms = 'sent'; }
    catch (err) { results.sms = err.message; }
    try { await whatsappQuote(jobId); results.whatsapp = 'sent'; }
    catch (err) { results.whatsapp = err.message; }
  } else {
    results.sms = 'no phone number on file for this client';
  }
  return results;
}

export async function chargeJob(id, encryptedCard) {
  const res = await apiFetch(`/jobs/${id}/charge`, { method: 'POST', body: JSON.stringify({ encryptedCard }) });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'Payment failed');
    err.declined = res.status === 402;
    throw err;
  }
  return data;
}

// Internal admin<->vet thread for a job (separate from client-facing
// email/SMS messages).
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
