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

export async function fetchBrochurePdf(kind, state = 'ALL') {
  const res = await apiFetch(
    `/settings/content/brochure/${kind}?state=${encodeURIComponent(state)}`
  );
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

/**
 * Upload a brochure for one state, or 'ALL' as the nationwide fallback.
 *
 * The state was never sent, so every upload saved as 'ALL' and
 * overwrote the last one — which is why there was only ever one
 * brochure despite the backend supporting per-state versions all along.
 */
export async function uploadBrochurePdf(kind, file, state = 'ALL') {
  const dataBase64 = await fileToBase64(file);
  const res = await apiFetch(`/settings/content/brochure/${kind}`, {
    method: 'PUT',
    body: JSON.stringify({ filename: file.name, dataBase64, state }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to upload brochure');
  return data;
}

export async function listBrochurePdfs(kind) {
  const res = await apiFetch(`/settings/content/brochures/${kind}`);
  if (!res.ok) throw new Error('Could not load brochures');
  return (await res.json()).documents;
}

export async function removeBrochurePdf(kind, state = 'ALL') {
  const res = await apiFetch(`/settings/content/brochure/${kind}?state=${encodeURIComponent(state)}`, { method: 'DELETE' });
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

// --- Client resources (support & grief resources on the journey page) ---

export async function fetchClientResources() {
  const res = await apiFetch('/settings/content/resources');
  if (!res.ok) throw new Error('Could not load resources');
  return (await res.json()).resources;
}

export async function addClientResource(payload) {
  const res = await apiFetch('/settings/content/resources', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not add that resource');
  return data;
}

export async function removeClientResource(id) {
  const res = await apiFetch(`/settings/content/resources/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Could not remove that resource');
  return res.json();
}
