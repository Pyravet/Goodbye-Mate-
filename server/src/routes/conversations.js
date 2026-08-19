import { Router } from 'express';
import { z } from 'zod';
import { pool, query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAction } from '../audit/log.js';
import { sendPushToUser } from '../integrations/push/webPush.js';
import { sendExpoPushToUser } from '../integrations/push/expoPush.js';

const router = Router();

/**
 * Confirm the caller is a participant, and return the conversation.
 *
 * Every read and write goes through this. Membership is the ONLY access
 * rule — deliberately including admin, who does not get blanket access
 * to conversations they aren't part of. Broadcast replies are meant to
 * be private between admin and one vet; a general admin override would
 * quietly defeat that.
 */
async function loadIfParticipant(conversationId, userId) {
  const { rows } = await query(
    `SELECT c.* FROM conversations c
     JOIN conversation_participants p ON p.conversation_id = c.id
     WHERE c.id = $1 AND p.user_id = $2`,
    [conversationId, userId]
  );
  return rows[0] || null;
}

/**
 * GET /conversations — the caller's inbox.
 *
 * Returns each conversation with its other participants, a preview of
 * the latest message, and an unread count. Built as a single query with
 * lateral joins rather than a loop, so the inbox is one round trip
 * regardless of how many conversations someone has.
 */
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT
       c.id, c.kind, c.subject, c.broadcast_id, c.last_message_at,
       me.last_read_at,
       last_msg.body        AS last_body,
       last_msg.sender_name AS last_sender_name,
       last_msg.created_at  AS last_created_at,
       COALESCE(unread.count, 0)::int AS unread_count,
       others.names         AS other_names
     FROM conversations c
     JOIN conversation_participants me
       ON me.conversation_id = c.id AND me.user_id = $1
     LEFT JOIN LATERAL (
       SELECT body, sender_name, created_at
       FROM conversation_messages m
       WHERE m.conversation_id = c.id
       ORDER BY m.created_at DESC
       LIMIT 1
     ) last_msg ON true
     LEFT JOIN LATERAL (
       SELECT count(*) AS count
       FROM conversation_messages m
       WHERE m.conversation_id = c.id
         AND m.sender_user_id <> $1
         AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)
     ) unread ON true
     LEFT JOIN LATERAL (
       SELECT string_agg(u.full_name, ', ' ORDER BY u.full_name) AS names
       FROM conversation_participants p2
       JOIN users u ON u.id = p2.user_id
       WHERE p2.conversation_id = c.id AND p2.user_id <> $1
     ) others ON true
     ORDER BY c.last_message_at DESC`,
    [req.user.sub]
  );

  res.json({
    conversations: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      // Direct threads are titled from the other person rather than a
      // stored subject, so a name change doesn't leave a stale label.
      title: r.subject || r.other_names || 'Conversation',
      otherNames: r.other_names,
      broadcastId: r.broadcast_id,
      lastMessage: r.last_body,
      lastSenderName: r.last_sender_name,
      lastMessageAt: r.last_created_at || r.last_message_at,
      unreadCount: r.unread_count,
    })),
  });
}));

/** Everyone the caller may start a conversation with. */
router.get('/recipients', requireAuth, asyncHandler(async (req, res) => {
  // Admin can message any active vet; a vet can only message admins.
  // Vet-to-vet messaging is deliberately not offered — vets are
  // independent contractors who don't necessarily know one another, and
  // opening that up has privacy implications nobody asked for.
  const sql = req.user.role === 'admin'
    ? `SELECT u.id, u.full_name, u.role FROM users u
       WHERE u.role = 'vet' AND u.is_active = true ORDER BY u.full_name`
    : `SELECT u.id, u.full_name, u.role FROM users u
       WHERE u.role = 'admin' AND u.is_active = true ORDER BY u.full_name`;
  const { rows } = await query(sql);
  res.json({ recipients: rows });
}));

// IMPORTANT: these two must be declared BEFORE '/:id' below. Express
// matches in declaration order, so '/unread/count' and
// '/broadcasts/:id' would otherwise be captured by '/:id' and treated
// as conversation IDs — returning 404 for a route that exists.
/** Total unread across all conversations — powers the inbox badge. */
router.get('/unread/count', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count
     FROM conversation_messages m
     JOIN conversation_participants p
       ON p.conversation_id = m.conversation_id AND p.user_id = $1
     WHERE m.sender_user_id <> $1
       AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)`,
    [req.user.sub]
  );
  res.json({ unread: rows[0].count });
}));

/**
 * GET /broadcasts/:broadcastId — all reply threads from one broadcast.
 *
 * Admin-only, and scoped to broadcasts this admin created: the point is
 * to see who has replied to "can anyone cover Thursday?" without opening
 * each thread individually.
 */
