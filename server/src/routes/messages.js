import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logAction } from '../audit/log.js';
import { draftSmsReply } from '../integrations/ai/draftSmsReply.js';
import { validateSmsText } from '../integrations/sms/validateSmsText.js';
import { sendTemplatedSms } from '../integrations/sms/msg91.js';

const router = Router();

const draftSchema = z.object({
  channel: z.literal('sms'), // whatsapp/email join this once those integrations land
  toAddress: z.string().min(3),
  context: z.record(z.any()), // enquiry text, pricing facts, etc — shape firms up with the Enquiries feature
});

function extractJson(raw) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Step 1: create a message and have Claude draft it. Every quote/reply
// goes through this — same approval gate for every channel, per your call.
router.post('/draft', requireAuth, requireRole('admin'), async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }
  const { channel, toAddress, context } = parsed.data;

  const { rows } = await query(
    `INSERT INTO messages (channel, to_address, context, status)
     VALUES ($1, $2, $3, 'claude_drafting')
     RETURNING id`,
    [channel, toAddress, JSON.stringify(context)]
  );
  const messageId = rows[0].id;

  let claudeRaw;
  try {
    claudeRaw = await draftSmsReply(context);
  } catch (err) {
    await query(`UPDATE messages SET status = 'claude_failed', error = $1, updated_at = now() WHERE id = $2`, [String(err.message), messageId]);
    return res.status(502).json({ error: 'claude_draft_failed', message: err.message, id: messageId });
  }

  await query(`UPDATE messages SET claude_raw = $1, status = 'claude_completed', updated_at = now() WHERE id = $2`, [claudeRaw, messageId]);

  const parsedJson = extractJson(claudeRaw);
  if (!parsedJson) {
    await query(`UPDATE messages SET status = 'claude_failed', error = 'could not extract JSON', updated_at = now() WHERE id = $1`, [messageId]);
    return res.status(502).json({ error: 'claude_parse_failed', raw: claudeRaw, id: messageId });
  }

  const v = validateSmsText(parsedJson.sms_text, 320);
  if (!v.ok) {
    await query(`UPDATE messages SET status = 'validation_failed', draft_text = $1, updated_at = now() WHERE id = $2`, [parsedJson.sms_text ?? null, messageId]);
    return res.status(400).json({ error: 'invalid_sms_text', reason: v.reason, id: messageId });
  }

  await query(`UPDATE messages SET draft_text = $1, status = 'pending_approval', updated_at = now() WHERE id = $2`, [v.text, messageId]);

  res.json({ id: messageId, draftText: v.text, status: 'pending_approval' });
});

// Step 2: admin reviews/edits the draft, then approves — this call both
// records the (possibly edited) final text and sends it in one step.
const approveSchema = z.object({
  finalText: z.string().min(1).max(320),
});

router.post('/:id/approve', requireAuth, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  }

  const { rows } = await query('SELECT * FROM messages WHERE id = $1', [id]);
  const message = rows[0];
  if (!message) return res.status(404).json({ error: 'Message not found' });
  if (message.status !== 'pending_approval') {
    return res.status(409).json({ error: `Cannot approve a message in status '${message.status}'` });
  }

  await query(
    `UPDATE messages SET draft_text = $1, status = 'approved', approved_by = $2, approved_at = now(), updated_at = now() WHERE id = $3`,
    [parsed.data.finalText, req.user.sub, id]
  );

  let providerResponse;
  try {
    if (message.channel === 'sms') {
      // "Thank you for trusting goodbye mate" is baked into the MSG91
      // template itself and appears after our text automatically — don't
      // duplicate it here.
      providerResponse = await sendTemplatedSms(message.to_address, 'genericMessage', {
        message: parsed.data.finalText,
      });
    } else {
      throw new Error(`Channel '${message.channel}' not yet wired to a provider`);
    }
  } catch (err) {
    await query(
      `UPDATE messages SET status = 'send_failed', error = $1, provider_response = $2, updated_at = now() WHERE id = $3`,
      [String(err.message), err.providerResponse ? JSON.stringify(err.providerResponse) : null, id]
    );
    return res.status(502).json({ error: 'send_failed', message: err.message, id });
  }

  const externalId = providerResponse?.message || providerResponse?.message_id || providerResponse?.id || null;

  await query(
    `UPDATE messages SET status = 'sent', provider_response = $1, external_id = $2, updated_at = now() WHERE id = $3`,
    [JSON.stringify(providerResponse), externalId, id]
  );

  await logAction({ actorUserId: req.user.sub, action: 'message_approved_and_sent', targetType: 'message', targetId: id });

  res.json({ id, status: 'sent', providerResponse });
});

router.get('/:id', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await query('SELECT * FROM messages WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Message not found' });
  res.json({ message: rows[0] });
});

router.get('/', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await query('SELECT * FROM messages ORDER BY created_at DESC LIMIT 100');
  res.json({ messages: rows });
});

export default router;
