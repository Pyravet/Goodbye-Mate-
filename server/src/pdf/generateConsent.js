import PDFDocument from 'pdfkit';
import { drawHeader, drawFooter, formatDate, INK, INK_SOFT, LINE } from './branding.js';

/**
 * Signed consent form.
 *
 * This is the document that matters most if a consent is ever
 * questioned, so it records the full picture rather than just a tick:
 * who performed the procedure and under what registration, which animal,
 * the exact wording the client agreed to, their drawn signature, and
 * when it was signed.
 *
 * @param {PDFKit.PDFDocument} doc
 * @param {object} args
 * @param {object} args.job     Job row, including consent fields.
 * @param {object} args.vet     Attending vet: name, registration, ABN, contact.
 * @param {object} args.company Issuing company details.
 * @param {string} args.consentText The wording actually shown to the client.
 * @param {Buffer|null} args.signatureImage PNG of the drawn signature.
 * @param {object} [args.pet] The specific animal this form covers.
 *   Falls back to the job's primary pet fields for single-pet bookings
 *   and for older callers.
 * @param {number} [args.petIndex] 1-based position, when there are several.
 * @param {number} [args.petCount] How many pets the visit covers.
 */
function drawConsent(doc, { job, vet, company, consentText, signatureImage, pet, petIndex, petCount }) {
  // A visit can cover two or three animals, each with its own form.
  // Describing the JOB's pet on every one produced identical documents
  // that looked like duplicates rather than distinct records — which
  // defeats the purpose of taking separate consent at all.
  const subject = pet || {
    name: job.pet_name,
    species: job.pet_type,
    breed: job.pet_breed,
    age: job.pet_age,
    weight: job.pet_weight,
    consent_signature_name: job.consent_signature_name,
    consent_signed_at: job.consent_signed_at,
  };
  const top = drawHeader(doc, {
    company,
    docTitle: 'Consent Form',
    meta: [
      ['Reference', job.job_number],
      ['Signed', formatDate(subject.consent_signed_at || job.consent_signed_at)],
      ['Visit date', formatDate(job.job_date)],
    ],
  });

  const label = (text, x, y) => doc.fontSize(9).fillColor(INK_SOFT).text(text.toUpperCase(), x, y);

  // --- Attending vet: the full details, not just a name ---
  let y = top;
  label('Attending veterinarian', 50, y);
  y += 14;
  doc.fontSize(12).fillColor(INK).text(vet.full_name || 'To be assigned', 50, y);
  y += 17;
  doc.fontSize(9).fillColor(INK_SOFT);
  if (vet.reg_number) {
    doc.text(`Veterinary registration no. ${vet.reg_number}${vet.reg_state ? ` (${vet.reg_state})` : ''}`, 50, y);
    y += 12;
  }
  if (vet.abn) { doc.text(`ABN ${vet.abn}`, 50, y); y += 12; }
  if (vet.phone) { doc.text(vet.phone, 50, y); y += 12; }
  if (vet.email) { doc.text(vet.email, 50, y); y += 12; }

  // --- Owner ---
  let yRight = top;
  label('Owner', 320, yRight);
  yRight += 14;
  doc.fontSize(12).fillColor(INK).text(job.client_name, 320, yRight, { width: 225 });
  yRight += 17;
  doc.fontSize(9).fillColor(INK_SOFT);
  if (job.client_phone) { doc.text(job.client_phone, 320, yRight); yRight += 12; }
  if (job.client_email) { doc.text(job.client_email, 320, yRight, { width: 225 }); yRight += 12; }
  if (job.address) { doc.text(job.address, 320, yRight, { width: 225 }); yRight += 22; }

  y = Math.max(y, yRight) + 12;
  doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 16;

  // --- Animal ---
  label(
    petCount > 1 ? `Animal (${petIndex} of ${petCount})` : 'Animal',
    50, y
  );
  y += 14;
  doc.fontSize(12).fillColor(INK).text(subject.name || '—', 50, y);
  y += 17;
  doc.fontSize(9).fillColor(INK_SOFT).text(
    [subject.species, subject.breed, subject.age, subject.weight].filter(Boolean).join('  ·  ') || '—',
    50, y, { width: 495 }
  );
  y += 20;

  doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 16;

  // --- The wording actually agreed to ---
  // Stored/rendered verbatim: a consent form that paraphrases what was
  // shown is worth very little if the consent is ever disputed.
  label('Consent given', 50, y);
  y += 14;
  doc.fontSize(10).fillColor(INK).text(consentText || '', 50, y, { width: 495, align: 'left' });
  y = doc.y + 20;

  // Keep the signature block together rather than orphaning it.
  if (y > 620) {
    doc.addPage();
    y = 60;
  }

  doc.moveTo(50, y).lineTo(545, y).strokeColor(LINE).lineWidth(1).stroke();
  y += 16;

  label('Signature', 50, y);
  y += 14;

  if (signatureImage) {
    try {
      doc.image(signatureImage, 50, y, { fit: [220, 80] });
    } catch {
      // A corrupt image must not stop the document generating — the
      // typed name and timestamp below still evidence the consent.
      doc.fontSize(9).fillColor(INK_SOFT).text('[signature image could not be rendered]', 50, y);
    }
    y += 88;
  } else {
    doc.fontSize(9).fillColor(INK_SOFT).text('No drawn signature was captured.', 50, y);
    y += 20;
  }

  doc.fontSize(11).fillColor(INK).text(
    subject.consent_signature_name || job.consent_signature_name || '', 50, y
  );
  y += 15;
  doc.fontSize(9).fillColor(INK_SOFT).text(
    `Signed electronically on ${formatDate(job.consent_signed_at)}`
    + `${job.consent_signed_at ? ` at ${new Date(job.consent_signed_at).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Melbourne' })}` : ''}`,
    50, y
  );

  drawFooter(doc, {
    company,
    legalText:
      'This consent was given electronically by the owner named above via a secure link issued for '
      + 'this booking. A copy has been provided to the owner, the attending veterinarian and the practice.',
  });
}

export function generateConsentPdf({ res, job, vet, company, consentText, signatureImage, pet, petIndex, petCount }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  drawConsent(doc, { job, vet, company, consentText, signatureImage, pet, petIndex, petCount });
  doc.end();
}

export function generateConsentPdfBuffer({ job, vet, company, consentText, signatureImage, pet, petIndex, petCount }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    drawConsent(doc, { job, vet, company, consentText, signatureImage, pet, petIndex, petCount });
    doc.end();
  });
}

export function consentFilename(job, pet) {
  // Named after the SPECIFIC animal. Three files all called
  // "Consent-Bella-GM-0042.pdf" overwrite each other in a downloads
  // folder, so two of the three records simply vanish.
  const name = (pet?.name || job.pet_name || 'pet').replace(/[^a-zA-Z0-9]+/g, '-');
  return `Consent-${name}-${job.job_number}.pdf`;
}
