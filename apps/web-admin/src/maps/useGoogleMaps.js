import { useEffect, useState } from 'react';

let loadingPromise = null;

function loadGoogleMapsScript(apiKey) {
  if (window.google?.maps) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    // 'places' for address autocomplete, 'drawing' + 'geometry' for the
    // territory tool (drawing the polygon + point-in-polygon checks client-side
    // if ever needed, e.g. live "does this address fall in your area" preview).
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,drawing,geometry`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps script'));
    document.head.appendChild(script);
  });

  return loadingPromise;
}

export function useGoogleMaps() {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const [status, setStatus] = useState(apiKey ? 'loading' : 'missing-key');

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    // Google reports an invalid/unauthorised key by calling this global
    // rather than by failing the script load — the <script> tag itself
    // still resolves fine. Without hooking this, an invalid key looks
    // exactly like a working one ('ready'), so autocomplete silently
    // returns no suggestions and the UI gives no clue why.
    const previousAuthFailure = window.gm_authFailure;
    window.gm_authFailure = () => {
      if (!cancelled) setStatus('error');
      if (typeof previousAuthFailure === 'function') previousAuthFailure();
    };

    loadGoogleMapsScript(apiKey)
      .then(() => { if (!cancelled) setStatus('ready'); })
      .catch(() => { if (!cancelled) setStatus('error'); });

    return () => {
      cancelled = true;
      window.gm_authFailure = previousAuthFailure;
    };
  }, [apiKey]);

  return status; // 'missing-key' | 'loading' | 'ready' | 'error'
}
