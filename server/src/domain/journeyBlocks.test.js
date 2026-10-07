import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoUrl, validateAttachment, MAX_FILE_BYTES } from './journeyBlocks.js';

test('youtube variants become nocookie embeds', () => {
  for (const u of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/dQw4w9WgXcQ', 'https://youtube.com/shorts/dQw4w9WgXcQ']) {
    assert.deepEqual(parseVideoUrl(u), { kind: 'embed', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' });
  }
});
test('vimeo and direct mp4 accepted', () => {
  assert.equal(parseVideoUrl('https://vimeo.com/123456789').src, 'https://player.vimeo.com/video/123456789');
  assert.equal(parseVideoUrl('https://cdn.example.com/a.mp4').kind, 'file');
});
test('unsafe or unsupported links rejected', () => {
  for (const u of ['http://youtu.be/dQw4w9WgXcQ', 'javascript:alert(1)', 'https://evil.com/page', 'https://youtube.com/watch?v="><script>', '', null]) {
    assert.equal(parseVideoUrl(u), null);
  }
});
test('attachments identified by magic bytes, not name', () => {
  const b64 = (arr) => Buffer.from(arr).toString('base64');
  assert.equal(validateAttachment(b64(Buffer.from('%PDF-1.4 x'))).mimeType, 'application/pdf');
  assert.equal(validateAttachment(b64([0xff, 0xd8, 0xff, 0xe0, 0])).mimeType, 'image/jpeg');
  assert.ok(validateAttachment(b64(Buffer.from('<html><script>'))).error);
  assert.ok(validateAttachment(Buffer.alloc(MAX_FILE_BYTES + 1, 0x25).toString('base64')).error);
});
