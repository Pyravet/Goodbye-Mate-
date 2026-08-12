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

  if (status === 'missing-key') {
    return <p style={{ color: '#b91c1c', fontSize: 13 }}>Google Maps API key not configured (VITE_GOOGLE_MAPS_API_KEY).</p>;
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
