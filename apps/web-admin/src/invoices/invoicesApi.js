import { apiFetch } from '../api.js';
import { downloadPdf } from '../jobs/jobsApi.js';

export async function fetchInvoices(status) {
  const res = await apiFetch(`/partner-invoices${status && status !== 'all' ? `?status=${status}` : ''}`);
  if (!res.ok) throw new Error('Could not load invoices');
  return res.json();
}

export async function fetchInvoice(id) {
  const res = await apiFetch(`/partner-invoices/${id}`);
  if (!res.ok) throw new Error('Could not load that invoice');
  return res.json();
}

export async function createInvoice(payload) {
  const res = await apiFetch('/partner-invoices', { method: 'POST', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not create the invoice');
  return data;
}

export async function updateInvoice(id, payload) {
  const res = await apiFetch(`/partner-invoices/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save the invoice');
  return data;
}

export async function sendInvoice(id) {
  const res = await apiFetch(`/partner-invoices/${id}/send`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not send the invoice');
  return data;
}

export async function markInvoicePaid(id) {
  const res = await apiFetch(`/partner-invoices/${id}/mark-paid`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not mark it paid');
  return data;
}

export async function voidInvoice(id, reason) {
  const res = await apiFetch(`/partner-invoices/${id}/void`, {
    method: 'POST', body: JSON.stringify({ reason }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not void the invoice');
  return data;
}

export function downloadInvoicePdf(id, number) {
  return downloadPdf(`/partner-invoices/${id}/invoice.pdf`, `${number || 'Draft'}.pdf`);
}
