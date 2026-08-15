import nodemailer from 'nodemailer';

// Standard SMTP (port 465 = implicit TLS) — works for any regular
// mailbox, not tied to a specific provider like Gmail/Outlook.
// Requires EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_USER, EMAIL_PASSWORD.

let transporter = null;

export function isEmailConfigured() {
  return !!(process.env.EMAIL_SMTP_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASSWORD);
}

function getTransporter() {
  if (transporter) return transporter;
  if (!isEmailConfigured()) {
    throw new Error('Email is not configured — set EMAIL_SMTP_HOST, EMAIL_SMTP_PORT, EMAIL_USER, EMAIL_PASSWORD.');
  }
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_SMTP_HOST,
    port: Number(process.env.EMAIL_SMTP_PORT || 465),
    secure: Number(process.env.EMAIL_SMTP_PORT || 465) === 465, // true = implicit TLS
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
  return transporter;
}

// attachments: [{ filename, content: Buffer }]
export async function sendEmail({ to, subject, text, html, attachments }) {
  const t = getTransporter();
  return t.sendMail({
    from: `"Goodbye Mate" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html,
    attachments,
  });
}