router.get('/broadcasts/:broadcastId', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT c.id, c.subject, c.last_message_at,
            others.names AS recipient_name,
            last_msg.body AS last_body,
            last_msg.sender_name AS last_sender_name,
            (last_msg.sender_user_id <> $2) AS has_replied
     FROM conversations c
     LEFT JOIN LATERAL (
       SELECT string_agg(u.full_name, ', ') AS names
       FROM conversation_participants p JOIN users u ON u.id = p.user_id
       WHERE p.conversation_id = c.id AND p.user_id <> $2
     ) others ON true
     LEFT JOIN LATERAL (
       SELECT body, sender_name, sender_user_id
       FROM conversation_messages m
       WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1
     ) last_msg ON true
     WHERE c.broadcast_id = $1 AND c.created_by = $2
     ORDER BY others.names`,
    [req.params.broadcastId, req.user.sub]
  );
  res.json({ threads: rows });
}));

/** Full message history for one conversation, and marks it read. */
router.get('/:id', requireAuth, asyncHandler(async (req, res) => {
  const conversation = await loadIfParticipant(req.params.id, req.user.sub);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

  const { rows: messages } = await query(
    `SELECT id, sender_user_id, sender_name, body, created_at
     FROM conversation_messages WHERE conversation_id = $1 ORDER BY created_at`,
    [req.params.id]
  );

  const { rows: participants } = await query(
    `SELECT u.id, u.full_name, u.role
     FROM conversation_participants p JOIN users u ON u.id = p.user_id
     WHERE p.conversation_id = $1 ORDER BY u.full_name`,
    [req.params.id]
  );

  // Opening the thread is what clears unread — not merely receiving a
  // message — so the inbox badge reflects "you haven't looked at this".
  await query(
    'UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
    [req.params.id, req.user.sub]
  );

  res.json({
    conversation: {
      id: conversation.id,
      kind: conversation.kind,
      subject: conversation.subject,
      broadcastId: conversation.broadcast_id,
    },
    participants,
    messages,
  });
}));

const startSchema = z.object({
  recipientIds: z.array(z.string().uuid()).min(1, 'Choose at least one recipient.'),
  body: z.string().trim().min(1, 'Write a message.'),
  subject: z.string().trim().max(200).optional().nullable(),
  /**
   * true  -> one SEPARATE conversation per recipient (they can't see
   *          each other; replies come back individually)
   * false -> one shared group conversation
   *
   * This is the whole point of the feature, so it's an explicit choice
   * rather than something inferred from recipient count.
   */
  separateThreads: z.boolean().optional().default(false),
});

/**
 * POST /conversations — start a conversation, or broadcast to several.
 *
 * The entire operation runs in one transaction: a broadcast that
 * half-created its threads would leave some vets messaged and others
 * not, with no clean way to retry.
 */
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid request' });
  }
  const { recipientIds, body, subject, separateThreads } = parsed.data;

  // Deduplicate, and never include the sender as their own recipient.
  const recipients = [...new Set(recipientIds)].filter((id) => id !== req.user.sub);
  if (recipients.length === 0) {
    return res.status(400).json({ error: 'Choose at least one other person.' });
  }

  const { rows: senderRows } = await query('SELECT full_name FROM users WHERE id = $1', [req.user.sub]);
  const senderName = senderRows[0]?.full_name || 'Unknown';

  // Verify every recipient exists and is active before creating
  // anything, rather than failing partway through.
  const { rows: validRows } = await query(
    'SELECT id, full_name FROM users WHERE id = ANY($1::uuid[]) AND is_active = true',
    [recipients]
  );
  if (validRows.length !== recipients.length) {
    return res.status(400).json({ error: 'One or more recipients are not available.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const created = [];
    const notify = [];

    if (separateThreads && recipients.length > 1) {
      // Fan out: one private thread per recipient, linked by broadcast_id.
      const { rows: bidRows } = await client.query('SELECT gen_random_uuid() AS id');
      const broadcastId = bidRows[0].id;

      for (const recipientId of recipients) {
        const { rows: convRows } = await client.query(
          `INSERT INTO conversations (kind, subject, broadcast_id, created_by, last_message_at)
           VALUES ('broadcast_child', $1, $2, $3, now()) RETURNING id`,
          [subject || null, broadcastId, req.user.sub]
        );
        const convId = convRows[0].id;

        await client.query(
          `INSERT INTO conversation_participants (conversation_id, user_id, last_read_at)
           VALUES ($1, $2, now()), ($1, $3, NULL)`,
          [convId, req.user.sub, recipientId]
        );
        await client.query(
          `INSERT INTO conversation_messages (conversation_id, sender_user_id, sender_name, body)
           VALUES ($1, $2, $3, $4)`,
          [convId, req.user.sub, senderName, body]
        );

        created.push(convId);
        notify.push({ userId: recipientId, conversationId: convId });
      }
    } else {
      const kind = recipients.length > 1 ? 'group' : 'direct';
      const { rows: convRows } = await client.query(
        `INSERT INTO conversations (kind, subject, created_by, last_message_at)
         VALUES ($1, $2, $3, now()) RETURNING id`,
        [kind, subject || null, req.user.sub]
      );
      const convId = convRows[0].id;

      // Sender is marked read immediately; recipients are not.
      await client.query(
        `INSERT INTO conversation_participants (conversation_id, user_id, last_read_at)
         VALUES ($1, $2, now())`,
        [convId, req.user.sub]
      );
      for (const recipientId of recipients) {
        await client.query(
          `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2)`,
          [convId, recipientId]
        );
        notify.push({ userId: recipientId, conversationId: convId });
      }
      await client.query(
        `INSERT INTO conversation_messages (conversation_id, sender_user_id, sender_name, body)
         VALUES ($1, $2, $3, $4)`,
        [convId, req.user.sub, senderName, body]
      );

      created.push(convId);
    }

    await client.query('COMMIT');

    await logAction({
      actorUserId: req.user.sub,
      action: separateThreads && recipients.length > 1 ? 'message_broadcast_sent' : 'conversation_started',
      targetType: 'conversation',
      targetId: created[0],
      metadata: { recipients: recipients.length, separateThreads },
    });

    // Notify outside the transaction — a push failure must not roll back
    // messages that were genuinely sent.
    for (const n of notify) {
      const preview = body.slice(0, 120);
      sendPushToUser(n.userId, { title: `Message from ${senderName}`, body: preview, url: `/messages/${n.conversationId}` })
        .catch((e) => console.error('message push failed:', e.message));
      sendExpoPushToUser(n.userId, { title: `Message from ${senderName}`, body: preview, url: `/messages/${n.conversationId}` })
        .catch((e) => console.error('message expo push failed:', e.message));
    }

    res.status(201).json({ conversationIds: created, count: created.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

const replySchema = z.object({
  body: z.string().trim().min(1, 'Write a message.'),
});

/** Reply in an existing conversation. */
router.post('/:id/messages', requireAuth, asyncHandler(async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid message' });
  }

  const conversation = await loadIfParticipant(req.params.id, req.user.sub);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

  const { rows: senderRows } = await query('SELECT full_name FROM users WHERE id = $1', [req.user.sub]);
  const senderName = senderRows[0]?.full_name || 'Unknown';

  const { rows } = await query(
    `INSERT INTO conversation_messages (conversation_id, sender_user_id, sender_name, body)
     VALUES ($1, $2, $3, $4) RETURNING id, sender_user_id, sender_name, body, created_at`,
    [req.params.id, req.user.sub, senderName, parsed.data.body]
  );

  // Keeps the inbox ordered without a subquery over messages.
  await query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [req.params.id]);
  await query(
    'UPDATE conversation_participants SET last_read_at = now() WHERE conversation_id = $1 AND user_id = $2',
    [req.params.id, req.user.sub]
  );

  const { rows: others } = await query(
    'SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id <> $2',
    [req.params.id, req.user.sub]
  );
  const preview = parsed.data.body.slice(0, 120);
  for (const o of others) {
    sendPushToUser(o.user_id, { title: `Message from ${senderName}`, body: preview, url: `/messages/${req.params.id}` })
      .catch((e) => console.error('reply push failed:', e.message));
    sendExpoPushToUser(o.user_id, { title: `Message from ${senderName}`, body: preview, url: `/messages/${req.params.id}` })
      .catch((e) => console.error('reply expo push failed:', e.message));
  }

  res.status(201).json({ message: rows[0] });
}));

const addParticipantSchema = z.object({
  userId: z.string().uuid(),
});

/**
 * Add someone to an existing conversation.
 *
 * Broadcast children are excluded: those threads are private one-to-one
 * replies, and adding a third party would retrospectively expose a
 * conversation the vet reasonably believed was between them and admin.
 */
router.post('/:id/participants', requireAuth, asyncHandler(async (req, res) => {
  const parsed = addParticipantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A user must be selected' });

  const conversation = await loadIfParticipant(req.params.id, req.user.sub);
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  if (conversation.kind === 'broadcast_child') {
    return res.status(400).json({
      error: "This is a private reply thread from a broadcast — start a new group message instead of adding someone here.",
    });
  }

  const { rows: userRows } = await query(
    'SELECT id, full_name FROM users WHERE id = $1 AND is_active = true',
    [parsed.data.userId]
  );
  if (!userRows[0]) return res.status(400).json({ error: 'That person is not available.' });

  // last_read_at = now() so joining doesn't mark the entire back
  // catalogue unread for them.
  await query(
    `INSERT INTO conversation_participants (conversation_id, user_id, last_read_at)
     VALUES ($1, $2, now()) ON CONFLICT DO NOTHING`,
    [req.params.id, parsed.data.userId]
  );

  // Promote a direct thread to a group now that it has three people.
  await query(
    `UPDATE conversations SET kind = 'group' WHERE id = $1 AND kind = 'direct'`,
    [req.params.id]
  );

  await logAction({
    actorUserId: req.user.sub,
    action: 'conversation_participant_added',
    targetType: 'conversation',
    targetId: req.params.id,
    metadata: { addedUserId: parsed.data.userId },
  });

  sendPushToUser(parsed.data.userId, {
    title: 'Added to a conversation',
    body: conversation.subject || 'You were added to a message thread.',
    url: `/messages/${req.params.id}`,
  }).catch((e) => console.error('add participant push failed:', e.message));

  res.json({ ok: true });
}));

export default router;
