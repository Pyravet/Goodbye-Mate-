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

/**
 * Verify the SMTP connection and credentials WITHOUT sending anything.
 *
 * Email failures have been the hardest thing to diagnose in this project
 * because a send is fire-and-forget from a route — the real SMTP error
 * never reaches anyone. This performs the handshake and login only, and
 * returns the actual provider error, so a wrong password or blocked port
 * says so plainly instead of surfacing as "no email arrived".
 */
export async function verifyEmailConnection() {
  if (!isEmailConfigured()) {
    return {
      ok: false,
      error: 'Email is not configured. Set EMAIL_SMTP_HOST, EMAIL_USER and EMAIL_PASSWORD.',
    };
  }
  try {
    await getTransporter().verify();
    return {
      ok: true,
      host: process.env.EMAIL_SMTP_HOST,
      port: Number(process.env.EMAIL_SMTP_PORT || 465),
      user: process.env.EMAIL_USER,
    };
  } catch (err) {
    return {
      ok: false,
      // The provider's own message is the useful part — e.g.
      // "Invalid login: 535 Authentication failed".
      error: err.message,
      code: err.code || null,
      host: process.env.EMAIL_SMTP_HOST,
      port: Number(process.env.EMAIL_SMTP_PORT || 465),
      user: process.env.EMAIL_USER,
    };
  }
}

// attachments: [{ filename, content: Buffer }]
export async function sendEmail({ to, subject, text, html, attachments }) {
  const t = getTransporter();
  return t.sendMail({
    from: process.env.EMAIL_FROM || `"Goodbye Mate" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
    html,
    attachments,
  });
}
