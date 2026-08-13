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
