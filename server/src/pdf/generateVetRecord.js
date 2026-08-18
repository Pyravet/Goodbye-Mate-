import PDFDocument from 'pdfkit';
import { drawHeader, drawFooter, formatDate, INK, INK_SOFT, LINE } from './branding.js';

/**
 * Veterinary record for a completed visit.
 *
 * Clients are sometimes asked for this by pet insurers, so it has to
 * stand on its own as a formal document: who performed the procedure and
 * under what registration, the animal's identifying details, when and
 * where it took place, and the attending vet's clinical notes. A bare
 * paragraph of notes emailed with no context is not something an insurer
 * will accept.
 *
 * @param {PDFKit.PDFDocument} doc
 * @param {object} args
 * @param {object} args.job    Job row (pet, client, address, dates, notes).
 * @param {object} args.vet    Attending vet: name, registration, ABN.
 * @param {object} args.company Issuing company details.
 */
function drawRecord(doc, { job, vet, company }) {
  const top = drawHeader(doc, {
    company,
    docTitle: 'Veterinary Record',
    meta: [
      ['Reference', job.job_number],
      ['Date of visit', formatDate(job.job_date)],
      ['Issued', formatDate(new Date())],
    ],
  });

  const label = (text, x, y) => doc.fontSize(9).fillColor(INK_SOFT).text(text.toUpperCase(), x, y);
  const value = (text, x, y, opts = {}) => doc.fontSize(11).fillColor(INK).text(text || '—', x, y, opts);

  // --- Attending vet ---
  let y = top;
  label('Attending veterinarian', 50, y);
  y += 14;
  value(vet.full_name, 50, y); y += 16;
  doc.fontSize(9).fillColor(INK_SOFT);
  if (vet.reg_number) {
    doc.text(`Registration no. ${vet.reg_number}${vet.reg_state ? ` (${vet.reg_state})` : ''}`, 50, y);
    y += 12;
  }
  if (vet.abn) { doc.text(`ABN ${vet.abn}`, 50, y); y += 12; }

  // --- Owner ---
  let yRight = top;
  label('Owner', 320, yRight);
  yRight += 14;
  value(job.client_name, 320, yRight, { width: 225 }); yRight += 16;
  doc.fontSize(9).fillColor(INK_SOFT);
  if (job.client_phone) { doc.text(job.client_phone, 320, yRight); yRight += 12; }
  if (job.client_email) { doc.text(job.client_email, 320, yRight, { width: 225 }); yRight += 12; }

  y = Math.max(y, yRight) + 14;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 16;

  // --- Animal details ---
  // Insurers key off species/breed/age/weight, so these are laid out as
  // discrete labelled fields rather than buried in prose.
  label('Animal', 50, y);
  y += 14;
  value(job.pet_name, 50, y);
  y += 18;

  const fields = [
    ['Species', job.pet_type],
    ['Breed', job.pet_breed],
    ['Age', job.pet_age],
    ['Weight', job.pet_weight],
  ];
  let col = 0;
  let rowY = y;
  for (const [name, val] of fields) {
    const x = 50 + (col % 2) * 250;
    doc.fontSize(9).fillColor(INK_SOFT).text(name, x, rowY);
    doc.fontSize(10).fillColor(INK).text(val || '—', x, rowY + 12, { width: 230 });
    col += 1;
    if (col % 2 === 0) rowY += 34;
  }
  y = (col % 2 === 0 ? rowY : rowY + 34) + 6;

  doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 16;

  // --- Visit details ---
  label('Visit', 50, y);
  y += 14;
  doc.fontSize(10).fillColor(INK);
  doc.text(`Service: ${serviceLabel(job.service_type)}`, 50, y); y += 14;
  doc.text(`Date and time: ${formatDate(job.job_date)}${job.job_time ? ` at ${job.job_time}` : ''}`, 50, y); y += 14;
  doc.text(`Location: ${job.address || '—'}`, 50, y, { width: 495 }); y += 14;
  if (job.procedure_done_at) {
    doc.text(`Procedure performed: ${formatDate(job.procedure_done_at)}`, 50, y);
    y += 14;
  }
  y += 6;

  doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 16;

  // --- Clinical notes ---
  label('Clinical notes', 50, y);
  y += 16;
  doc.fontSize(10).fillColor(INK).text(
    job.medical_notes && job.medical_notes.trim()
      ? job.medical_notes
      : 'No clinical notes were recorded for this visit.',
    50, y, { width: 495, align: 'left' }
  );

  drawFooter(doc, {
    company,
    legalText:
      'This record is issued by the attending veterinary practice for the visit referenced above. '
      + 'It may be provided to a pet insurer or other party at the owner\u2019s request.',
  });
}

function serviceLabel(type) {
  return {
    euthanasia_only: 'In-home euthanasia',
    private_cremation: 'In-home euthanasia with private cremation',
    communal_cremation: 'In-home euthanasia with communal cremation',
  }[type] || 'In-home euthanasia';
}

/** Stream the record to an HTTP response. */
export function generateVetRecordPdf({ res, job, vet, company }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  drawRecord(doc, { job, vet, company });
  doc.end();
}

/** Render the record to a Buffer, for emailing as an attachment. */
export function generateVetRecordPdfBuffer({ job, vet, company }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawRecord(doc, { job, vet, company });
    doc.end();
  });
}

export function vetRecordFilename(job) {
  const pet = (job.pet_name || 'pet').replace(/[^a-zA-Z0-9]+/g, '-');
  return `Veterinary-Record-${pet}-${job.job_number}.pdf`;
}
