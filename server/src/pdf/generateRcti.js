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

function drawRctiDoc(doc, { job, vet, payout, gst, company }) {
  doc.fontSize(20).fillColor(FOREST).text(company.name || 'Goodbye Mate', 50, 50);
  doc.fontSize(10).fillColor(INK_SOFT).text('Recipient Created Tax Invoice', 50, 76);
  if (company.abn) doc.text(`ABN: ${company.abn}`, 50, 90);
  if (company.address) doc.text(company.address, 50, 104);

  doc.fontSize(10).fillColor(INK_SOFT).text(`RCTI #${job.job_number}`, 400, 50, { align: 'right' });
  doc.text(`Date: ${formatDate(new Date())}`, 400, 64, { align: 'right' });
  doc.text(`Job date: ${formatDate(job.job_date)}`, 400, 78, { align: 'right' });

  doc.moveTo(50, 130).lineTo(545, 130).strokeColor(LINE).stroke();

  doc.fontSize(11).fillColor('#2A2620').text('Payable to', 50, 148);
  doc.fontSize(10).fillColor(INK_SOFT);
  let y = 164;
  doc.text(vet.full_name, 50, y); y += 14;
  if (vet.reg_number) { doc.text(`Registration: ${vet.reg_number}${vet.reg_state ? ` (${vet.reg_state})` : ''}`, 50, y); y += 14; }
  if (vet.abn) { doc.text(`ABN: ${vet.abn}`, 50, y); y += 14; }
  doc.text(`GST registered: ${vet.is_gst_registered ? 'Yes' : 'No'}`, 50, y); y += 14;

  doc.fontSize(11).fillColor('#2A2620').text('For job', 320, 148);
  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text(`${job.job_number} — ${job.pet_name}`, 320, 164);
  doc.text(job.client_name, 320, 178);
  doc.text(job.address, 320, 192, { width: 220 });

  let tableY = 250;
  doc.moveTo(50, tableY).lineTo(545, tableY).strokeColor(LINE).stroke();
  tableY += 12;
  doc.fontSize(10).fillColor(INK_SOFT);
  doc.text('Description', 50, tableY);
  doc.text('Amount', 480, tableY, { width: 65, align: 'right' });
  tableY += 18;
  doc.moveTo(50, tableY - 4).lineTo(545, tableY - 4).strokeColor(LINE).stroke();

  doc.fillColor('#2A2620');
  const rows = [
    [payout.serviceName, payout.serviceAmt],
    ['Transfer fee', payout.transferAmt],
  ];
  if (payout.travelAmt > 0) rows.push(['Extra travel fee', payout.travelAmt]);

  for (const [label, amt] of rows) {
    doc.text(label, 50, tableY);
    doc.text(formatMoney(amt), 480, tableY, { width: 65, align: 'right' });
    tableY += 18;
  }

  tableY += 6;
  doc.moveTo(50, tableY).lineTo(545, tableY).strokeColor(LINE).stroke();
  tableY += 10;

  if (vet.is_gst_registered && gst) {
    doc.fontSize(10).fillColor(INK_SOFT);
    doc.text('Amount (ex GST)', 50, tableY);
    doc.text(formatMoney(gst.exGstAmount), 480, tableY, { width: 65, align: 'right' });
    tableY += 16;
    doc.text('GST', 50, tableY);
    doc.text(formatMoney(gst.gstAmount), 480, tableY, { width: 65, align: 'right' });
    tableY += 20;
  }

  doc.fontSize(12).fillColor(FOREST);
  doc.text('Total payable', 50, tableY, { continued: false });
  doc.text(formatMoney(payout.total), 480, tableY, { width: 65, align: 'right' });

  tableY += 50;
  doc.fontSize(8).fillColor(INK_SOFT).text(
    company.rctiDeclaration ||
      'This is a recipient created tax invoice (RCTI). Goodbye Mate will retain the original copy of this tax invoice and a copy will be provided to the recipient.',
    50,
    tableY,
    { width: 495 }
  );
}

export function generateRctiPdf({ res, job, vet, payout, gst, company }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="RCTI-${job.job_number}.pdf"`);
  doc.pipe(res);
  drawRctiDoc(doc, { job, vet, payout, gst, company });
  doc.end();
}

export function generateRctiPdfBuffer({ job, vet, payout, gst, company }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawRctiDoc(doc, { job, vet, payout, gst, company });
    doc.end();
  });
}

export function rctiFilename(job) {
  return `RCTI-${job.job_number}.pdf`;
}
