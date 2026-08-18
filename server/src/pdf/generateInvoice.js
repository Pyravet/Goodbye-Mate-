import PDFDocument from 'pdfkit';
import { drawHeader, drawFooter, FOREST, INK_SOFT, LINE } from './branding.js';


function formatMoney(n) {
  return `$${Number(n).toFixed(2)}`;
}
function formatDate(d) {
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Draws the document content onto an already-created PDFDocument — shared
// by both the "stream straight to the browser" path and the "collect into
// a Buffer for emailing" path, so the layout only lives in one place.
function drawInvoiceDoc(doc, { job, bill, company, asQuote }) {
  const isPaid = job.payment_status === 'paid';
  const docLabel = asQuote ? 'Quote' : isPaid ? 'Receipt' : 'Invoice';

  const top = drawHeader(doc, {
    company,
    // Tax Invoice is the legally meaningful label once GST has been
    // charged; a quote and a receipt are not tax invoices.
    docTitle: asQuote ? 'Quote' : isPaid ? 'Receipt' : 'Tax Invoice',
    meta: [
      [docLabel, job.job_number],
      ['Date', formatDate(new Date())],
      ['Visit date', formatDate(job.job_date)],
      !asQuote && isPaid ? ['Status', 'PAID'] : null,
    ].filter(Boolean),
  });

  doc.fontSize(11).fillColor('#2A2620').text('Billed to', 50, top);
  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text(job.client_name, 50, top + 16);
  if (job.client_email) doc.text(job.client_email, 50, top + 30);
  doc.text(job.client_phone, 50, top + 44);

  doc.fontSize(11).fillColor('#2A2620').text('For', 320, top);
  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text(job.pet_name, 320, top + 16);
  doc.text(job.address, 320, top + 30, { width: 220 });

  let tableY = top + 90;
  doc.moveTo(50, tableY).lineTo(545, tableY).strokeColor(LINE).stroke();
  tableY += 12;
  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text('Description', 50, tableY);
  doc.text('Amount', 480, tableY, { width: 65, align: 'right' });
  tableY += 18;
  doc.moveTo(50, tableY - 4).lineTo(545, tableY - 4).strokeColor(LINE).stroke();

  doc.fillColor('#2A2620');
  for (const line of bill.lines) {
    doc.text(line.label, 50, tableY);
    doc.text(formatMoney(line.amount), 480, tableY, { width: 65, align: 'right' });
    tableY += 18;
  }

  tableY += 6;
  doc.moveTo(50, tableY).lineTo(545, tableY).strokeColor(LINE).stroke();
  tableY += 10;

  doc.fontSize(12).fillColor(FOREST);
  doc.text('Total', 50, tableY);
  doc.text(formatMoney(bill.total), 480, tableY, { width: 65, align: 'right' });

  tableY += 40;
  doc.fontSize(9).fillColor(INK_SOFT).text(
    asQuote
      ? 'This is a quote, not a tax invoice. Prices are subject to change and are not a final bill until the visit is confirmed.'
      : isPaid
      ? 'Thank you — payment for this visit has been received.'
      : 'Payment for this visit is due prior to or at the time of service.',
    50,
    tableY,
    { width: 495 }
  );

  drawFooter(doc, { company });
}

function docLabelFor(job, asQuote) {
  return asQuote ? 'Quote' : job.payment_status === 'paid' ? 'Receipt' : 'Invoice';
}

// Client-facing invoice/receipt/quote — streamed straight to an HTTP
// response (browser download).
export function generateInvoicePdf({ res, job, bill, company, asQuote = false }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${docLabelFor(job, asQuote)}-${job.job_number}.pdf"`);
  doc.pipe(res);
  drawInvoiceDoc(doc, { job, bill, company, asQuote });
  doc.end();
}

// Same document, collected into a Buffer instead — for attaching to an
// email rather than streaming to a browser.
export function generateInvoicePdfBuffer({ job, bill, company, asQuote = false }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawInvoiceDoc(doc, { job, bill, company, asQuote });
    doc.end();
  });
}

export function invoiceFilename(job, asQuote = false) {
  return `${docLabelFor(job, asQuote)}-${job.job_number}.pdf`;
}
