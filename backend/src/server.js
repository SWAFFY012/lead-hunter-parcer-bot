import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

// Ensure data dirs exist
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../../data');
['', '/olx-sessions', '/warmup', '/warmup/media'].forEach(sub => {
  const p = DATA_DIR + sub;
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
});

import { getDb, hasDatabaseConfig, runMigrations } from './db/database.js';

// Routes
import accountRoutes from './routes/accounts.js';
import warmupRoutes from './routes/warmup.js';
import parserRoutes from './routes/parser.js';
import leadsRoutes from './routes/leads.js';
import aiRoutes from './routes/ai.js';
import senderRoutes from './routes/sender.js';
import settingsRoutes from './routes/settings.js';
import campaignsRoutes from './routes/campaigns.js';
import profilesRoutes from './routes/profiles.js';
import systemRoutes from './routes/system.js';
import telegramRoutes from './routes/telegram.js';
import googleMapsRoutes from './routes/googleMaps.js';
import yandexMapsRoutes from './routes/yandexMaps.js';
import twoGisMapsRoutes from './routes/twoGisMaps.js';
import savedMapLeadsRoutes from './routes/savedMapLeads.js';

const app = express();
const httpServer = createServer(app);

const corsOptions = {
  origin: true, // Allow all origins for local network access
  credentials: true
};

// Socket.io
export const io = new Server(httpServer, {
  cors: corsOptions
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// Initialize DB and run migrations on startup when configured.
const databaseConfigured = hasDatabaseConfig();
if (databaseConfigured) {
  getDb();
  runMigrations().catch(err => console.error('[Startup] Migration Error:', err));
} else {
  console.warn('[Startup] SUPABASE_DB_URL missing. Database-backed API routes are disabled.');
}

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true, databaseConfigured, ts: Date.now() }));

app.use('/api', (req, res, next) => {
  const worksWithoutDatabase = req.path.startsWith('/telegram')
    || req.path.startsWith('/google-maps')
    || req.path.startsWith('/yandex-maps')
    || req.path.startsWith('/2gis-maps')
    || req.path.startsWith('/saved-map-leads');
  if (!databaseConfigured && !worksWithoutDatabase) {
    return res.status(503).json({
      ok: false,
      error: 'Database is not configured. Set SUPABASE_DB_URL in backend/.env.'
    });
  }
  next();
});

// API Routes
app.use('/api/accounts', accountRoutes);
app.use('/api/warmup', warmupRoutes);
app.use('/api/parser', parserRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/sender', senderRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/profiles', profilesRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/telegram', telegramRoutes);
app.use('/api/google-maps', googleMapsRoutes);
app.use('/api/yandex-maps', yandexMapsRoutes);
app.use('/api/2gis-maps', twoGisMapsRoutes);
app.use('/api/saved-map-leads', savedMapLeadsRoutes);

import { startFollowupManager } from './modules/sender/followupManager.js';

// Socket.io connection
io.on('connection', (socket) => {
  console.log('[WS] Client connected:', socket.id);
  socket.on('disconnect', () => console.log('[WS] Client disconnected:', socket.id));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`[Server] LeadHunter backend running on http://localhost:${PORT}`);
  if (databaseConfigured) startFollowupManager();
});

// Graceful Shutdown on PM2/Electron kill
process.on('SIGTERM', async () => {
  console.log('[Server] SIGTERM received. Shutting down gracefully...');
  // Close the DB
  try {
    const db = getDb();
    await db.end();
  } catch(e) {}
  httpServer.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('[Server] SIGINT received. Shutting down gracefully...');
  try {
    const db = getDb();
    await db.end();
  } catch(e) {}
  httpServer.close(() => {
    process.exit(0);
  });
});
