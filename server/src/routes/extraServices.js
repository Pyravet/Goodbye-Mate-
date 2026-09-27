import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { logAction } from '../audit/log.js';

const router = Router();

/**
 * A saved catalog of optional add-on services, each with a price.
 *
 * Deliberately a separate small table rather than folded into the main
 * pricing JSON: pricing_settings is one row updated wholesale, and a
 * catalog that grows over time (add one, retire one, reorder) fits a
 * normal table with its own rows far better than a growing array buried
 * inside a settings blob.
 */

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  clientPrice: z.number().min(0),
  vetPayout: z.number().min(0).default(0),
});

// Admin only: this catalog decides what a vet is paid and what a
// client is charged, so it sits with the rest of pricing control.
router.use(requireAuth, requireRole('admin'));

/** List active services by default; ?all=1 includes retired ones. */
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, client_price AS "clientPrice", vet_payout AS "vetPayout",
            is_active AS "isActive"
     FROM extra_services
     ${req.query.all ? '' : 'WHERE is_active = true'}
     ORDER BY sort_order, name`
  );
  res.json({ services: rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid service' });
  }
  const { rows: maxRow } = await query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM extra_services');
  const { rows } = await query(
    `INSERT INTO extra_services (name, client_price, vet_payout, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, client_price AS "clientPrice", vet_payout AS "vetPayout", is_active AS "isActive"`,
    [parsed.data.name, parsed.data.clientPrice, parsed.data.vetPayout, maxRow[0].next]
  );
  await logAction({
    actorUserId: req.user.sub, action: 'extra_service_created',
    targetType: 'extra_service', targetId: rows[0].id, metadata: parsed.data,
  });
  res.status(201).json({ service: rows[0] });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const parsed = serviceSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid service' });
  }
  const { name, clientPrice, vetPayout } = parsed.data;
  const { rows } = await query(
    `UPDATE extra_services SET
       name = COALESCE($1, name),
       client_price = COALESCE($2, client_price),
       vet_payout = COALESCE($3, vet_payout),
       updated_at = now()
     WHERE id = $4
     RETURNING id, name, client_price AS "clientPrice", vet_payout AS "vetPayout", is_active AS "isActive"`,
    [name ?? null, clientPrice ?? null, vetPayout ?? null, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Service not found' });
  await logAction({
    actorUserId: req.user.sub, action: 'extra_service_updated',
    targetType: 'extra_service', targetId: req.params.id, metadata: parsed.data,
  });
  res.json({ service: rows[0] });
}));

/**
 * Retire, not delete.
 *
 * A DELETE would either cascade into every past job_line_items row that
 * used this service's name for its label (it doesn't reference this
 * table, so it wouldn't) or simply vanish from the picker while old
 * invoices still read fine — retiring just does the second, explicitly,
 * without pretending removal is destructive when the historical charge
 * is already its own independent row.
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE extra_services SET is_active = false, updated_at = now()
     WHERE id = $1
     RETURNING id, name, client_price AS "clientPrice", vet_payout AS "vetPayout", is_active AS "isActive"`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Service not found' });
  await logAction({
    actorUserId: req.user.sub, action: 'extra_service_retired',
    targetType: 'extra_service', targetId: req.params.id, metadata: { name: rows[0].name },
  });
  res.json({ service: rows[0] });
}));

export default router;
