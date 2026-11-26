import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import { securityHeaders } from './middleware/security.js';
import openapiSpec from './docs/openapi.js';

import authRoutes from './routes/auth.routes.js';
import kpiRoutes from './routes/kpi.routes.js';
import sitesRoutes from './routes/sites.routes.js';
import officersRoutes from './routes/officers.routes.js';
import absenceRoutes from './routes/absence.routes.js';
import lateRoutes from './routes/late.routes.js';
import attendanceRoutes from './routes/attendance.routes.js';
import incidentsRoutes from './routes/incidents.routes.js';
import inspectionsRoutes from './routes/inspections.routes.js';
import controlRoomRoutes from './routes/controlroom.routes.js';
import visitsRoutes from './routes/visits.routes.js';
import feedbackRoutes from './routes/feedback.routes.js';
import reportsRoutes from './routes/reports.routes.js';

dotenv.config();

// Fail fast: a missing/short signing secret would make every token forgeable or every login 500.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set to a random value of at least 32 characters');
}

const app = express();

// Behind the shared Nginx every request arrives from the proxy's address. Without this the login
// rate limit would count all users as one client and lock everyone out together. Set TRUST_PROXY to
// the number of proxies in front of the app (1 on the DOK server); leave it unset when none.
if (process.env.TRUST_PROXY) {
  const hops = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isInteger(hops) && hops > 0 ? hops : false);
}

// Security & Middleware Setup
app.use(securityHeaders);
// Reflecting every origin (origin: true) plus credentials:true is a known anti-pattern —
// this app authenticates with a Bearer token, not cookies, so credentials aren't needed
// and the allowed origin is restricted to the configured frontend URL(s).
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Interactive API documentation (Swagger UI) and the raw OpenAPI file. On by default; set
// DOCS_ENABLED=false to switch it off. It is public: it describes the API but exposes no data.
if (process.env.DOCS_ENABLED !== 'false') {
  app.get('/api/openapi.json', (req, res) => res.json(openapiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'ISOMS API',
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha' }
  }));
}

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/kpis', kpiRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/officers', officersRoutes);
app.use('/api/absence', absenceRoutes);
app.use('/api/late', lateRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/incidents', incidentsRoutes);
app.use('/api/inspections', inspectionsRoutes);
app.use('/api/control-room', controlRoomRoutes);
app.use('/api/visits', visitsRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/reports', reportsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'HEALTHY',
    system: 'AB Securitas ISOMS REST API',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Global Error Handler — internal error detail is logged server-side only; the client
// never sees stack traces or raw DB/driver error text, which can leak schema/internals.
app.use((err, req, res, next) => {
  console.error('[Unhandled Express Error]:', err.stack);
  const isDev = process.env.NODE_ENV === 'development';
  res.status(500).json({
    error: 'Internal Server Error',
    ...(isDev ? { message: err.message } : {})
  });
});

export default app;
