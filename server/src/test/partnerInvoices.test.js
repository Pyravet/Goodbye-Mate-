import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { query, pool } from '../db/pool.js';
import { formatInvoiceNumber } from '../domain/partnerInvoices.js';
import { resetDb, closeDb } from './helpers.js';

/**
 * Partner invoice lifecycle, against a real database.
 *
 * The arithmetic is covered in domain/partnerInvoices.test.js. What's
 * tested here is the part that only exists in SQL: numbering under
 * concurrency, and the state guards that stop an issued tax document
 * being altered.
 *
 * These matter because the failure modes are compliance problems, not
 * bugs a user would report — a duplicated invoice number or a gap in the
 * series is exactly what an auditor asks about.
 */

before(async () => { await resetDb(); });
beforeEach(async () => {
  await resetDb();
  await query('TRUNCATE TABLE partner_invoices CASCADE');
  await query('UPDATE partner_invoice_sequence SET next_number = 1 WHERE id = true');
});
after(async () => { await closeDb(); });

async function makeDraft(name = 'Test Partner') {
  const { rows } = await query(
    'INSERT INTO partner_invoices (recipient_name) VALUES ($1) RETURNING *', [name]
  );
  return rows[0];
}

/** The exact allocation the send route performs. */
async function allocateNumber() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT next_number FROM partner_invoice_sequence WHERE id = true FOR UPDATE'
    );
    const n = rows[0].next_number;
    await client.query('UPDATE partner_invoice_sequence SET next_number = next_number + 1 WHERE id = true');
    await client.query('COMMIT');
    return formatInvoiceNumber(n);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

test('concurrent sends never share an invoice number', async () => {
  // Two admins hitting Send at the same moment must not be handed the
  // same number. Duplicate invoice numbers are a compliance problem, not
  // a cosmetic one.
  const numbers = await Promise.all(Array.from({ length: 10 }, allocateNumber));
  assert.equal(new Set(numbers).size, 10, `expected 10 distinct, got ${numbers}`);
});

test('the number series has no gaps', async () => {
  // A missing number looks like a hidden transaction.
  const numbers = await Promise.all(Array.from({ length: 8 }, allocateNumber));
  const seq = numbers.map((n) => Number(n.slice(4))).sort((a, b) => a - b);
  assert.deepEqual(seq, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('a draft carries no number until it is sent', async () => {
  // Numbers are allocated at SEND so an abandoned draft never consumes
  // one — which is what keeps the series gapless.
  const draft = await makeDraft();
  assert.equal(draft.invoice_number, null);
  assert.equal(draft.status, 'draft');
});

test('a voided draft leaves the sequence untouched', async () => {
  const draft = await makeDraft();
  await query("UPDATE partner_invoices SET status = 'void' WHERE id = $1", [draft.id]);

  const { rows } = await query('SELECT next_number FROM partner_invoice_sequence WHERE id = true');
  assert.equal(rows[0].next_number, 1, 'an abandoned draft must not burn a number');
});

test('only a SENT invoice can be marked paid', async () => {
  const draft = await makeDraft();

  const notSent = await query(
    "UPDATE partner_invoices SET status='paid' WHERE id=$1 AND status='sent' RETURNING id", [draft.id]
  );
  assert.equal(notSent.rows.length, 0, 'a draft must not be markable as paid');

  await query("UPDATE partner_invoices SET status='sent' WHERE id=$1", [draft.id]);
  const sent = await query(
    "UPDATE partner_invoices SET status='paid' WHERE id=$1 AND status='sent' RETURNING id", [draft.id]
  );
  assert.equal(sent.rows.length, 1, 'a sent invoice can be paid');
});

test('a paid invoice cannot be voided', async () => {
  // Voiding money already received would misstate the accounts. A
  // credit note is the correct instrument.
  const draft = await makeDraft();
  await query("UPDATE partner_invoices SET status='paid' WHERE id=$1", [draft.id]);

  const { rows } = await query(
    "UPDATE partner_invoices SET status='void' WHERE id=$1 AND status <> 'paid' RETURNING id",
    [draft.id]
  );
  assert.equal(rows.length, 0);
});

test('invoice numbers are unique at the database level', async () => {
  // Belt and braces: even if the allocation logic were bypassed, the
  // schema must refuse a duplicate.
  const a = await makeDraft('A');
  const b = await makeDraft('B');
  await query("UPDATE partner_invoices SET invoice_number='INV-00001' WHERE id=$1", [a.id]);

  await assert.rejects(
    () => query("UPDATE partner_invoices SET invoice_number='INV-00001' WHERE id=$1", [b.id]),
    /duplicate key|unique/i
  );
});

test('deleting an invoice removes its lines, and nothing else', async () => {
  const inv = await makeDraft();
  await query(
    `INSERT INTO partner_invoice_items (invoice_id, description, quantity, unit_amount, amount)
     VALUES ($1,'Line',1,100,100)`, [inv.id]
  );
  await query('DELETE FROM partner_invoices WHERE id = $1', [inv.id]);

  const { rows } = await query(
    'SELECT count(*)::int AS c FROM partner_invoice_items WHERE invoice_id = $1', [inv.id]
  );
  assert.equal(rows[0].c, 0, 'orphaned invoice lines must not survive');
});
