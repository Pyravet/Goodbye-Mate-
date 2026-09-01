import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import partnerInvoicesRouter from './routes/partnerInvoices.js';
import clinicsRouter from './routes/clinics.js';
import qolRouter from './routes/qol.js';
import healthRoutes from './routes/health.js';
import vetsRoutes from './routes/vets.js';
import messagesRoutes from './routes/messages.js';
import settingsRoutes from './routes/settings.js';
import jobsRoutes from './routes/jobs.js';
import pushRoutes from './routes/push.js';
import auditRoutes from './routes/audit.js';
import publicJourneyRoutes from './routes/publicJourney.js';
import payoutRoutes from './routes/payouts.js';
import conversationRoutes from './routes/conversations.js';
import notificationRoutes from './routes/notifications.js';
import bookingRequestRoutes from './routes/bookingRequests.js';
import exportRoutes from './routes/exports.js';
import { startDispatchWorker } from './workers/dispatchWorker.js';
import { startReminderWorker, startReviewReminderWorker } from './workers/reminderWorker.js';
import { seedTestVet } from './db/seed-test-vet.js';
import { closePool } from './db/pool.js';
import { alertServerError, alertCrash } from './monitoring/alerts.js';

const app = express();

// Safety net: if something still slips through an unwrapped promise
// somewhere, log it instead of letting Node silently kill the process
// (or hang forever) on an unhandled rejection.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
  // Never suppressed: the process is in an unknown state.
  alertCrash('Unhandled promise rejection', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  alertCrash('Uncaught exception', err);
});

app.set('trust proxy', 1); // needed for correct req.ip behind Vercel/hosting proxies

app.use(helmet());
// CORS allowlist. A missing origin here is a genuinely nasty failure
// mode: the browser blocks the request BEFORE it reaches the server, so
// nothing appears in the server logs at all. The symptom is usually
// "signed out on refresh" — the silent refresh call is blocked, the app
// concludes the session is dead, and logs the user out. The rejection
// log below exists so this shows up in Railway logs instead of being
// invisible.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // No origin = same-origin, curl, or a server-to-server call.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`CORS: rejected origin "${origin}". Add it to CORS_ORIGIN if this is one of ours. Currently allowed: ${allowedOrigins.join(', ')}`);
    return callback(null, false);
  },
  credentials: true, // required so the refresh-token cookie is sent/received
}));
// Body parsing. The brochure-upload route carries a base64-encoded PDF,
// which is far bigger than any other payload here (and base64 inflates
// by ~33%), so it gets its own higher limit. This MUST come before the
// global 1mb parser below — whichever json() parser runs first consumes
// the stream, so a route-level parser mounted later never gets a chance
// and the upload just fails with 413 Payload Too Large.
app.use('/api/settings/content/brochure', express.json({ limit: '20mb' }));
// Consent submissions carry a drawn signature PNG as a data URI, which
// can exceed the global 1mb limit. Same ordering rule as above: this
// must be mounted before the global parser or it never runs.
app.use('/api/public/journey', express.json({ limit: '8mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Blanket API rate limit as a baseline; specific endpoints (like /auth/login)
// layer stricter limits on top of this.
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
}));

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/vets', vetsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/booking-requests', bookingRequestRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/public/journey', publicJourneyRoutes);
app.use('/api/partner-invoices', partnerInvoicesRouter);
app.use('/api/clinics', clinicsRouter);
// Public and unauthenticated: a family should not need an account to
// work out whether their pet is suffering.
app.use('/api/qol', qolRouter);

// 404 for unmatched API routes. Without this, an unknown path falls
// through to Express's HTML error page, which is confusing for an API
// client expecting JSON.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No such endpoint: ${req.method} ${req.originalUrl}` });
});

/**
 * Central error handler.
 *
 * Two rules, in tension, both important:
 *  1. Never leak stack traces, SQL, or driver internals to a client.
 *  2. Don't discard an error a route raised DELIBERATELY. The previous
 *     version replaced every error with a flat "Internal server error",
 *     so a route that threw a considered 409 "job already cancelled"
 *     surfaced to the user as an unexplained 500 — which is what made
 *     several bugs in this app so slow to diagnose.
 *
 * The distinction is `err.expose`/`err.status`: errors carrying an
 * explicit 4xx status are treated as intentional and their message is
 * passed through. Anything else (including all 5xx) is logged in full
 * server-side and reduced to a generic message for the client.
 */
// eslint-disable-next-line no-unused-vars -- Express requires 4 args to
// recognise this as an error handler; `next` must stay in the signature.
app.use((err, req, res, next) => {
  const status = Number(err.status || err.statusCode) || 500;
  const isClientError = status >= 400 && status < 500;

  // Log server errors loudly with context; client errors are expected
  // traffic (bad input, wrong state) and would drown the logs.
  if (!isClientError) {
    // Redact ?token= before logging. The native app passes a short-lived
    // access token in the query string for PDFs opened in the device
    // browser, so logging the raw URL would write a WORKING bearer token
    // into the platform logs — turning log access into account access.
    const safeUrl = req.originalUrl.replace(/([?&]token=)[^&]*/gi, '$1[REDACTED]');
    console.error(`[${req.method} ${safeUrl}]`, err);

    // Also alert. Logging alone meant the first anyone knew of a failure
    // was a client ringing to say the payment page was broken. The same
    // redacted URL is used, so a bearer token can't reach Slack either.
    alertServerError(err, {
      method: req.method,
      url: safeUrl,
      status,
      userId: req.user?.sub,
    });
  }

  res.status(status).json({
    error: isClientError && err.message ? err.message : 'Internal server error',
  });
});

const port = process.env.PORT || 4000;
const server = app.listen(port, () => {
  console.log(`API listening on :${port}`);
  startDispatchWorker();
  startReminderWorker();
  startReviewReminderWorker();
  seedTestVet().catch((err) => console.error('Test vet seed error:', err.message));
});

/**
 * Graceful shutdown. Railway sends SIGTERM on every redeploy; without
 * this the process is killed mid-request and Postgres connections are
 * left for Neon to time out server-side. Draining first means in-flight
 * requests finish and connections are returned immediately.
 */
async function shutdown(signal) {
  console.log(`${signal} received — shutting down.`);
  server.close(async () => {
    try {
      await closePool();
    } catch (err) {
      console.error('Error closing pool:', err.message);
    }
    process.exit(0);
  });

  // Don't hang forever if a connection refuses to drain.
  setTimeout(() => {
    console.error('Shutdown timed out — forcing exit.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
