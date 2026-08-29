const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Is this vet available on this date?
 *
 * Mirrors isVetAvailableOnDate in server/src/domain/dispatch.js exactly.
 * Duplicated rather than imported because the server package isn't
 * bundled into the browser — but if dispatch's rule changes, this MUST
 * change with it, or admin will show a different answer from the one
 * dispatch acts on.
 *
 * @param {{weekly_hours?: object, date_overrides?: object}} vet
 * @param {string} dateStr YYYY-MM-DD
 */
export function isVetAvailableOnDate(vet, dateStr) {
  const override = vet?.date_overrides ? vet.date_overrides[dateStr] : undefined;
  // Hour ranges: available if any exist. An empty list means the date
  // was set to "not working", not "fall back to the weekly pattern".
  if (Array.isArray(override)) return override.length > 0;
  if (override !== undefined) return override;
  const dayKey = DAY_KEYS[new Date(`${dateStr}T00:00:00`).getDay()];
  const hours = vet?.weekly_hours?.[dayKey] || {};
  return Object.values(hours).some(Boolean);
}
