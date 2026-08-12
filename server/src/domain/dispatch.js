// Ported from the prototype's rankVets/isVetAvailableAtDateTime/hasTimeConflict,
// with one real upgrade: territory matching prefers the actual polygon
// (point-in-polygon, from migration 002) when the vet has one drawn and
// the job has real lat/lng from Google Places. Falls back to the
// prototype's postcode-prefix matching otherwise — e.g. a vet with no
// territory drawn yet, or a manually-entered address with no coordinates.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // aligned to Date.getDay()

export function isVetAvailableAtDateTime(vet, dateStr, timeStr) {
  const override = vet.date_overrides ? vet.date_overrides[dateStr] : undefined;
  if (override === false) return false;
  if (override === true) return true;

  const dayKey = DAY_KEYS[new Date(`${dateStr}T00:00:00`).getDay()];
  const hour = Number((timeStr || '00:00').split(':')[0]);
  return !!(vet.weekly_hours?.[dayKey]?.[hour]);
}

export function isVetAvailableOnDate(vet, dateStr) {
  const override = vet.date_overrides ? vet.date_overrides[dateStr] : undefined;
  if (override !== undefined) return override;
  const dayKey = DAY_KEYS[new Date(`${dateStr}T00:00:00`).getDay()];
  const hours = vet.weekly_hours?.[dayKey] || {};
  return Object.values(hours).some(Boolean);
}

function timesOverlap(t1, t2) {
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return Math.abs(toMin(t1) - toMin(t2)) < 90; // 90 min buffer between two jobs for the same vet
}

// `otherActiveJobs` = every non-completed/cancelled job currently assigned
// to this vet (fetched by the caller — kept as a plain array here so this
// function stays a pure, easily-testable calculation with no DB access).
export function hasTimeConflict(job, otherActiveJobs) {
  return otherActiveJobs.some(
    (j) => j.id !== job.id && j.job_date === job.job_date && timesOverlap(j.job_time, job.job_time)
  );
}

// `vetsWithContext` = vets pre-joined with: territoryContainsPoint (bool,
// from a ST_Contains query -- null if no territory drawn or job has no
// lat/lng), activeJobCount (int), and otherActiveJobs (array, for the
// conflict check). All DB work happens in the route; this function is
// pure scoring logic so the ranking rules can be unit tested directly.
export function rankVets(job, vetsWithContext) {
  return vetsWithContext
    .map((v) => {
      let score = 0;
      let label = 'Outside territory';

      if (v.territoryContainsPoint === true) {
        score += 120;
        label = 'Within drawn territory';
      } else if (v.territoryContainsPoint === null) {
        if (v.postcodes?.includes(job.postcode)) {
          score += 100;
          label = 'Exact postcode match';
        } else if (v.postcodes?.some((p) => p.slice(0, 2) === job.postcode.slice(0, 2))) {
          score += 50;
          label = 'Nearby region';
        }
      }

      const available = isVetAvailableAtDateTime(v, job.job_date, job.job_time);
      score += available ? 20 : -40;

      score -= (v.activeJobCount || 0) * 5;

      const conflict = hasTimeConflict(job, v.otherActiveJobs || []);
      if (conflict) score -= 200;

      return { vetId: v.id, name: v.full_name, score, label, available, activeJobCount: v.activeJobCount, conflict };
    })
    .sort((a, b) => b.score - a.score);
}

// Default dispatch offer window. The prototype used 45s for demo
// visibility — a real value belongs here, in minutes. Override via
// DISPATCH_TIMEOUT_MINUTES env var if a different window is wanted later.
export const DISPATCH_TIMEOUT_MS = (Number(process.env.DISPATCH_TIMEOUT_MINUTES) || 15) * 60 * 1000;
