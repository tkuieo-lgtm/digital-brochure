import { Router } from 'express';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import {
  readdirSync, readFileSync, writeFileSync,
  unlinkSync, existsSync, mkdirSync
} from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { scanPdfForQR } from '../services/qrScanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const storageDir = join(__dirname, '..', 'storage');

// Multer config: store PDFs with a UUID filename
const storage = multer.diskStorage({
  destination: join(storageDir, 'pdfs'),
  filename(_req, file, cb) {
    const ext = extname(file.originalname) || '.pdf';
    cb(null, uuidv4() + ext);
  },
});
const upload = multer({
  storage,
  fileFilter(_req, file, cb) {
    cb(null, file.mimetype === 'application/pdf');
  },
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

const router = Router();

// Helper: load metadata JSON for a brochure
function loadMeta(id) {
  const p = join(storageDir, 'metadata', `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Helper: save metadata JSON
function saveMeta(meta) {
  mkdirSync(join(storageDir, 'metadata'), { recursive: true });
  writeFileSync(
    join(storageDir, 'metadata', `${meta.id}.json`),
    JSON.stringify(meta, null, 2)
  );
}

// Helper: list all metadata files
function listAll() {
  const dir = join(storageDir, 'metadata');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// GET /api/brochures
router.get('/', (_req, res) => {
  res.json(listAll());
});

// GET /api/brochures/:id
router.get('/:id', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });
  res.json(meta);
});

// POST /api/brochures  (multipart: pdf file + title + description)
router.post('/', upload.single('pdf'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

  const id = req.file.filename.replace(/\.[^.]+$/, ''); // UUID without extension
  const now = new Date().toISOString();

  const meta = {
    id,
    title: req.body.title || req.file.originalname.replace(/\.pdf$/i, ''),
    description: req.body.description || '',
    filename: req.file.filename,
    originalFilename: req.file.originalname,
    fileSize: req.file.size,
    pageCount: 0,          // updated by frontend after PDF loads
    createdAt: now,
    updatedAt: now,
    coverPage: 1,
    toc: [],
    qrCodes: [],           // [{ id, page, url, originalUrl, location: {x,y,w,h} (normalized) }]
    hotspots: [],          // [{ id, page, label, action: {type,value}, location }]
    qrScanned: false,
  };

  saveMeta(meta);
  res.status(201).json(meta);

  // Kick off QR scan in background (non-blocking – response already sent)
  const pdfPath = join(storageDir, 'pdfs', meta.filename);
  scanPdfForQR(pdfPath).then(found => {
    if (!found.length) return;
    const fresh = loadMeta(id);
    if (!fresh) return;
    fresh.qrCodes = found.map(qr => ({
      id:          uuidv4(),
      page:        qr.page,
      url:         qr.url,
      originalUrl: qr.url,
      format:      qr.format,
      location:    qr.location,
    }));
    fresh.qrScanned  = true;
    fresh.updatedAt  = new Date().toISOString();
    saveMeta(fresh);
    console.log(`[QR] found ${found.length} QR code(s) in ${meta.filename}`);
  }).catch(e => console.error('[QR] background scan error:', e.message));
});

// PUT /api/brochures/:id  (update title / description / coverPage / pageCount)
router.put('/:id', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const { title, description, coverPage, pageCount } = req.body;
  if (title !== undefined) meta.title = title;
  if (description !== undefined) meta.description = description;
  if (coverPage !== undefined) meta.coverPage = coverPage;
  if (pageCount !== undefined) meta.pageCount = pageCount;
  meta.updatedAt = new Date().toISOString();

  saveMeta(meta);
  res.json(meta);
});

// DELETE /api/brochures/:id
router.delete('/:id', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  // Delete PDF file
  const pdfPath = join(storageDir, 'pdfs', meta.filename);
  if (existsSync(pdfPath)) unlinkSync(pdfPath);

  // Delete metadata
  unlinkSync(join(storageDir, 'metadata', `${req.params.id}.json`));

  res.json({ ok: true });
});

// ── Background image upload ───────────────────────────────────────────────────
const bgStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = join(storageDir, 'backgrounds', req.params.id);
    mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, `bg_${Date.now()}${extname(file.originalname) || '.jpg'}`);
  },
});
const bgUpload = multer({
  storage: bgStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) =>
    cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
});

// POST /api/brochures/:id/background
router.post('/:id/background', bgUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
  res.json({ url: `/storage/backgrounds/${req.params.id}/${req.file.filename}` });
});

export default router;
