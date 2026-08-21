import { apiFetch } from '../api.js';

export async function fetchPricing() {
  const res = await apiFetch('/settings/pricing');
  if (!res.ok) throw new Error('Failed to load pricing');
  const data = await res.json();
  return data.pricing;
}

export async function savePricing(config) {
  const res = await apiFetch('/settings/pricing', { method: 'PUT', body: JSON.stringify(config) });
  if (!res.ok) throw new Error('Failed to save pricing');
  return res.json();
}

export async function fetchContent() {
  const res = await apiFetch('/settings/content');
  if (!res.ok) throw new Error('Failed to load content');
  const data = await res.json();
  return data.content;
}

export async function saveContent(config) {
  const res = await apiFetch('/settings/content', { method: 'PUT', body: JSON.stringify(config) });
  if (!res.ok) throw new Error('Failed to save content');
  return res.json();
}

export async function fetchTemplates() {
  const res = await apiFetch('/settings/templates');
  if (!res.ok) throw new Error('Failed to load templates');
  const data = await res.json();
  return data.templates;
}

export async function saveTemplate(id, payload) {
  const res = await apiFetch(`/settings/templates/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
  if (!res.ok) throw new Error('Failed to save template');
  return res.json();
}

export async function fetchBrochurePdf(kind) {
  const res = await apiFetch(`/settings/content/brochure/${kind}`);
  if (!res.ok) throw new Error('Failed to load brochure');
  const data = await res.json();
  return data.document; // { filename, uploaded_at } | null
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadBrochurePdf(kind, file) {
  const dataBase64 = await fileToBase64(file);
  const res = await apiFetch(`/settings/content/brochure/${kind}`, {
    method: 'PUT',
    body: JSON.stringify({ filename: file.name, dataBase64 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to upload brochure');
  return data;
}

export async function removeBrochurePdf(kind) {
  const res = await apiFetch(`/settings/content/brochure/${kind}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove brochure');
  return res.json();
}

/** Check the SMTP connection and credentials without sending anything. */
export async function verifyEmail() {
  const res = await apiFetch('/settings/email/verify');
  return res.json();
}

/** Send a real test email to prove delivery end to end. */
export async function sendTestEmail(to) {
  const res = await apiFetch('/settings/email/test', {
    method: 'POST',
    body: JSON.stringify({ to }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not send the test email');
  return data;
}
