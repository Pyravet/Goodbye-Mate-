import { apiFetch, API_URL } from '../api.js';

/** Payout run for the week containing `weekStart` (any date in it). */
export async function fetchPayoutRun(weekStart) {
  const qs = weekStart ? `?weekStart=${weekStart}` : '';
  const res = await apiFetch(`/payouts/periods${qs}`);
  if (!res.ok) throw new Error('Failed to load payout run');
  return res.json();
}

/** Freeze a vet's week and allocate its RCTI number. */
export async function approvePeriod(vetId, periodStart) {
  const res = await apiFetch('/payouts/periods/approve', {
    method: 'POST',
    body: JSON.stringify({ vetId, periodStart }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to approve');
  return data.period;
}

export async function markPeriodPaid(periodId, paymentReference) {
  const res = await apiFetch(`/payouts/periods/${periodId}/mark-paid`, {
    method: 'POST',
    body: JSON.stringify({ paymentReference }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to mark paid');
  return data.period;
}

/**
 * Open an RCTI PDF. Fetched via apiFetch rather than a plain link so the
 * Authorization header is attached — the endpoint requires auth, and a
 * bare <a href> would just 401.
 */
export async function openPeriodRcti(periodId) {
  const res = await apiFetch(`/payouts/periods/${periodId}/rcti.pdf`);
  if (!res.ok) throw new Error('Could not generate that RCTI');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  // Revoke after a delay so the new tab has time to load it first.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export { API_URL };
