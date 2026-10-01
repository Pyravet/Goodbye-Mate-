import { apiFetch } from '../api.js';
import { downloadPdf } from '@goodbye-mate/web-shared/src/openPdf.js';

function toQuery({ from, to, granularity }) {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (granularity) params.set('granularity', granularity);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function fetchStats(range) {
  const res = await apiFetch(`/stats${toQuery(range)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load statistics');
  return data;
}

/**
 * Download the CSV export.
 *
 * Despite its name downloadPdf isn't PDF-specific — it fetches with the
 * Authorization header apiFetch always attaches, then triggers the save
 * via a real <a download> click rather than window.open(blobUrl), which
 * iOS Safari silently blocks once the click happens after an await.
 *
 * Deliberately NOT a plain navigation with the token on the query
 * string: the server's query-token auth fallback is intentionally
 * restricted to .pdf paths only, precisely because a token in a URL is
 * more exposure-prone (browser history, referrer headers) than a
 * header — widening that exception for a CSV export isn't worth doing
 * when this works without it.
 */
export async function downloadStatsCsv(range) {
  const from = range.from || 'start';
  const to = range.to || 'now';
  await downloadPdf(
    () => apiFetch(`/stats/export.csv${toQuery(range)}`),
    `goodbye-mate-stats-${from}-to-${to}.csv`
  );
}
