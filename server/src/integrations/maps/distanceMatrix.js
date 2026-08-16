// Driving ETA from a vet's current position to a job address, using
// Google's Distance Matrix API. Falls back to a straight-line estimate
// (haversine distance / an assumed average speed) if the API call fails
// or no key is configured, so the "I'm on the way" feature still works
// end-to-end without blocking on Google Cloud Console setup.
//
// IMPORTANT: the VITE_GOOGLE_MAPS_API_KEY used by the browser apps is
// typically restricted by HTTP referrer, which server-side calls don't
// send — Distance Matrix requests from this backend will fail with
// REQUEST_DENIED against a referrer-restricted key. For accurate driving
// ETAs, add a *second* Google Maps API key restricted by server IP (or
// unrestricted, if acceptable) as GOOGLE_MAPS_API_KEY in this service's
// environment variables. Until then, every call below transparently
// degrades to the fallback estimate.

const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';
const AVERAGE_SPEED_KMH = 40; // conservative suburban/mixed-traffic estimate for the fallback

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fallbackEstimate(originLat, originLng, destLat, destLng) {
  const km = haversineKm(originLat, originLng, destLat, destLng);
  // Straight-line distance understates real road distance, so pad it out
  // a bit rather than quote an unrealistically fast ETA.
  const roadKm = km * 1.3;
  const minutes = Math.max(1, Math.round((roadKm / AVERAGE_SPEED_KMH) * 60));
  return {
    etaMinutes: minutes,
    distanceText: `${roadKm.toFixed(1)} km (estimated)`,
    source: 'fallback',
  };
}

export async function getDrivingEta({ originLat, originLng, destLat, destLng }) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return fallbackEstimate(originLat, originLng, destLat, destLng);
  }

  try {
    const url = new URL(DISTANCE_MATRIX_URL);
    url.searchParams.set('origins', `${originLat},${originLng}`);
    url.searchParams.set('destinations', `${destLat},${destLng}`);
    url.searchParams.set('mode', 'driving');
    url.searchParams.set('departure_time', 'now'); // factors in current traffic
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString());
    const data = await res.json();

    const element = data?.rows?.[0]?.elements?.[0];
    if (data.status !== 'OK' || !element || element.status !== 'OK') {
      console.warn('Distance Matrix unavailable, using fallback estimate:', data.status || element?.status);
      return fallbackEstimate(originLat, originLng, destLat, destLng);
    }

    const seconds = element.duration_in_traffic?.value ?? element.duration.value;
    return {
      etaMinutes: Math.max(1, Math.round(seconds / 60)),
      distanceText: element.distance.text,
      source: 'google',
    };
  } catch (err) {
    console.warn('Distance Matrix request failed, using fallback estimate:', err.message);
    return fallbackEstimate(originLat, originLng, destLat, destLng);
  }
}
