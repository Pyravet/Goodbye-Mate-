import { apiFetch } from './client.js';

/** The vet's own weekly payout periods (approved and paid). */
export async function fetchMyPayoutPeriods() {
  const res = await apiFetch('/payouts/my-periods');
  if (!res.ok) throw new Error('Failed to load payouts');
  return (await res.json()).periods;
}

/**
 * Absolute URL for a period RCTI, plus the access token.
 *
 * React Native has no blob/anchor download, so the PDF is opened in the
 * device browser or a share sheet instead. The token is returned so the
 * caller can attach it — the endpoint requires authentication and a
 * bare URL would simply 401.
 */
export { getAccessToken, apiFetch } from './client.js';
