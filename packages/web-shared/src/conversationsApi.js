/**
 * Conversations API.
 *
 * Lives in web-shared because admin and vet consume the identical
 * endpoints — the only difference is who they're allowed to message,
 * which the server decides. `apiFetch` is injected rather than imported
 * so each app keeps its own auth/token handling.
 */

async function json(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

export function makeConversationsApi(apiFetch) {
  return {
    async listConversations() {
      const res = await apiFetch('/conversations');
      return (await json(res, 'Failed to load messages')).conversations;
    },

    async fetchConversation(id) {
      const res = await apiFetch(`/conversations/${id}`);
      return json(res, 'Failed to load conversation');
    },

    async listRecipients() {
      const res = await apiFetch('/conversations/recipients');
      return (await json(res, 'Failed to load contacts')).recipients;
    },

    /**
     * @param {object} args
     * @param {string[]} args.recipientIds
     * @param {string} args.body
     * @param {string} [args.subject]
     * @param {boolean} [args.separateThreads] true = one private thread
     *   per recipient, so replies come back individually.
     */
    async startConversation({ recipientIds, body, subject, separateThreads }) {
      const res = await apiFetch('/conversations', {
        method: 'POST',
        body: JSON.stringify({ recipientIds, body, subject, separateThreads }),
      });
      return json(res, 'Failed to send message');
    },

    async sendReply(conversationId, body) {
      const res = await apiFetch(`/conversations/${conversationId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      return (await json(res, 'Failed to send')).message;
    },

    async addParticipant(conversationId, userId) {
      const res = await apiFetch(`/conversations/${conversationId}/participants`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      return json(res, 'Failed to add them');
    },

    async deleteMessage(conversationId, messageId) {
      const res = await apiFetch(`/conversations/${conversationId}/messages/${messageId}`, { method: 'DELETE' });
      return json(res, 'Could not delete that message');
    },

    async deleteConversation(conversationId) {
      const res = await apiFetch(`/conversations/${conversationId}`, { method: 'DELETE' });
      return json(res, 'Could not remove that conversation');
    },

    async unreadCount() {
      const res = await apiFetch('/conversations/unread/count');
      return (await json(res, 'Failed')).unread;
    },

    async broadcastThreads(broadcastId) {
      const res = await apiFetch(`/conversations/broadcasts/${broadcastId}`);
      return (await json(res, 'Failed to load replies')).threads;
    },
  };
}
