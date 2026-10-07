// Pure helpers for admin-defined journey content: video link parsing and
// attachment validation. No DB, so they are unit-tested directly.

export const MAX_FILE_BYTES = 6 * 1024 * 1024;
export const MAX_FILES_PER_BLOCK = 10;

/**
 * Turn an admin-pasted video link into something the client page can
 * render. Only YouTube, Vimeo and direct mp4/webm links are accepted, so
 * an arbitrary URL can never be dropped into an iframe.
 * Returns { kind: 'embed'|'file', src } or null if unsupported.
 */
export function parseVideoUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const idOk = (s) => /^[A-Za-z0-9_-]{6,20}$/.test(s || '');

  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    return idOk(id) ? { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id = u.searchParams.get('v');
    const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/);
    if (!id && m) id = m[1];
    return idOk(id) ? { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${id}` } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = u.pathname.match(/(\d{5,12})/);
    return m ? { kind: 'embed', src: `https://player.vimeo.com/video/${m[1]}` } : null;
  }
  if (/\.(mp4|webm)$/i.test(u.pathname)) return { kind: 'file', src: u.toString() };
  return null;
}

/**
 * Validate an uploaded attachment by its real magic bytes (never the
 * supplied filename/mime). Returns { buffer, mimeType } or { error }.
 */
export function validateAttachment(dataBase64) {
  if (!dataBase64 || typeof dataBase64 !== 'string') return { error: 'No file data' };
  const buffer = Buffer.from(dataBase64, 'base64');
  if (buffer.length === 0) return { error: 'File is empty' };
  if (buffer.length > MAX_FILE_BYTES) return { error: 'File must be under 6MB' };
  const h = buffer.subarray(0, 12);
  if (h.subarray(0, 4).toString('ascii') === '%PDF') return { buffer, mimeType: 'application/pdf' };
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return { buffer, mimeType: 'image/jpeg' };
  if (h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { buffer, mimeType: 'image/png' };
  if (h.subarray(0, 4).toString('ascii') === 'RIFF' && h.subarray(8, 12).toString('ascii') === 'WEBP') return { buffer, mimeType: 'image/webp' };
  if (h.subarray(0, 3).toString('ascii') === 'GIF') return { buffer, mimeType: 'image/gif' };
  return { error: 'Only PDF, JPG, PNG, WebP or GIF files are allowed' };
}

export function shapeBlockForClient(block, files, token, basePath) {
  const video = parseVideoUrl(block.video_url);
  return {
    id: block.id,
    title: block.title,
    body: block.body,
    video,
    files: files.map((f) => ({
      id: f.id,
      filename: f.filename,
      isImage: f.mime_type.startsWith('image/'),
      href: `${basePath}/${token}/extra-file/${f.id}`,
    })),
  };
}
