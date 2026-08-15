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
