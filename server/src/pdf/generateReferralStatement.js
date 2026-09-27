import PDFDocument from 'pdfkit';
import { drawHeader, FOREST, INK_SOFT, LINE } from './branding.js';

/**
 * A commission statement — what a referral partner is owed for a
 * period's referred, completed jobs.
 *
 * Deliberately NOT called an RCTI. A recipient-created tax invoice is a
 * specific ATO construct tied to GST and a registered supplier making a
 * taxable supply — the relationship with a vet. A referral partner
 * receiving a commission is a different legal relationship, and this
 * document does not claim to be one.
 */

function formatMoney(n) {
  return `$${Number(n).toFixed(2)}`;
}
function formatDate(d) {
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function drawStatementDoc(doc, { period, items, company }) {
  const top = drawHeader(doc, {
    company,
    docTitle: 'Referral Commission Statement',
    meta: [
      ['Statement', period.statement_number],
      ['Date', formatDate(new Date())],
      ['Period', `${formatDate(period.period_start)} – ${formatDate(period.period_end)}`],
    ],
  });

  doc.fontSize(11).fillColor('#2A2620').text('Payable to', 50, top);
  doc.fontSize(10).fillColor(INK_SOFT);
  let y = top + 16;
  doc.text(period.partner_name, 50, y); y += 14;
  if (period.partner_abn) { doc.text(`ABN: ${period.partner_abn}`, 50, y); y += 14; }
  if (period.address) {
    doc.text([period.address, period.suburb, period.state, period.postcode].filter(Boolean).join(', '), 50, y, { width: 240 });
  }

  let tableY = top + 100;
  doc.moveTo(50, tableY).lineTo(545, tableY).strokeColor(LINE).stroke();
  tableY += 12;
  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text('Job', 50, tableY);
  doc.text('Client', 190, tableY);
  doc.text('Commission', 400, tableY);
  doc.text('Amount', 480, tableY, { width: 65, align: 'right' });
  tableY += 18;
  doc.moveTo(50, tableY - 4).lineTo(545, tableY - 4).strokeColor(LINE).stroke();

  doc.fillColor('#2A2620').fontSize(9);
  // Every referred job that made up this total, itemised — so the
  // partner can check the total against their own referral records
  // rather than trusting one lump sum.
  for (const item of items) {
    doc.text(`${item.job_number} · ${formatDate(item.job_date)}`, 50, tableY, { width: 130 });
    doc.text(item.client_name || '—', 190, tableY, { width: 200 });
    doc.text(item.description, 400, tableY, { width: 70 });
    doc.text(formatMoney(item.amount), 480, tableY, { width: 65, align: 'right' });
    tableY += 20;
  }

  tableY += 10;
  doc.moveTo(50, tableY).lineTo(545, tableY).strokeColor(LINE).stroke();
  tableY += 12;

  doc.fontSize(10).fillColor(INK_SOFT);
  if (Number(period.gst) > 0) {
    doc.text('Subtotal (ex GST)', 400, tableY); doc.text(formatMoney(period.subtotal), 480, tableY, { width: 65, align: 'right' });
    tableY += 16;
    doc.text('GST', 400, tableY); doc.text(formatMoney(period.gst), 480, tableY, { width: 65, align: 'right' });
    tableY += 20;
  }

  doc.fontSize(12).fillColor(FOREST);
  doc.text('Total payable', 400, tableY);
  doc.text(formatMoney(period.total), 480, tableY, { width: 65, align: 'right' });

  tableY += 40;
  doc.fontSize(8).fillColor(INK_SOFT).text(
    'This statement records a referral commission and is not a recipient created tax invoice. '
    + 'If GST applies, it has been calculated on the commission amount above.',
    50, tableY, { width: 495 }
  );
}

export function generateReferralStatementPdfBuffer({ period, items, company }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawStatementDoc(doc, { period, items, company });
    doc.end();
  });
}

export function referralStatementFilename(period) {
  return `${period.statement_number || 'statement'}.pdf`;
}
