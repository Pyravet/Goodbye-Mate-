import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { billBreakdown } from '../domain/pricing.js';
import { withPetCounts } from '../domain/jobPets.js';
import { statsByPeriod, statsByLocation, statsByVet, summaryStats } from '../domain/stats.js';

const router = Router();

// The whole dashboard is business performance and money — admin only,
// same bar as pricing settings and payouts.
router.use(requireAuth, requireRole('admin'));

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  granularity: z.enum(['week', 'month', 'year']).optional(),
});

/**
 * Every job in range, PRICED — each one run through the same
 * billBreakdown everything else in the app uses, never reimplemented.
 *
 * Defaults to the last 12 months when no range is given, since an
 * unbounded "all jobs ever" query only gets slower and less useful as
 * the business grows, and a dashboard that silently includes test data
 * from years ago would misrepresent current performance.
 */
async function loadPricedJobs({ from, to }) {
  const toDate = to || new Date().toISOString().slice(0, 10);
  const fromDate = from || (() => {
    const d = new Date(toDate);
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const { rows: jobs } = await query(
    `SELECT j.*, u.full_name AS vet_name
     FROM jobs j
     LEFT JOIN vets v ON v.id = j.assigned_vet_id
     LEFT JOIN users u ON u.id = v.user_id
     WHERE j.job_date BETWEEN $1 AND $2
     ORDER BY j.job_date`,
    [fromDate, toDate]
  );
  if (jobs.length === 0) return { jobs: [], fromDate, toDate };

  const { rows: itemRows } = await query(
    'SELECT job_id, label, amount, vet_payout FROM job_line_items WHERE job_id = ANY($1::uuid[])',
    [jobs.map((j) => j.id)]
  );
  const itemsByJob = new Map();
  for (const item of itemRows) {
    if (!itemsByJob.has(item.job_id)) itemsByJob.set(item.job_id, []);
    itemsByJob.get(item.job_id).push(item);
  }

  const { rows: pricingRows } = await query('SELECT config FROM pricing_settings WHERE id = true');
  const pricing = pricingRows[0].config;

  const withCounts = await withPetCounts(jobs);
  const priced = withCounts.map((job) => ({
    ...job,
    vetName: job.vet_name,
    // Only completed jobs are ever billed for real, but pricing every
    // job regardless costs nothing extra and means a status filter
    // applied downstream doesn't need a second code path.
    billTotal: billBreakdown(job, pricing, itemsByJob.get(job.id) || []).total,
  }));

  return { jobs: priced, fromDate, toDate };
}

/**
 * GET /stats
 *
 * Everything the dashboard needs in one call: headline figures, a
 * time-bucketed trend, and breakdowns by state, postcode and vet. One
 * call rather than four separate round trips for the same underlying
 * job set, which the frontend would otherwise have to keep in sync.
 */
router.get('/', asyncHandler(async (req, res) => {
  const parsed = rangeSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid date range' });

  const { jobs, fromDate, toDate } = await loadPricedJobs(parsed.data);
  const granularity = parsed.data.granularity || 'month';

  res.json({
    range: { from: fromDate, to: toDate, granularity },
    summary: summaryStats(jobs),
    byPeriod: statsByPeriod(jobs, granularity),
    byState: statsByLocation(jobs, 'state'),
    byPostcode: statsByLocation(jobs, 'postcode'),
    byVet: statsByVet(jobs),
  });
}));

/**
 * GET /stats/export.csv
 *
 * One row per job — the detail behind every summary number above, for
 * admin to pivot themselves in a spreadsheet for anything the dashboard
 * doesn't show directly. The dashboard's own totals are reproducible
 * from this export, which is what makes it trustworthy as the
 * underlying data rather than a second, potentially-disagreeing source.
 */
router.get('/export.csv', asyncHandler(async (req, res) => {
  const parsed = rangeSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid date range' });

  const { jobs, fromDate, toDate } = await loadPricedJobs(parsed.data);

  const header = [
    'Job number', 'Date', 'Status', 'Service type', 'Vet', 'Suburb', 'Postcode', 'State',
    'Bill total', 'Cancellation fee', 'Refunded', 'Referred by',
  ];
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    // Quoted whenever the value could otherwise break the CSV grid —
    // a comma, a quote, or a newline in a client name or note.
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = jobs.map((j) => [
    j.job_number,
    String(j.job_date).slice(0, 10),
    j.status,
    j.service_type,
    j.vetName || '',
    j.suburb || '',
    j.postcode || '',
    j.state || '',
    j.status === 'completed' ? j.billTotal.toFixed(2) : '',
    Number(j.cancellation_fee || 0).toFixed(2),
    Number(j.refunded_amount || 0).toFixed(2),
    j.referred_by_partner_id ? 'yes' : '',
  ].map(escape).join(','));

  const csv = [header.join(','), ...rows].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="goodbye-mate-stats-${fromDate}-to-${toDate}.csv"`);
  res.send(csv);
}));

export default router;
