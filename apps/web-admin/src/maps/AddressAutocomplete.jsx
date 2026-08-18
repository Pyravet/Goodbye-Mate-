import { useEffect, useRef, useState } from 'react';
import { useGoogleMaps } from './useGoogleMaps.js';

// Real Google Places autocomplete on a plain text input. Calls onSelect
// with { formattedAddress, lat, lng, placeId } once the user picks a
// suggestion — that's what gets stored against a client/job record.
//
// Note: Google is migrating from `Autocomplete` to the newer
// `PlaceAutocompleteElement`. This uses the classic widget because it's
// stable and simpler to wire to a plain input; worth revisiting once the
// newer element is out of preview if Google deprecates the old one.
//
// Falls back to a plain manual-entry text input if Maps fails to load or
// isn't configured — booking a job should never be blocked by a Maps
// outage. A manually-typed address has no lat/lng, which is fine: the
// backend dispatch matching already falls back to postcode-based
// territory matching when lat/lng is missing (see jobs.js line ~703).
export default function AddressAutocomplete({ value, onChange, onSelect, placeholder = 'Start typing an address…' }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const status = useGoogleMaps();
  const [manualMode, setManualMode] = useState(false);

  useEffect(() => {
    if (status !== 'ready' || !inputRef.current || autocompleteRef.current) return;

    autocompleteRef.current = new window.google.maps.places.Autocomplete(inputRef.current, {
      // Restrict to Australia since the business operates nationwide AU only.
      componentRestrictions: { country: 'au' },
      fields: ['formatted_address', 'geometry', 'place_id'],
      types: ['address'],
    });

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current.getPlace();
      if (!place.geometry) return; // user hit enter without picking a suggestion
      onSelect({
        formattedAddress: place.formatted_address,
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        placeId: place.place_id,
      });
    });
  }, [status, onSelect]);

  const onManualChange = (e) => {
    const text = e.target.value;
    onChange(text);
    // No lat/lng/placeId from manual entry — dispatch falls back to
    // postcode matching for this job, same as if Maps were never
    // configured at all.
    onSelect({ formattedAddress: text, lat: null, lng: null, placeId: null });
  };

  const mapsUnavailable = status === 'missing-key' || status === 'error';

  if (mapsUnavailable && !manualMode) {
    return (
      <div>
        <p style={styles.warning}>
          {status === 'missing-key' ? "Maps isn't configured right now." : 'Maps failed to load.'}{' '}
          You can still type the address in manually below.
        </p>
        <button type="button" onClick={() => setManualMode(true)} style={styles.manualBtn}>
          Enter address manually
        </button>
      </div>
    );
  }

  if (mapsUnavailable && manualMode) {
    return (
      <div>
        <input
          type="text"
          value={value}
          onChange={onManualChange}
          placeholder="Full street address, suburb, state, postcode…"
          style={styles.input}
          autoFocus
        />
        <p style={styles.hint}>Typed manually — double-check it's correct, since there's no autocomplete to catch typos right now.</p>
      </div>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={status === 'loading' ? 'Loading maps…' : placeholder}
      disabled={status === 'loading'}
      style={styles.input}
    />
  );
}

const styles = {
  input: { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14 },
  warning: { color: '#9C4A3C', fontSize: 13, marginBottom: 6 },
  manualBtn: { background: '#F0EBE0', border: '1px solid #E7E0D3', borderRadius: 6, padding: '6px 12px', fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  hint: { fontSize: 11, color: '#6B6559', marginTop: 4, fontStyle: 'italic' },
};
