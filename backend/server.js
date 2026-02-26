import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

import brochuresRouter from './routes/brochures.js';
import metadataRouter from './routes/metadata.js';
import analyticsRouter from './routes/analytics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure storage directories exist
const storageDir = join(__dirname, 'storage');
['pdfs', 'metadata', 'qr_overrides', 'backgrounds', 'analytics'].forEach((d) =>
  mkdirSync(join(storageDir, d), { recursive: true })
);

const app = express();

// CORS (allow all origins for now; we can tighten later)
app.use(cors());

app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));

// Serve uploaded PDFs, QR override images, and custom background images
app.use('/storage/pdfs', express.static(join(storageDir, 'pdfs')));
app.use('/storage/qr_overrides', express.static(join(storageDir, 'qr_overrides')));
app.use('/storage/backgrounds', express.static(join(storageDir, 'backgrounds')));

// API routes
app.use('/api/brochures', brochuresRouter);
app.use('/api/metadata', metadataRouter);
app.use('/api/analytics', analyticsRouter);

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// Serve frontend (Vite build output)
const frontendDist = join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(frontendDist));

// SPA fallback: any non-API/non-storage route -> index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/storage')) {
    return res.status(404).send('Not found');
  }
  return res.sendFile(join(frontendDist, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});