import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, 'assets', 'logo.png');

export const FOREST = '#33453A';
export const INK = '#2A2620';
export const INK_SOFT = '#6B6559';
export const LINE = '#E7E0D3';

// Resolved once at module load rather than per document — these are
// generated on demand and re-reading the file for every invoice would be
// wasteful. Missing logo degrades to a text wordmark rather than
// throwing: a document that renders without its logo is far better than
// an invoice that fails to generate at all.
const logoExists = fs.existsSync(LOGO_PATH);

/**
 * Draw the shared branded header on a PDF.
 *
 * Every document (quote, invoice, receipt, RCTI) uses this so they're
 * visually consistent and all carry the company's legal details —
 * previously each generator drew its own ad-hoc header and none showed
 * the logo at all.
 *
 * @param {PDFKit.PDFDocument} doc
 * @param {object} opts
 * @param {object} opts.company  content_settings.company
 * @param {string} opts.docTitle e.g. 'Tax Invoice', 'Quote', 'Receipt'
 * @param {Array<[string,string]>} [opts.meta] Right-aligned label/value
 *   pairs, e.g. [['Invoice #','GM-0001'], ['Date','19 Aug 2026']]
 * @returns {number} The y coordinate content may safely start from.
 */
export function drawHeader(doc, { company = {}, docTitle, meta = [] }) {
  const left = 50;
  let y = 45;

  if (logoExists) {
    // Fixed width, height auto — keeps the wordmark's aspect ratio.
    doc.image(LOGO_PATH, left, y, { width: 150 });
    y += 42;
  } else {
    doc.fontSize(20).fillColor(FOREST).text(company.name || 'Goodbye Mate', left, y);
    y += 28;
  }

  // Company legal details, under the logo.
  doc.fontSize(9).fillColor(INK_SOFT);
  const details = [
    company.name && logoExists ? company.name : null,
    company.abn ? `ABN ${company.abn}` : null,
    company.address || null,
    company.phone || null,
    company.email || null,
  ].filter(Boolean);
  for (const line of details) {
    doc.text(line, left, y, { width: 250 });
    y += 12;
  }

  // Document title + metadata, right-aligned.
  doc.fontSize(16).fillColor(FOREST).text(docTitle, 330, 45, { width: 215, align: 'right' });
  let metaY = 68;
  doc.fontSize(9).fillColor(INK_SOFT);
  for (const [label, value] of meta) {
    if (value == null || value === '') continue;
    doc.text(`${label}: ${value}`, 330, metaY, { width: 215, align: 'right' });
    metaY += 12;
  }

  const bottom = Math.max(y, metaY) + 10;
  doc.moveTo(left, bottom).lineTo(545, bottom).strokeColor(LINE).lineWidth(1).stroke();
  return bottom + 18;
}

/**
 * Footer line shown on every document, plus any extra legal text
 * (e.g. the RCTI declaration).
 *
 * @param {PDFKit.PDFDocument} doc
 * @param {object} opts
 * @param {object} opts.company
 * @param {string} [opts.legalText] Extra wording specific to this doc type.
 */
export function drawFooter(doc, { company = {}, legalText }) {
  const left = 50;
  let y = 745;

  if (legalText) {
    doc.fontSize(7.5).fillColor(INK_SOFT).text(legalText, left, y, { width: 495 });
    y = doc.y + 6;
  }

  doc.moveTo(left, y).lineTo(545, y).strokeColor(LINE).lineWidth(1).stroke();
  doc.fontSize(8).fillColor(INK_SOFT).text(
    [company.name, company.abn ? `ABN ${company.abn}` : null, company.phone, company.email]
      .filter(Boolean)
      .join('  ·  '),
    left, y + 6, { width: 495, align: 'center' }
  );
}

export function formatMoney(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export function formatDate(d) {
  if (!d) return '';
  // Accept both a Date (e.g. new Date() for "issued today") and a
  // 'YYYY-MM-DD' string from Postgres. The previous version sliced
  // everything as a string, so a Date object produced "Invalid Date" —
  // it stringifies to "Tue Aug 19 2026 …", and the first 10 characters
  // of that are not a parseable date.
  const parsed = d instanceof Date
    ? d
    : new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}
