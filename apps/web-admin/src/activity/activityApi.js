import { apiFetch } from '../api.js';

export async function fetchAuditLog(limit = 100) {
  const res = await apiFetch(`/audit?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to load audit log');
  const data = await res.json();
  return data.entries;
}

export async function fetchMessages() {
  const res = await apiFetch('/messages');
  if (!res.ok) throw new Error('Failed to load messages');
  const data = await res.json();
  return data.messages;
}

export async function fetchInternalInbox() {
  const res = await apiFetch('/jobs/messages/inbox');
  if (!res.ok) throw new Error('Failed to load messages');
  const data = await res.json();
  return data.threads;
}
