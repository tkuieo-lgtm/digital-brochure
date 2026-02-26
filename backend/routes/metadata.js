import { Router } from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { scanPdfForQR, scanPageRoi } from '../services/qrScanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const storageDir = join(__dirname, '..', 'storage');

const router = Router();

function loadMeta(id) {
  const p = join(storageDir, 'metadata', `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

function saveMeta(meta) {
  writeFileSync(
    join(storageDir, 'metadata', `${meta.id}.json`),
    JSON.stringify(meta, null, 2)
  );
}

// GET /api/metadata/:id  – full metadata
router.get('/:id', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });
  res.json(meta);
});

// PUT /api/metadata/:id  – replace full metadata (TOC, hotspots, qrCodes)
router.put('/:id', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const { toc, qrCodes, hotspots, qrScanned, pageCount, coverPage } = req.body;
  if (toc !== undefined) meta.toc = toc;
  if (qrCodes !== undefined) meta.qrCodes = qrCodes;
  if (hotspots !== undefined) meta.hotspots = hotspots;
  if (qrScanned !== undefined) meta.qrScanned = qrScanned;
  if (pageCount !== undefined) meta.pageCount = pageCount;
  if (coverPage !== undefined) meta.coverPage = coverPage;
  meta.updatedAt = new Date().toISOString();

  saveMeta(meta);
  res.json(meta);
});

// POST /api/metadata/:id/qr-scan  – save QR scan results (run from frontend)
// body: { qrCodes: [{ page, url, location }] }
router.post('/:id/qr-scan', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const incoming = (req.body.qrCodes || []).map(qr => ({
    id: uuidv4(),
    page: qr.page,
    url: qr.url,
    originalUrl: qr.url,
    location: qr.location, // { x, y, w, h } normalized 0-1
  }));

  // Merge: keep overrides for existing QR on same page, add new ones
  const existing = meta.qrCodes.reduce((acc, q) => {
    acc[q.page] = q;
    return acc;
  }, {});

  meta.qrCodes = incoming.map(qr => ({
    ...qr,
    url: existing[qr.page]?.url ?? qr.url, // preserve manual URL override
  }));

  meta.qrScanned = true;
  meta.updatedAt = new Date().toISOString();

  saveMeta(meta);
  res.json(meta);
});

// PUT /api/metadata/:id/qr/:qrId  – update a single QR URL
router.put('/:id/qr/:qrId', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const qr = meta.qrCodes.find(q => q.id === req.params.qrId);
  if (!qr) return res.status(404).json({ error: 'QR not found' });

  if (req.body.url !== undefined) qr.url = req.body.url;
  meta.updatedAt = new Date().toISOString();

  saveMeta(meta);
  res.json(meta);
});

// PATCH /api/metadata/:id/qr/:qrId  – override URL + generate scannable QR image
// body: { url }
// response: updated qr object (with overrideUrl + overrideImageUrl)
router.patch('/:id/qr/:qrId', async (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const qr = meta.qrCodes.find(q => q.id === req.params.qrId);
  if (!qr) return res.status(404).json({ error: 'QR not found' });

  const newUrl = (req.body.url || '').trim();
  if (!newUrl) return res.status(400).json({ error: 'url is required' });

  // Generate a high-resolution QR code image (512 px, error level H for robustness)
  const overrideDir = join(storageDir, 'qr_overrides', req.params.id);
  mkdirSync(overrideDir, { recursive: true });
  const imgFilename = `${req.params.qrId}.png`;
  const imgPath     = join(overrideDir, imgFilename);

  const buf = await QRCode.toBuffer(newUrl, {
    type:                   'png',
    width:                  512,
    margin:                 2,
    errorCorrectionLevel:   'H',
    color:                  { dark: '#000000', light: '#ffffff' },
  });
  writeFileSync(imgPath, buf);

  qr.url              = newUrl;
  qr.overrideUrl      = newUrl;
  qr.overrideImageUrl = `/storage/qr_overrides/${req.params.id}/${imgFilename}`;
  meta.updatedAt = new Date().toISOString();
  saveMeta(meta);

  res.json({ qr, qrCodes: meta.qrCodes });
});

// DELETE /api/metadata/:id/qr/:qrId
router.delete('/:id/qr/:qrId', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });
  meta.qrCodes = meta.qrCodes.filter(q => q.id !== req.params.qrId);
  meta.updatedAt = new Date().toISOString();
  saveMeta(meta);
  res.json(meta);
});

// POST /api/metadata/:id/hotspots  – add a hotspot
router.post('/:id/hotspots', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const hs = {
    id: uuidv4(),
    page: req.body.page,
    label: req.body.label || 'Hotspot',
    action: req.body.action, // { type: 'page'|'url', value: string }
    location: req.body.location, // { x, y, w, h } normalized
  };
  meta.hotspots.push(hs);
  meta.updatedAt = new Date().toISOString();
  saveMeta(meta);
  res.status(201).json(hs);
});

// PUT /api/metadata/:id/hotspots/:hsId  – update a hotspot
router.put('/:id/hotspots/:hsId', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const idx = meta.hotspots.findIndex(h => h.id === req.params.hsId);
  if (idx === -1) return res.status(404).json({ error: 'Hotspot not found' });

  meta.hotspots[idx] = { ...meta.hotspots[idx], ...req.body, id: req.params.hsId };
  meta.updatedAt = new Date().toISOString();
  saveMeta(meta);
  res.json(meta.hotspots[idx]);
});

// DELETE /api/metadata/:id/hotspots/:hsId
router.delete('/:id/hotspots/:hsId', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });
  meta.hotspots = meta.hotspots.filter(h => h.id !== req.params.hsId);
  meta.updatedAt = new Date().toISOString();
  saveMeta(meta);
  res.json({ ok: true });
});

// POST /api/metadata/:id/qr-rescan  – trigger server-side QR scan (blocking)
router.post('/:id/qr-rescan', async (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const pdfPath = join(storageDir, 'pdfs', meta.filename);
  if (!existsSync(pdfPath)) return res.status(404).json({ error: 'PDF file not found' });

  // Run scan (blocking so the response includes results)
  const found = await scanPdfForQR(pdfPath);

  // Preserve any manual URL overrides the admin already made
  const overrides = meta.qrCodes.reduce((acc, q) => {
    if (q.url !== q.originalUrl) acc[q.page] = q.url;
    return acc;
  }, {});

  meta.qrCodes = found.map(qr => ({
    id:          uuidv4(),
    page:        qr.page,
    url:         overrides[qr.page] ?? qr.url,
    originalUrl: qr.url,
    format:      qr.format,
    location:    qr.location,
  }));
  meta.qrScanned  = true;
  meta.updatedAt  = new Date().toISOString();
  saveMeta(meta);

  res.json(meta);
});

// POST /api/metadata/:id/qr-scan-roi  – manual assist: scan a specific page region
// body: { page, roi: {x,y,w,h}, scale? }
// response: { found, qr?, qrCodes }
router.post('/:id/qr-scan-roi', async (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const pdfPath = join(storageDir, 'pdfs', meta.filename);
  if (!existsSync(pdfPath)) return res.status(404).json({ error: 'PDF file not found' });

  const { page, roi, scale } = req.body;
  if (!page || !roi) return res.status(400).json({ error: 'page and roi are required' });

  const { result: found, debug } = await scanPageRoi(pdfPath, Number(page), roi, scale || 5);

  if (!found) {
    return res.json({ found: false, qrCodes: meta.qrCodes, debug });
  }

  // Add to metadata (avoid exact duplicate on same page with same url)
  const isDupe = meta.qrCodes.some(q => q.page === Number(page) && q.url === found.url);
  if (!isDupe) {
    meta.qrCodes.push({
      id:          uuidv4(),
      page:        Number(page),
      url:         found.url,
      originalUrl: found.url,
      format:      found.format,
      location:    found.location,
      source:      'manual',
    });
    meta.updatedAt = new Date().toISOString();
    saveMeta(meta);
  }

  res.json({ found: true, qr: found, qrCodes: meta.qrCodes, debug });
});

// PUT /api/metadata/:id/toc  – replace TOC
router.put('/:id/toc', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });
  meta.toc = req.body.toc || [];
  meta.updatedAt = new Date().toISOString();
  saveMeta(meta);
  res.json(meta);
});

// GET /api/metadata/:id/export.csv  – export QR codes as CSV
router.get('/:id/export.csv', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });

  const rows = [
    ['Page', 'Current URL', 'Original URL', 'Position X', 'Position Y', 'Width', 'Height'],
    ...meta.qrCodes.map(qr => [
      qr.page,
      qr.url,
      qr.originalUrl || qr.url,
      (qr.location?.x ?? '').toFixed ? qr.location.x.toFixed(4) : '',
      (qr.location?.y ?? '').toFixed ? qr.location.y.toFixed(4) : '',
      (qr.location?.w ?? '').toFixed ? qr.location.w.toFixed(4) : '',
      (qr.location?.h ?? '').toFixed ? qr.location.h.toFixed(4) : '',
    ]),
  ];

  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${meta.id}-qr-codes.csv"`);
  res.send(csv);
});

// ── Appearance (per-brochure theme / background config) ──────────────────────

// GET /api/metadata/:id/appearance
router.get('/:id/appearance', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });
  res.json(meta.appearance ?? { mode: 'auto' });
});

// PUT /api/metadata/:id/appearance
router.put('/:id/appearance', (req, res) => {
  const meta = loadMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: 'Not found' });
  meta.appearance = req.body;
  meta.updatedAt  = new Date().toISOString();
  saveMeta(meta);
  res.json(meta.appearance);
});

export default router;
