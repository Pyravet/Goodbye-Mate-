import { apiFetch } from '../api.js';

export async function fetchRequests(status) {
  const qs = status ? `?status=${status}` : '';
  const res = await apiFetch(`/booking-requests${qs}`);
  if (!res.ok) throw new Error('Failed to load requests');
  return (await res.json()).requests;
}

export async function updateRequest(id, { status, adminNotes }) {
  const res = await apiFetch(`/booking-requests/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status, adminNotes }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to update');
  return data.request;
}

export async function fetchNewRequestCount() {
  const res = await apiFetch('/booking-requests/new-count');
  if (!res.ok) return 0;
  return (await res.json()).count;
}
