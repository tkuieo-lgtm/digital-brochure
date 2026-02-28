import { Router } from 'express';
import multer from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { scanPdfForQR } from '../services/qrScanner.js';
import * as storage from '../lib/storage.js';

const router = Router();

// ── Multer: memory storage (buffers go to Supabase, not disk) ─────────────

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter(_req, file, cb) {
    cb(null, file.mimetype === 'application/pdf');
  },
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
});

const bgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) =>
    cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
});

// ── Helpers ───────────────────────────────────────────────────────────────

function withPdfUrl(meta) {
  return { ...meta, pdfUrl: storage.getPublicUrl('pdfs', meta.filename) };
}

// ── Metadata helpers ──────────────────────────────────────────────────────

async function loadMeta(id) {
  const buf = await storage.download('metadata', `${id}.json`);
  if (!buf) return null;
  return JSON.parse(buf.toString('utf8'));
}

async function saveMeta(meta) {
  const buf = Buffer.from(JSON.stringify(meta, null, 2));
  await storage.upload('metadata', `${meta.id}.json`, buf, 'application/json');
}

async function listAll() {
  const files = await storage.list('metadata', '');
  const jsonFiles = files.filter(f => f.name?.endsWith('.json'));
  const metas = await Promise.all(
    jsonFiles.map(async (f) => {
      try {
        const buf = await storage.download('metadata', f.name);
        if (!buf) return null;
        return JSON.parse(buf.toString('utf8'));
      } catch { return null; }
    })
  );
  return metas
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(withPdfUrl);
}

// ── Routes ────────────────────────────────────────────────────────────────

// GET /api/brochures
router.get('/', async (_req, res) => {
  try {
    res.json(await listAll());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/brochures/:id
router.get('/:id', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });
    res.json(withPdfUrl(meta));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/brochures  (multipart: pdf file + title + description)
router.post('/', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });

  try {
    const id       = uuidv4();
    const ext      = extname(req.file.originalname) || '.pdf';
    const filename = id + ext;
    const now      = new Date().toISOString();

    // Upload PDF to Supabase
    await storage.upload('pdfs', filename, req.file.buffer, 'application/pdf');

    const meta = {
      id,
      title:            req.body.title || req.file.originalname.replace(/\.pdf$/i, ''),
      description:      req.body.description || '',
      filename,
      originalFilename: req.file.originalname,
      fileSize:         req.file.size,
      pageCount:        0,        // updated by frontend after PDF loads
      createdAt:        now,
      updatedAt:        now,
      coverPage:        1,
      toc:              [],
      qrCodes:          [],       // [{ id, page, url, originalUrl, location }]
      hotspots:         [],       // [{ id, page, label, action, location }]
      qrScanned:        false,
    };

    await saveMeta(meta);
    res.status(201).json(withPdfUrl(meta));

    // Kick off QR scan in background (non-blocking — response already sent).
    // Capture the buffer now; the multer object may be GC'd later.
    const pdfBuffer = req.file.buffer;
    scanPdfForQR(pdfBuffer).then(async (found) => {
      if (!found.length) return;
      const fresh = await loadMeta(id);
      if (!fresh) return;
      fresh.qrCodes = found.map(qr => ({
        id:          uuidv4(),
        page:        qr.page,
        url:         qr.url,
        originalUrl: qr.url,
        format:      qr.format,
        location:    qr.location,
      }));
      fresh.qrScanned = true;
      fresh.updatedAt = new Date().toISOString();
      await saveMeta(fresh);
      console.log(`[QR] found ${found.length} QR code(s) in ${filename}`);
    }).catch(e => console.error('[QR] background scan error:', e.message));

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/brochures/:id  (update title / description / coverPage / pageCount)
router.put('/:id', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });

    const { title, description, coverPage, pageCount } = req.body;
    if (title       !== undefined) meta.title       = title;
    if (description !== undefined) meta.description = description;
    if (coverPage   !== undefined) meta.coverPage   = coverPage;
    if (pageCount   !== undefined) meta.pageCount   = pageCount;
    meta.updatedAt = new Date().toISOString();

    await saveMeta(meta);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/brochures/:id
router.delete('/:id', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });

    // Best-effort: remove PDF then metadata
    try { await storage.remove('pdfs', meta.filename); } catch { /* ok if missing */ }
    await storage.remove('metadata', `${req.params.id}.json`);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Background image upload ───────────────────────────────────────────────

// POST /api/brochures/:id/background
router.post('/:id/background', bgUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image uploaded' });

  try {
    const ext      = extname(req.file.originalname) || '.jpg';
    const filename = `bg_${Date.now()}${ext}`;
    const path     = `${req.params.id}/${filename}`;

    await storage.upload('backgrounds', path, req.file.buffer, req.file.mimetype);

    res.json({ url: storage.getPublicUrl('backgrounds', path) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
