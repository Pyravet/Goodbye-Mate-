const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export async function fetchJourney(token) {
  const res = await fetch(`${API_URL}/public/journey/${token}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'This link is not valid.');
  return data;
}

export async function submitConsent(token, { signatureName, agree }) {
  const res = await fetch(`${API_URL}/public/journey/${token}/consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatureName, agree }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not save your consent — try again.');
  return data;
}

export async function submitPayment(token, encryptedCard) {
  const res = await fetch(`${API_URL}/public/journey/${token}/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptedCard }),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'Payment failed.');
    err.declined = res.status === 402;
    throw err;
  }
  return data;
}

export { API_URL };
