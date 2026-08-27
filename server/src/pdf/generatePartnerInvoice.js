import PDFDocument from 'pdfkit';
import { drawHeader, drawFooter, formatDate, INK, INK_SOFT, LINE } from './branding.js';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/**
 * Invoice issued to another business — a crematorium partner, a
 * referring clinic, a corporate account.
 *
 * Distinct from both existing documents: the client invoice is issued to
 * a pet owner for one job, and the RCTI is issued on behalf of a vet
 * supplier. This is the business billing another business.
 */
function drawInvoice(doc, { invoice, items, company, bank }) {
  const top = drawHeader(doc, {
    company,
    // "Tax Invoice" is legally meaningful and only correct when GST is
    // actually charged. A draft carries no number yet, so calling it an
    // invoice at all would be wrong.
    docTitle: invoice.status === 'draft'
      ? 'Draft Invoice'
      : (Number(invoice.gst) > 0 ? 'Tax Invoice' : 'Invoice'),
    meta: [
      ['Invoice', invoice.invoice_number || 'Not yet issued'],
      ['Issued', formatDate(invoice.issue_date)],
      ...(invoice.due_date ? [['Due', formatDate(invoice.due_date)]] : []),
      ...(invoice.status === 'paid' ? [['Status', 'PAID']] : []),
    ],
  });

  const label = (text, x, y) => doc.fontSize(9).fillColor(INK_SOFT).text(text.toUpperCase(), x, y);

  let y = top;
  label('Bill to', 50, y);
  y += 14;
  doc.fontSize(12).fillColor(INK).text(invoice.recipient_name, 50, y, { width: 260 });
  y = doc.y + 2;
  doc.fontSize(9).fillColor(INK_SOFT);
  if (invoice.recipient_abn) { doc.text(`ABN ${invoice.recipient_abn}`, 50, y); y += 12; }
  if (invoice.recipient_address) { doc.text(invoice.recipient_address, 50, y, { width: 260 }); y = doc.y + 2; }
  if (invoice.recipient_email) { doc.text(invoice.recipient_email, 50, y, { width: 260 }); y = doc.y; }

  y += 22;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 14;

  // --- Line items ---
  doc.fontSize(9).fillColor(INK_SOFT);
  doc.text('DESCRIPTION', 50, y);
  doc.text('QTY', 330, y, { width: 40, align: 'right' });
  doc.text('UNIT', 380, y, { width: 70, align: 'right' });
  doc.text('AMOUNT', 460, y, { width: 85, align: 'right' });
  y += 16;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).stroke();
  y += 10;

  for (const item of items) {
    // Start a new page before the row rather than after, so a line never
    // straddles the page break with its amount orphaned.
    if (y > 690) {
      doc.addPage();
      y = 60;
    }
    doc.fontSize(10).fillColor(INK).text(item.description, 50, y, { width: 270 });
    const rowBottom = doc.y;
    doc.text(String(Number(item.quantity)), 330, y, { width: 40, align: 'right' });
    doc.text(money(item.unit_amount), 380, y, { width: 70, align: 'right' });
    doc.text(money(item.amount), 460, y, { width: 85, align: 'right' });
    y = Math.max(rowBottom, y + 14) + 4;
  }

  y += 6;
  doc.moveTo(330, y).lineTo(545, y).strokeColor(LINE).stroke();
  y += 10;

  const totalRow = (text, value, bold) => {
    doc.fontSize(bold ? 12 : 10).fillColor(bold ? INK : INK_SOFT);
    doc.text(text, 330, y, { width: 120, align: 'right' });
    doc.text(money(value), 460, y, { width: 85, align: 'right' });
    y += bold ? 20 : 16;
  };

  totalRow('Subtotal', invoice.subtotal);
  // Only shown when GST is actually charged — a "$0.00 GST" line implies
  // a registration that may not exist.
  if (Number(invoice.gst) > 0) totalRow('GST', invoice.gst);
  totalRow('Total', invoice.total, true);

  // --- Payment details ---
  if (bank?.accountNumber || bank?.bsb) {
    y += 14;
    doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).stroke();
    y += 14;
    label('Payment by bank transfer', 50, y);
    y += 14;
    doc.fontSize(10).fillColor(INK);
    if (bank.accountName) { doc.text(`Account name: ${bank.accountName}`, 50, y); y += 14; }
    if (bank.bsb) { doc.text(`BSB: ${bank.bsb}`, 50, y); y += 14; }
    if (bank.accountNumber) { doc.text(`Account number: ${bank.accountNumber}`, 50, y); y += 14; }
    if (bank.bankName) { doc.text(bank.bankName, 50, y); y += 14; }
    // The invoice number as the payment reference is what makes a bank
    // transfer reconcilable — without it a payment arrives as an
    // unattributed deposit.
    if (invoice.invoice_number) {
      doc.fontSize(10).fillColor(INK_SOFT)
        .text(`Please use ${invoice.invoice_number} as the payment reference.`, 50, y);
      y += 14;
    }
    if (bank.paymentTerms) {
      doc.fontSize(9).fillColor(INK_SOFT).text(bank.paymentTerms, 50, y, { width: 400 });
      y = doc.y;
    }
  }

  if (invoice.notes) {
    y += 14;
    label('Notes', 50, y);
    y += 14;
    doc.fontSize(9).fillColor(INK_SOFT).text(invoice.notes, 50, y, { width: 495 });
  }

  drawFooter(doc, { company });
}

export function generatePartnerInvoicePdf({ res, invoice, items, company, bank }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  drawInvoice(doc, { invoice, items, company, bank });
  doc.end();
}

export function generatePartnerInvoicePdfBuffer({ invoice, items, company, bank }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawInvoice(doc, { invoice, items, company, bank });
    doc.end();
  });
}

export function partnerInvoiceFilename(invoice) {
  const who = (invoice.recipient_name || 'partner').replace(/[^a-zA-Z0-9]+/g, '-');
  return `${invoice.invoice_number || 'Draft'}-${who}.pdf`;
}
