import { apiFetch } from './client.js';

async function json(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

export async function listConversations() {
  return (await json(await apiFetch('/conversations'), 'Failed to load messages')).conversations;
}

export async function fetchConversation(id) {
  return json(await apiFetch(`/conversations/${id}`), 'Failed to load conversation');
}

export async function listRecipients() {
  return (await json(await apiFetch('/conversations/recipients'), 'Failed to load contacts')).recipients;
}

export async function startConversation({ recipientIds, body, subject }) {
  return json(
    await apiFetch('/conversations', {
      method: 'POST',
      body: JSON.stringify({ recipientIds, body, subject }),
    }),
    'Failed to send message'
  );
}

export async function sendReply(conversationId, body) {
  return (await json(
    await apiFetch(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
    'Failed to send'
  )).message;
}

export async function deleteMessage(conversationId, messageId) {
  return json(
    await apiFetch(`/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' }),
    'Could not delete that message'
  );
}

// --- Notifications (the bell) ---

export async function fetchNotifications() {
  return json(await apiFetch('/notifications'), 'Failed to load notifications');
}

export async function markNotificationRead(id) {
  return json(await apiFetch(`/notifications/${id}/read`, { method: 'POST' }), 'Failed');
}

export async function markAllNotificationsRead() {
  return json(await apiFetch('/notifications/read-all', { method: 'POST' }), 'Failed');
}
