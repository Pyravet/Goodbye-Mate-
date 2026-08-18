import PDFDocument from 'pdfkit';
import { periodLabel } from '../domain/payoutPeriods.js';
import { drawHeader, drawFooter, formatMoney, formatDate, FOREST, INK, INK_SOFT, LINE } from './branding.js';

/**
 * Draw a period RCTI — one tax invoice covering every job a vet did in a
 * pay week, rather than one document per job.
 *
 * All figures come from the FROZEN period record (vet_payout_periods and
 * its items), never recomputed from live job data. That's the whole
 * point: an issued tax invoice must reproduce identically forever, even
 * if pricing settings or the underlying jobs change afterwards.
 *
 * @param {PDFDocument} doc
 * @param {object} args
 * @param {object} args.period  Row from vet_payout_periods (frozen totals).
 * @param {object[]} args.items Rows from vet_payout_period_items.
 * @param {object} args.vet     Vet + user details (name, ABN, registration).
 * @param {object} args.company Issuing company details from content settings.
 */
function drawPeriodRcti(doc, { period, items, vet, company }) {
  const top = drawHeader(doc, {
    company,
    docTitle: 'Recipient Created Tax Invoice',
    meta: [
      ['RCTI', period.rcti_number || '(draft — not yet issued)'],
      ['Issued', formatDate(period.approved_at || new Date())],
      ['Pay period', periodLabel(period.period_start, period.period_end)],
    ],
  });

  // --- Payable to ---
  doc.fontSize(11).fillColor(INK).text('Payable to', 50, top);
  doc.fontSize(10).fillColor(INK_SOFT);
  let y = top + 16;
  doc.text(vet.full_name, 50, y); y += 14;
  if (vet.reg_number) {
    doc.text(`Registration: ${vet.reg_number}${vet.reg_state ? ` (${vet.reg_state})` : ''}`, 50, y);
    y += 14;
  }
  if (vet.abn) { doc.text(`ABN: ${vet.abn}`, 50, y); y += 14; }
  doc.text(`GST registered: ${vet.is_gst_registered ? 'Yes' : 'No'}`, 50, y);

  // --- Summary block ---
  doc.fontSize(11).fillColor(INK).text('Summary', 330, top);
  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text(`${items.length} job${items.length === 1 ? '' : 's'} completed`, 330, top + 16);
  doc.text(`Status: ${period.status}`, 330, top + 30);
  if (period.paid_at) doc.text(`Paid: ${formatDate(period.paid_at)}`, 330, top + 44);

  // --- Line items table ---
  let tableY = top + 80;
  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text('Date', 50, tableY);
  doc.text('Job', 110, tableY);
  doc.text('Description', 210, tableY);
  doc.text('Amount', 480, tableY, { width: 65, align: 'right' });
  tableY += 16;
  doc.moveTo(50, tableY).lineTo(545, tableY).strokeColor(LINE).stroke();
  tableY += 10;

  doc.fillColor(INK);
  for (const item of items) {
    // Start a new page before running off the bottom, and repeat nothing
    // but the rows — a long week shouldn't silently truncate.
    if (tableY > 700) {
      doc.addPage();
      tableY = 60;
    }
    doc.fontSize(9);
    doc.text(formatDate(item.job_date), 50, tableY, { width: 55 });
    doc.text(item.job_number, 110, tableY, { width: 95 });
    doc.text(item.description + (item.pet_name ? ` — ${item.pet_name}` : ''), 210, tableY, { width: 260 });
    doc.text(formatMoney(item.amount), 480, tableY, { width: 65, align: 'right' });
    tableY += 18;
  }

  // --- Totals ---
  tableY += 6;
  doc.moveTo(330, tableY).lineTo(545, tableY).strokeColor(LINE).stroke();
  tableY += 12;

  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text('Subtotal', 330, tableY);
  doc.fillColor(INK).text(formatMoney(period.subtotal), 480, tableY, { width: 65, align: 'right' });
  tableY += 16;

  doc.fillColor(INK_SOFT).text(vet.is_gst_registered ? 'GST (10%)' : 'GST (not registered)', 330, tableY);
  doc.fillColor(INK).text(formatMoney(period.gst), 480, tableY, { width: 65, align: 'right' });
  tableY += 18;

  doc.moveTo(330, tableY - 4).lineTo(545, tableY - 4).strokeColor(LINE).stroke();
  doc.fontSize(12).fillColor(FOREST).text('Total payable', 330, tableY + 4);
  doc.text(formatMoney(period.total), 480, tableY + 4, { width: 65, align: 'right' });

  drawFooter(doc, {
    company,
    legalText: company.rctiDeclaration
      || 'This Recipient Created Tax Invoice is issued by the recipient of the supply. '
      + 'The supplier will not issue a tax invoice for these services.',
  });
}

/** Stream a period RCTI directly to an HTTP response. */
export function generatePeriodRctiPdf({ res, period, items, vet, company }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  drawPeriodRcti(doc, { period, items, vet, company });
  doc.end();
}

/** Render a period RCTI to a Buffer, for emailing as an attachment. */
export function generatePeriodRctiPdfBuffer({ period, items, vet, company }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawPeriodRcti(doc, { period, items, vet, company });
    doc.end();
  });
}

/** Filename for a period RCTI, e.g. "RCTI-00007-Jane-Smith.pdf". */
export function periodRctiFilename(period, vet) {
  const safeName = (vet.full_name || 'vet').replace(/[^a-zA-Z0-9]+/g, '-');
  return `${period.rcti_number || 'RCTI-draft'}-${safeName}.pdf`;
}
