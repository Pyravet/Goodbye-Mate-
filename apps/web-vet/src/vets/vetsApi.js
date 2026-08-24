import { apiFetch } from '../api.js';
import { downloadPdf } from '@goodbye-mate/web-shared/src/openPdf.js';

export async function fetchMe() {
  const res = await apiFetch('/vets/me');
  if (!res.ok) throw new Error('Failed to load profile');
  return res.json(); // { vet, bankDetails }
}

export async function updateWeeklyHours(vetId, weeklyHours) {
  const res = await apiFetch(`/vets/${vetId}/weekly-hours`, {
    method: 'PUT',
    body: JSON.stringify(weeklyHours),
  });
  if (!res.ok) throw new Error('Failed to save availability');
  return res.json();
}

export async function setDateOverride(vetId, date, available) {
  const res = await apiFetch(`/vets/${vetId}/date-overrides/${date}`, {
    method: 'PUT',
    body: JSON.stringify({ available }),
  });
  if (!res.ok) throw new Error('Failed to save date override');
  return res.json();
}

export async function fetchEarnings(vetId) {
  const res = await apiFetch(`/vets/${vetId}/earnings`);
  if (!res.ok) throw new Error('Failed to load earnings');
  return res.json();
}

export async function fetchTerritory(vetId) {
  const res = await apiFetch(`/vets/${vetId}/territory`);
  if (!res.ok) throw new Error('Failed to load territory');
  const data = await res.json();
  return data.geojson;
}

export async function saveTerritory(vetId, geojson) {
  const res = await apiFetch(`/vets/${vetId}/territory`, {
    method: 'PUT',
    body: JSON.stringify({ geojson }),
  });
  if (!res.ok) throw new Error('Failed to save territory');
  return res.json();
}

/** The vet's own weekly payout periods (approved and paid). */
export async function fetchMyPayoutPeriods() {
  const res = await apiFetch('/payouts/my-periods');
  if (!res.ok) throw new Error('Failed to load payouts');
  const data = await res.json();
  return data.periods;
}

/**
 * Open a period RCTI. Fetched with auth rather than linked directly,
 * since the endpoint requires an Authorization header.
 */
export async function openMyPeriodRcti(periodId) {
  await downloadPdf(
    () => apiFetch(`/payouts/periods/${periodId}/rcti.pdf`),
    `RCTI-${periodId}.pdf`
  );
}

// --- Leave ---

export async function fetchLeave(vetId) {
  const res = await apiFetch(`/vets/${vetId}/leave`);
  if (!res.ok) throw new Error('Could not load your leave');
  return (await res.json()).leave;
}

export async function addLeave(vetId, { startsOn, endsOn, reason }) {
  const res = await apiFetch(`/vets/${vetId}/leave`, {
    method: 'POST',
    body: JSON.stringify({ startsOn, endsOn, reason }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save that leave');
  return data;
}

export async function removeLeave(vetId, leaveId) {
  const res = await apiFetch(`/vets/${vetId}/leave/${leaveId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Could not remove that leave');
  return res.json();
}

// --- Note templates (saved snippets for medical notes) ---

export async function fetchNoteTemplates(vetId) {
  const res = await apiFetch(`/vets/${vetId}/note-templates`);
  if (!res.ok) throw new Error('Could not load your templates');
  return (await res.json()).templates;
}

export async function addNoteTemplate(vetId, { label, text }) {
  const res = await apiFetch(`/vets/${vetId}/note-templates`, {
    method: 'POST',
    body: JSON.stringify({ label, text }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save that template');
  return data.template;
}

export async function removeNoteTemplate(vetId, templateId) {
  const res = await apiFetch(`/vets/${vetId}/note-templates/${templateId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Could not remove that template');
  return res.json();
}
