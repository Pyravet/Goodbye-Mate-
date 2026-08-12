import { useEffect, useRef } from 'react';
import { useGoogleMaps } from './useGoogleMaps.js';

// Real Google Places autocomplete on a plain text input. Calls onSelect
// with { formattedAddress, lat, lng, placeId } once the user picks a
// suggestion — that's what gets stored against a client/job record.
//
// Note: Google is migrating from `Autocomplete` to the newer
// `PlaceAutocompleteElement`. This uses the classic widget because it's
// stable and simpler to wire to a plain input; worth revisiting once the
// newer element is out of preview if Google deprecates the old one.
export default function AddressAutocomplete({ value, onChange, onSelect, placeholder = 'Start typing an address…' }) {
  const inputRef = useRef(null);
  const autocompleteRef = useRef(null);
  const status = useGoogleMaps();

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

  if (status === 'missing-key') {
    return <p style={{ color: '#b91c1c', fontSize: 13 }}>Google Maps API key not configured (VITE_GOOGLE_MAPS_API_KEY).</p>;
  }
  if (status === 'error') {
    return <p style={{ color: '#b91c1c', fontSize: 13 }}>Failed to load Google Maps. Check the API key is valid and unrestricted for this domain.</p>;
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={status === 'loading' ? 'Loading maps…' : placeholder}
      disabled={status === 'loading'}
      style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14 }}
    />
  );
}
