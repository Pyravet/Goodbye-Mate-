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
