import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../api.js';

// Admin editor for extra content on the client journey page.
// No jobId = GLOBAL (every client sees it); jobId = that one job only.

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function call(path, options) {
  const res = await apiFetch(`/journey-blocks${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

export default function JourneyBlocksEditor({ jobId = null }) {
  const [blocks, setBlocks] = useState(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    call(jobId ? `?jobId=${jobId}` : '').then((d) => setBlocks(d.blocks)).catch((e) => { setError(e.message); setBlocks([]); });
  }, [jobId]);
  useEffect(load, [load]);

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const add = () => run(async () => {
    await call('', { method: 'POST', body: JSON.stringify({ jobId, title, body: body || null, videoUrl: videoUrl || null }) });
    setTitle(''); setBody(''); setVideoUrl('');
  });

  const upload = (blockId, fileList) => run(async () => {
    for (const file of Array.from(fileList)) {
      await call(`/${blockId}/files`, { method: 'POST', body: JSON.stringify({ filename: file.name, dataBase64: await fileToBase64(file) }) });
    }
  });

  return (
    <div>
      <p style={s.hint}>
        {jobId
          ? 'Shown only on this booking’s client link.'
          : 'Shown to every client on their journey page. Add text, photos, PDFs and an explanatory video.'}
      </p>
      {error && <p style={s.error}>{error}</p>}
      {blocks === null && <p style={s.hint}>Loading…</p>}
      {blocks && blocks.length === 0 && <p style={s.hint}>Nothing added yet.</p>}
      {blocks && blocks.map((b) => (
        <div key={b.id} style={s.row}>
          <div style={{ flex: 1 }}>
            <div style={s.title}>{b.title}{!b.is_active && <span style={s.off}> (hidden)</span>}</div>
            {b.body && <div style={s.body}>{b.body}</div>}
            {b.video_url && <div style={s.meta}>Video: {b.video_url}</div>}
            {b.files.map((f) => (
              <div key={f.id} style={s.meta}>
                {f.mime_type.startsWith('image/') ? '\u{1F5BC}' : '\u{1F4C4}'} {f.filename}{' '}
                <button style={s.link} disabled={busy} onClick={() => run(() => call(`/files/${f.id}`, { method: 'DELETE' }))}>remove</button>
              </div>
            ))}
            <label style={s.addFile}>
              + Add photos / PDFs
              <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }}
                disabled={busy} onChange={(e) => { if (e.target.files.length) upload(b.id, e.target.files); e.target.value = ''; }} />
            </label>
          </div>
          <div style={s.actions}>
            <button style={s.link} disabled={busy} onClick={() => run(() => call(`/${b.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !b.is_active }) }))}>
              {b.is_active ? 'Hide' : 'Show'}
            </button>
            <button style={{ ...s.link, color: 'var(--gm-brick)' }} disabled={busy}
              onClick={() => { if (window.confirm(`Delete "${b.title}" and its files?`)) run(() => call(`/${b.id}`, { method: 'DELETE' })); }}>
              Delete
            </button>
          </div>
        </div>
      ))}
      <div style={s.form}>
        <input style={s.input} placeholder="Heading (e.g. What to prepare)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea style={{ ...s.input, minHeight: 70 }} placeholder="Text shown to the client (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
        <input style={s.input} placeholder="Explanatory video link — YouTube, Vimeo or .mp4 (optional)" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} />
        <button className="gm-btn-primary" disabled={busy || !title.trim()} onClick={add}>Add field</button>
        <p style={s.hint}>After adding, use “Add photos / PDFs” on the field to attach files (up to 6MB each).</p>
      </div>
    </div>
  );
}

const s = {
  hint: { fontSize: 12, color: 'var(--gm-ink-soft)', margin: '4px 0 10px' },
  error: { fontSize: 13, color: 'var(--gm-brick)', margin: '4px 0' },
  row: { display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--gm-line-soft)' },
  title: { fontSize: 14, fontWeight: 600 },
  off: { fontWeight: 400, color: 'var(--gm-ink-soft)' },
  body: { fontSize: 13, marginTop: 2, whiteSpace: 'pre-wrap' },
  meta: { fontSize: 12, color: 'var(--gm-ink-soft)', marginTop: 3, wordBreak: 'break-all' },
  addFile: { display: 'inline-block', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', marginTop: 6, color: 'var(--gm-forest)' },
  actions: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' },
  link: { background: 'none', border: 'none', fontSize: 12, textDecoration: 'underline', padding: 0, cursor: 'pointer' },
  form: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--gm-line)' },
  input: { padding: 8, border: '1px solid var(--gm-line)', borderRadius: 6, fontSize: 14, fontFamily: 'inherit' },
};
