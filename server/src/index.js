import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import healthRoutes from './routes/health.js';
import exampleProtectedRoutes from './routes/example-protected.js';
import vetsRoutes from './routes/vets.js';
import messagesRoutes from './routes/messages.js';
import settingsRoutes from './routes/settings.js';
import jobsRoutes from './routes/jobs.js';
import pushRoutes from './routes/push.js';
import { startDispatchWorker } from './workers/dispatchWorker.js';

const app = express();

app.set('trust proxy', 1); // needed for correct req.ip behind Vercel/hosting proxies

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || 'http://localhost:5173',
  credentials: true, // required so the refresh-token cookie is sent/received
}));
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
app.use('/api', exampleProtectedRoutes);
app.use('/api/vets', vetsRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/push', pushRoutes);

// Central error handler — never leak stack traces to the client.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`API listening on :${port}`);
  startDispatchWorker();
});
