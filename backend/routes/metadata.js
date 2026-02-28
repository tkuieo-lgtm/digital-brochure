import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import { scanPdfForQR, scanPageRoi } from '../services/qrScanner.js';
import * as storage from '../lib/storage.js';

const router = Router();

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

// ── Routes ────────────────────────────────────────────────────────────────

// GET /api/metadata/:id  – full metadata
router.get('/:id', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/metadata/:id  – replace full metadata (TOC, hotspots, qrCodes)
router.put('/:id', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });

    const { toc, qrCodes, hotspots, qrScanned, pageCount, coverPage } = req.body;
    if (toc       !== undefined) meta.toc       = toc;
    if (qrCodes   !== undefined) meta.qrCodes   = qrCodes;
    if (hotspots  !== undefined) meta.hotspots  = hotspots;
    if (qrScanned !== undefined) meta.qrScanned = qrScanned;
    if (pageCount !== undefined) meta.pageCount = pageCount;
    if (coverPage !== undefined) meta.coverPage = coverPage;
    meta.updatedAt = new Date().toISOString();

    await saveMeta(meta);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/metadata/:id/qr-scan  – save QR scan results (run from frontend)
// body: { qrCodes: [{ page, url, location }] }
router.post('/:id/qr-scan', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });

    const incoming = (req.body.qrCodes || []).map(qr => ({
      id:          uuidv4(),
      page:        qr.page,
      url:         qr.url,
      originalUrl: qr.url,
      location:    qr.location, // { x, y, w, h } normalized 0-1
    }));

    // Merge: keep URL overrides for existing QR on same page, add new ones
    const existing = meta.qrCodes.reduce((acc, q) => {
      acc[q.page] = q;
      return acc;
    }, {});

    meta.qrCodes = incoming.map(qr => ({
      ...qr,
      url: existing[qr.page]?.url ?? qr.url,
    }));

    meta.qrScanned = true;
    meta.updatedAt = new Date().toISOString();

    await saveMeta(meta);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/metadata/:id/qr/:qrId  – update a single QR URL
router.put('/:id/qr/:qrId', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });

    const qr = meta.qrCodes.find(q => q.id === req.params.qrId);
    if (!qr) return res.status(404).json({ error: 'QR not found' });

    if (req.body.url !== undefined) qr.url = req.body.url;
    meta.updatedAt = new Date().toISOString();

    await saveMeta(meta);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/metadata/:id/qr/:qrId  – override URL + generate scannable QR image
// body: { url }
// response: updated qr object (with overrideUrl + overrideImageUrl)
router.patch('/:id/qr/:qrId', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });

    const qr = meta.qrCodes.find(q => q.id === req.params.qrId);
    if (!qr) return res.status(404).json({ error: 'QR not found' });

    const newUrl = (req.body.url || '').trim();
    if (!newUrl) return res.status(400).json({ error: 'url is required' });

    // Generate a high-resolution QR code PNG (512 px, error level H)
    const buf = await QRCode.toBuffer(newUrl, {
      type:                 'png',
      width:                512,
      margin:               2,
      errorCorrectionLevel: 'H',
      color:                { dark: '#000000', light: '#ffffff' },
    });

    const storagePath = `${req.params.id}/${req.params.qrId}.png`;
    await storage.upload('qr-overrides', storagePath, buf, 'image/png');

    qr.url              = newUrl;
    qr.overrideUrl      = newUrl;
    qr.overrideImageUrl = storage.getPublicUrl('qr-overrides', storagePath);
    meta.updatedAt = new Date().toISOString();
    await saveMeta(meta);

    res.json({ qr, qrCodes: meta.qrCodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/metadata/:id/qr/:qrId
router.delete('/:id/qr/:qrId', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });
    meta.qrCodes = meta.qrCodes.filter(q => q.id !== req.params.qrId);
    meta.updatedAt = new Date().toISOString();
    await saveMeta(meta);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/metadata/:id/hotspots  – add a hotspot
router.post('/:id/hotspots', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });

    const hs = {
      id:       uuidv4(),
      page:     req.body.page,
      label:    req.body.label || 'Hotspot',
      action:   req.body.action,   // { type: 'page'|'url', value: string }
      location: req.body.location, // { x, y, w, h } normalized
    };
    meta.hotspots.push(hs);
    meta.updatedAt = new Date().toISOString();
    await saveMeta(meta);
    res.status(201).json(hs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/metadata/:id/hotspots/:hsId  – update a hotspot
router.put('/:id/hotspots/:hsId', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });

    const idx = meta.hotspots.findIndex(h => h.id === req.params.hsId);
    if (idx === -1) return res.status(404).json({ error: 'Hotspot not found' });

    meta.hotspots[idx] = { ...meta.hotspots[idx], ...req.body, id: req.params.hsId };
    meta.updatedAt = new Date().toISOString();
    await saveMeta(meta);
    res.json(meta.hotspots[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/metadata/:id/hotspots/:hsId
router.delete('/:id/hotspots/:hsId', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });
    meta.hotspots = meta.hotspots.filter(h => h.id !== req.params.hsId);
    meta.updatedAt = new Date().toISOString();
    await saveMeta(meta);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/metadata/:id/qr-rescan  – trigger server-side QR scan (blocking)
router.post('/:id/qr-rescan', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });

    const pdfBuffer = await storage.download('pdfs', meta.filename);
    if (!pdfBuffer) return res.status(404).json({ error: 'PDF file not found' });

    const found = await scanPdfForQR(pdfBuffer);

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
    meta.qrScanned = true;
    meta.updatedAt = new Date().toISOString();
    await saveMeta(meta);

    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/metadata/:id/qr-scan-roi  – manual assist: scan a specific page region
// body: { page, roi: {x,y,w,h}, scale? }
// response: { found, qr?, qrCodes }
router.post('/:id/qr-scan-roi', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });

    const pdfBuffer = await storage.download('pdfs', meta.filename);
    if (!pdfBuffer) return res.status(404).json({ error: 'PDF file not found' });

    const { page, roi, scale } = req.body;
    if (!page || !roi) return res.status(400).json({ error: 'page and roi are required' });

    const { result: found, debug } = await scanPageRoi(pdfBuffer, Number(page), roi, scale || 5);

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
      await saveMeta(meta);
    }

    res.json({ found: true, qr: found, qrCodes: meta.qrCodes, debug });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/metadata/:id/toc  – replace TOC
router.put('/:id/toc', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });
    meta.toc = req.body.toc || [];
    meta.updatedAt = new Date().toISOString();
    await saveMeta(meta);
    res.json(meta);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/metadata/:id/export.csv  – export QR codes as CSV
router.get('/:id/export.csv', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Appearance ────────────────────────────────────────────────────────────

// GET /api/metadata/:id/appearance
router.get('/:id/appearance', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });
    res.json(meta.appearance ?? { mode: 'auto' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/metadata/:id/appearance
router.put('/:id/appearance', async (req, res) => {
  try {
    const meta = await loadMeta(req.params.id);
    if (!meta) return res.status(404).json({ error: 'Not found' });
    meta.appearance = req.body;
    meta.updatedAt  = new Date().toISOString();
    await saveMeta(meta);
    res.json(meta.appearance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
