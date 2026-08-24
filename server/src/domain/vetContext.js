import { query } from '../db/pool.js';

// Small helper to cut down repeated `SELECT id FROM vets WHERE user_id = $1`
// lookups scattered across jobs.js — same query, same intent, every time.
export async function getVetIdForUser(userId) {
  const { rows } = await query('SELECT id FROM vets WHERE user_id = $1', [userId]);
  return rows[0]?.id || null;
}

// Gathers everything rankVets() needs, for every active vet, in a small
// number of queries. Kept separate from dispatch.js so the scoring logic
// stays pure/DB-free and testable.
export async function getVetsWithContextForJob(job) {
  const { rows: vets } = await query(
    `SELECT v.id, v.postcodes, v.weekly_hours, v.date_overrides, u.full_name, u.is_active
     FROM vets v
     JOIN users u ON u.id = v.user_id
     WHERE u.is_active = true`
  );

  if (vets.length === 0) return [];

  const vetIds = vets.map((v) => v.id);

  // Territory: null if the vet has no polygon drawn OR the job has no
  // coordinates yet (manually-entered address) — rankVets() falls back
  // to postcode matching in that case.
  let territoryRows = [];
  if (job.lat != null && job.lng != null) {
    const { rows } = await query(
      `SELECT id, ST_Contains(territory::geometry, ST_SetSRID(ST_MakePoint($1, $2), 4326)) AS contains
       FROM vets WHERE id = ANY($3) AND territory IS NOT NULL`,
      [job.lng, job.lat, vetIds]
    );
    territoryRows = rows;
  }
  const territoryById = Object.fromEntries(territoryRows.map((r) => [r.id, r.contains]));

  // Leave covering this job's date. Fetched in ONE query filtered to the
  // date rather than pulling every vet's whole leave history — the
  // ranking only ever asks about this one day.
  const { rows: leaveRows } = await query(
    `SELECT vet_id, starts_on, ends_on FROM vet_leave
     WHERE vet_id = ANY($1) AND $2::date BETWEEN starts_on AND ends_on`,
    [vetIds, job.job_date]
  );
  const leaveByVet = {};
  for (const l of leaveRows) {
    (leaveByVet[l.vet_id] ||= []).push(l);
  }

  // Every non-completed/cancelled job currently assigned to any of these vets.
  const { rows: activeJobs } = await query(
    `SELECT id, assigned_vet_id, job_date, job_time
     FROM jobs
     WHERE assigned_vet_id = ANY($1) AND status NOT IN ('completed', 'cancelled')`,
    [vetIds]
  );

  return vets.map((v) => ({
    id: v.id,
    full_name: v.full_name,
    postcodes: v.postcodes,
    weekly_hours: v.weekly_hours,
    date_overrides: v.date_overrides,
    territoryContainsPoint: v.id in territoryById ? territoryById[v.id] : null,
    activeJobCount: activeJobs.filter((j) => j.assigned_vet_id === v.id).length,
    otherActiveJobs: activeJobs.filter((j) => j.assigned_vet_id === v.id),
    leave: leaveByVet[v.id] || [],
  }));
}
