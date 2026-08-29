import { useEffect, useRef, useState } from 'react';
import { useGoogleMaps } from './useGoogleMaps.js';
import { apiFetch } from '../api.js';

// Australia-wide default view — centered roughly on the continent so any
// vet's territory is reachable without a jarring initial pan/zoom.
const DEFAULT_CENTER = { lat: -25.2744, lng: 133.7751 };
const DEFAULT_ZOOM = 4;

function polygonPathToGeoJSON(polygon) {
  const path = polygon.getPath().getArray().map((latLng) => [latLng.lng(), latLng.lat()]);
  // GeoJSON polygons must be closed rings (first point === last point).
  if (path.length && (path[0][0] !== path[path.length - 1][0] || path[0][1] !== path[path.length - 1][1])) {
    path.push(path[0]);
  }
  return { type: 'Polygon', coordinates: [path] };
}

const styles = {
  fallback: { background: '#FDF6EC', border: '1px solid #E8D9BE', borderRadius: 8, padding: 16 },
  fallbackTitle: { fontSize: 14, fontWeight: 600, color: '#7A5A22', marginBottom: 8 },
  fallbackBody: { fontSize: 13, color: '#7A5A22', lineHeight: 1.6, marginBottom: 8 },
};

export default function TerritoryMap({ vetId, initialGeoJSON }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const drawingManagerRef = useRef(null);
  const currentPolygonRef = useRef(null);
  const status = useGoogleMaps();
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error

  useEffect(() => {
    if (status !== 'ready' || !mapDivRef.current || mapRef.current) return;

    const map = new window.google.maps.Map(mapDivRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      mapTypeControl: false,
      streetViewControl: false,
    });
    mapRef.current = map;

    // Render the existing territory, if this vet already has one.
    if (initialGeoJSON) {
      const paths = initialGeoJSON.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
      const polygon = new window.google.maps.Polygon({
        paths,
        editable: true,
        fillColor: '#2563eb',
        fillOpacity: 0.15,
        strokeColor: '#2563eb',
        strokeWeight: 2,
      });
      polygon.setMap(map);
      currentPolygonRef.current = polygon;

      const bounds = new window.google.maps.LatLngBounds();
      paths.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds);
    }

    const drawingManager = new window.google.maps.drawing.DrawingManager({
      drawingMode: initialGeoJSON ? null : window.google.maps.drawing.OverlayType.POLYGON,
      drawingControl: true,
      drawingControlOptions: {
        position: window.google.maps.ControlPosition.TOP_CENTER,
        drawingModes: [window.google.maps.drawing.OverlayType.POLYGON],
      },
      polygonOptions: {
        fillColor: '#2563eb',
        fillOpacity: 0.15,
        strokeColor: '#2563eb',
        strokeWeight: 2,
        editable: true,
      },
    });
    drawingManager.setMap(map);
    drawingManagerRef.current = drawingManager;

    window.google.maps.event.addListener(drawingManager, 'polygoncomplete', (polygon) => {
      // Only one territory polygon per vet — replace any previous one.
      if (currentPolygonRef.current) currentPolygonRef.current.setMap(null);
      currentPolygonRef.current = polygon;
      drawingManager.setDrawingMode(null); // exit drawing mode after one polygon
    });
  }, [status, initialGeoJSON]);

  const handleSave = async () => {
    if (!currentPolygonRef.current) {
      alert('Draw a territory polygon first.');
      return;
    }
    setSaveState('saving');
    const geojson = polygonPathToGeoJSON(currentPolygonRef.current);
    try {
      const res = await apiFetch(`/vets/${vetId}/territory`, {
        method: 'PUT',
        body: JSON.stringify({ geojson }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  const handleClear = () => {
    if (currentPolygonRef.current) {
      currentPolygonRef.current.setMap(null);
      currentPolygonRef.current = null;
    }
    drawingManagerRef.current?.setDrawingMode(window.google.maps.drawing.OverlayType.POLYGON);
    setSaveState('idle');
  };

  // Only 'missing-key' was handled. A key that EXISTS but is rejected —
  // billing disabled, referrer restriction, expired — reports 'error',
  // and the component rendered an empty map div: a blank page with no
  // explanation and nothing to act on.
  if (status === 'missing-key' || status === 'error') {
    return (
      <div style={styles.fallback}>
        <p style={styles.fallbackTitle}>
          {status === 'missing-key'
            ? 'Google Maps isn\u2019t configured yet.'
            : 'Google Maps didn\u2019t load.'}
        </p>
        <p style={styles.fallbackBody}>
          {status === 'missing-key'
            ? 'VITE_GOOGLE_MAPS_API_KEY isn\u2019t set, so the map can\u2019t be drawn.'
            : 'The key was rejected — usually billing not enabled on the Google Cloud project, '
              + 'or a referrer restriction that doesn\u2019t include this site.'}
        </p>
        <p style={styles.fallbackBody}>
          {/* Said plainly, because otherwise a blank map looks like the
              vet simply has no territory — and dispatch quietly carries
              on working off postcodes. */}
          Dispatch still works in the meantime: vets are matched on their
          postcode list instead of a drawn area. You can set those on the
          Details tab.
        </p>
        {initialGeoJSON && (
          <p style={styles.fallbackBody}>
            This vet already has a saved territory. It stays in place and keeps being used —
            it just can&apos;t be shown or edited until Maps loads.
          </p>
        )}
      </div>
    );
  }

  if (status === 'loading') {
    return <p style={{ fontSize: 13, color: '#888' }}>Loading the map\u2026</p>;
  }

  return (
    <div>
      <div ref={mapDivRef} style={{ width: '100%', height: 480, borderRadius: 8, overflow: 'hidden', border: '1px solid #ddd' }} />
      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={handleSave} disabled={saveState === 'saving'} style={{ padding: '8px 14px', cursor: 'pointer' }}>
          {saveState === 'saving' ? 'Saving…' : 'Save territory'}
        </button>
        <button onClick={handleClear} style={{ padding: '8px 14px', cursor: 'pointer' }}>Clear & redraw</button>
        {saveState === 'saved' && <span style={{ color: '#15803d', fontSize: 13 }}>Saved.</span>}
        {saveState === 'error' && <span style={{ color: '#b91c1c', fontSize: 13 }}>Save failed — try again.</span>}
      </div>
      <p style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
        Draw the vet's coverage area with the polygon tool above the map. Only one territory
        per vet — drawing a new one replaces the old, and nothing is saved until you click
        "Save territory".
      </p>
    </div>
  );
}
