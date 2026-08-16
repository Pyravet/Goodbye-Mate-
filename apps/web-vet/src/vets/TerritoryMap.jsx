import { useEffect, useRef, useState } from 'react';
import { useGoogleMaps } from '../maps/useGoogleMaps.js';
import { fetchTerritory, saveTerritory } from './vetsApi.js';

const DEFAULT_CENTER = { lat: -25.2744, lng: 133.7751 };
const DEFAULT_ZOOM = 4;

function polygonPathToGeoJSON(polygon) {
  const path = polygon.getPath().getArray().map((latLng) => [latLng.lng(), latLng.lat()]);
  if (path.length && (path[0][0] !== path[path.length - 1][0] || path[0][1] !== path[path.length - 1][1])) {
    path.push(path[0]);
  }
  return { type: 'Polygon', coordinates: [path] };
}

export default function TerritoryMap({ vetId }) {
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const drawingManagerRef = useRef(null);
  const currentPolygonRef = useRef(null);
  const status = useGoogleMaps();
  const [initialGeoJSON, setInitialGeoJSON] = useState(undefined); // undefined = not loaded yet
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error

  useEffect(() => {
    fetchTerritory(vetId).then(setInitialGeoJSON).catch(() => setInitialGeoJSON(null));
  }, [vetId]);

  useEffect(() => {
    if (status !== 'ready' || initialGeoJSON === undefined || !mapDivRef.current || mapRef.current) return;

    const map = new window.google.maps.Map(mapDivRef.current, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    mapRef.current = map;

    if (initialGeoJSON) {
      const paths = initialGeoJSON.coordinates[0].map(([lng, lat]) => ({ lat, lng }));
      const polygon = new window.google.maps.Polygon({
        paths,
        editable: true,
        fillColor: '#33453A',
        fillOpacity: 0.18,
        strokeColor: '#33453A',
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
        fillColor: '#33453A',
        fillOpacity: 0.18,
        strokeColor: '#33453A',
        strokeWeight: 2,
        editable: true,
      },
    });
    drawingManager.setMap(map);
    drawingManagerRef.current = drawingManager;

    window.google.maps.event.addListener(drawingManager, 'polygoncomplete', (polygon) => {
      if (currentPolygonRef.current) currentPolygonRef.current.setMap(null);
      currentPolygonRef.current = polygon;
      drawingManager.setDrawingMode(null);
    });
  }, [status, initialGeoJSON]);

  const handleSave = async () => {
    if (!currentPolygonRef.current) {
      setSaveState('error');
      return;
    }
    setSaveState('saving');
    const geojson = polygonPathToGeoJSON(currentPolygonRef.current);
    try {
      await saveTerritory(vetId, geojson);
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
    return <p style={styles.error}>Maps isn't configured on this deployment yet.</p>;
  }

  return (
    <div>
      <div ref={mapDivRef} style={styles.map} />
      <div style={styles.actions}>
        <button onClick={handleClear} style={styles.clearBtn}>Clear &amp; redraw</button>
        <button onClick={handleSave} disabled={saveState === 'saving'} style={styles.saveBtn}>
          {saveState === 'saving' ? 'Saving…' : 'Save territory'}
        </button>
      </div>
      {saveState === 'saved' && <p style={styles.savedNote}>Saved.</p>}
      {saveState === 'error' && <p style={styles.error}>Draw an area on the map first, then save.</p>}
      <p style={styles.hint}>
        Draw the area you cover by tapping points on the map to form a shape, then tap Save. Drawing a new
        shape replaces your previous territory.
      </p>
    </div>
  );
}

const styles = {
  map: { width: '100%', height: 320, borderRadius: 'var(--gm-radius-sm)', overflow: 'hidden', border: '1px solid var(--gm-line)' },
  actions: { display: 'flex', gap: 8, marginTop: 12 },
  clearBtn: { flex: 1, background: 'var(--gm-line-soft)', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '10px 0', fontSize: 13, fontWeight: 500 },
  saveBtn: { flex: 1, background: 'var(--gm-forest)', color: '#fff', border: 'none', borderRadius: 'var(--gm-radius-sm)', padding: '10px 0', fontSize: 13, fontWeight: 500 },
  savedNote: { fontSize: 13, color: 'var(--gm-forest-dark)', marginTop: 10 },
  error: { fontSize: 13, color: 'var(--gm-brick)', marginTop: 10 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 10, lineHeight: 1.5 },
};
