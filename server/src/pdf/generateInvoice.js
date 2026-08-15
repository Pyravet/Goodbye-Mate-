import PDFDocument from 'pdfkit';

const FOREST = '#33453A';
const INK_SOFT = '#6B6559';
const LINE = '#E7E0D3';

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

  doc.fontSize(20).fillColor(FOREST).text(company.name || 'Goodbye Mate', 50, 50);
  doc.fontSize(10).fillColor(INK_SOFT).text(docLabel, 50, 76);
  if (company.abn) doc.text(`ABN: ${company.abn}`, 50, 90);
  if (company.address) doc.text(company.address, 50, 104);

  doc.fontSize(10).fillColor(INK_SOFT).text(`${docLabel} #${job.job_number}`, 400, 50, { align: 'right' });
  doc.text(`Date: ${formatDate(new Date())}`, 400, 64, { align: 'right' });
  doc.text(`Visit date: ${formatDate(job.job_date)}`, 400, 78, { align: 'right' });
  if (!asQuote && isPaid) doc.fillColor(FOREST).text('PAID', 400, 92, { align: 'right' });

  doc.moveTo(50, 130).lineTo(545, 130).strokeColor(LINE).stroke();

  doc.fontSize(11).fillColor('#2A2620').text('Billed to', 50, 148);
  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text(job.client_name, 50, 164);
  if (job.client_email) doc.text(job.client_email, 50, 178);
  doc.text(job.client_phone, 50, 192);

  doc.fontSize(11).fillColor('#2A2620').text('For', 320, 148);
  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text(job.pet_name, 320, 164);
  doc.text(job.address, 320, 178, { width: 220 });

  let tableY = 250;
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
