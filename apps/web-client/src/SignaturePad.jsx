import { useRef, useEffect, useState } from 'react';

// Canvas signature pad. Works with touch (phones — how most clients will
// sign) and mouse. Exports a PNG data URI via onChange, or null when
// cleared, so the parent can require a signature before submitting.
//
// The canvas is sized to its rendered CSS width times devicePixelRatio so
// strokes stay sharp on high-DPI screens rather than looking blurry.
export default function SignaturePad({ onChange, height = 160 }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const cssWidth = canvas.offsetWidth;
    canvas.width = cssWidth * ratio;
    canvas.height = height * ratio;

    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2A2620';
  }, [height]);

  const pointFromEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const source = e.touches ? e.touches[0] : e;
    return { x: source.clientX - rect.left, y: source.clientY - rect.top };
  };

  const start = (e) => {
    // Stop the page scrolling/rubber-banding while signing on a phone.
    if (e.cancelable) e.preventDefault();
    drawingRef.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pointFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e) => {
    if (!drawingRef.current) return;
    if (e.cancelable) e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const { x, y } = pointFromEvent(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInkRef.current) {
      hasInkRef.current = true;
      setHasInk(true);
    }
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (hasInkRef.current) onChange(canvasRef.current.toDataURL('image/png'));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInkRef.current = false;
    setHasInk(false);
    onChange(null);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        style={{ ...styles.canvas, height }}
        onMouseDown={start}
        onMouseMove={move}
        onMouseUp={end}
        onMouseLeave={end}
        onTouchStart={start}
        onTouchMove={move}
        onTouchEnd={end}
      />
      <div style={styles.row}>
        <span style={styles.hint}>{hasInk ? 'Signed' : 'Sign above with your finger or mouse'}</span>
        <button type="button" onClick={clear} style={styles.clearBtn}>Clear</button>
      </div>
    </div>
  );
}

const styles = {
  canvas: {
    width: '100%',
    display: 'block',
    background: '#fff',
    border: '1px solid var(--gm-line)',
    borderRadius: 'var(--gm-radius-sm)',
    touchAction: 'none', // required so touch drawing isn't hijacked by scroll
    cursor: 'crosshair',
  },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 14 },
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)' },
  clearBtn: { background: 'none', border: '1px solid var(--gm-line)', borderRadius: 'var(--gm-radius-sm)', padding: '4px 12px', fontSize: 12, cursor: 'pointer' },
};
