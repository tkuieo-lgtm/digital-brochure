/**
 * Server-side barcode scanner — XObject-first, multi-stage fallback.
 *
 * Primary strategy: extract raw image XObjects from the PDF via the operator
 * list + objs store. This bypasses pdfjs bilinear interpolation that blurs
 * small QR modules and makes them undecodable when rendered normally.
 *
 * Fallback: multi-stage page rendering (scale=3, scale=5, 4 tiles).
 *
 * scanPdfForQR(pdfPath)          – scan all pages (auto)
 * scanPageRoi(pdfPath, pg, roi)  – scan a specific ROI (manual assist)
 *                                  returns { result, debug }
 */
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEBUG_DIR  = join(__dirname, '..', 'storage', 'debug');

let pdfjs                    = null;
let createCanvas             = null;
let ImageDataCtor            = null;
let jsQR                     = null;
let readBarcodesFromImageData = null;

async function loadDeps() {
  if (pdfjs) return true;
  try {
    const [pdfjsMod, canvasMod, jsqrMod, zxingMod] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('@napi-rs/canvas'),
      import('jsqr'),
      import('zxing-wasm/reader'),
    ]);

    ImageDataCtor              = canvasMod.ImageData;
    global.ImageData           = ImageDataCtor;

    pdfjs                      = pdfjsMod;
    createCanvas               = canvasMod.createCanvas;
    jsQR                       = jsqrMod.default ?? jsqrMod;
    readBarcodesFromImageData  = zxingMod.readBarcodesFromImageData;
    return true;
  } catch (err) {
    console.warn('[QR Scanner] deps unavailable:', err.message);
    return false;
  }
}

// ── Format filter ──────────────────────────────────────────────────────────
const MATRIX_FORMATS = new Set([
  'QRCode', 'MicroQRCode', 'rMQRCode', 'DataMatrix', 'Aztec', 'PDF417',
]);

// ── Preprocessing ──────────────────────────────────────────────────────────
function toGrayscale(imgData) {
  const src = imgData.data;
  const dst = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const g = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0;
    dst[i] = dst[i + 1] = dst[i + 2] = g;
    dst[i + 3] = src[i + 3];
  }
  return new ImageDataCtor(dst, imgData.width, imgData.height);
}

// ── Coordinate helpers ─────────────────────────────────────────────────────
function jsqrToNorm(code, w, h) {
  const { topLeftCorner: tl, topRightCorner: tr,
          bottomLeftCorner: bl, bottomRightCorner: br } = code.location;
  const xs = [tl.x, tr.x, bl.x, br.x];
  const ys = [tl.y, tr.y, bl.y, br.y];
  const x  = Math.max(0, Math.min(...xs) / w);
  const y  = Math.max(0, Math.min(...ys) / h);
  const x2 = Math.min(1, Math.max(...xs) / w);
  const y2 = Math.min(1, Math.max(...ys) / h);
  return { x, y, w: x2 - x, h: y2 - y };
}

function zxingToNorm(code, w, h) {
  const { topLeft: tl, topRight: tr, bottomLeft: bl, bottomRight: br } = code.position;
  const xs = [tl.x, tr.x, bl.x, br.x];
  const ys = [tl.y, tr.y, bl.y, br.y];
  const x  = Math.max(0, Math.min(...xs) / w);
  const y  = Math.max(0, Math.min(...ys) / h);
  const x2 = Math.min(1, Math.max(...xs) / w);
  const y2 = Math.min(1, Math.max(...ys) / h);
  return { x, y, w: x2 - x, h: y2 - y };
}

// ── Core decode ────────────────────────────────────────────────────────────
/** Returns { url, format, location } or null. */
async function tryDecode(imgData, w, h) {
  // 1. jsqr — QR only, handles inversion internally
  const code = jsQR(imgData.data, w, h, { inversionAttempts: 'attemptBoth' });
  if (code?.data?.trim()) {
    return { url: code.data, format: 'QRCode', location: jsqrToNorm(code, w, h) };
  }

  // 2. zxing — all 2D formats (tryHarder + tryRotate + tryInvert on by default)
  const codes  = await readBarcodesFromImageData(imgData);
  const matrix = codes.filter(c => c.isValid && MATRIX_FORMATS.has(c.format) && c.text?.trim());
  if (matrix.length > 0) {
    const c = matrix[0];
    return {
      url:      c.text,
      format:   c.format,
      location: c.position ? zxingToNorm(c, w, h) : { x: 0, y: 0, w: 1, h: 1 },
    };
  }

  // 3. jsqr on grayscale (helps colour / low-contrast images)
  const gray     = toGrayscale(imgData);
  const codeGray = jsQR(gray.data, w, h, { inversionAttempts: 'attemptBoth' });
  if (codeGray?.data?.trim()) {
    return { url: codeGray.data, format: 'QRCode', location: jsqrToNorm(codeGray, w, h) };
  }

  return null;
}

// ── PDF helpers ────────────────────────────────────────────────────────────
async function openPdf(pdfPath) {
  const data = new Uint8Array(await readFile(pdfPath));
  return pdfjs.getDocument({
    data,
    verbosity:       0,
    useWorkerFetch:  false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
}

/**
 * Render one PDF page.
 * Always fills white background first to avoid transparent-pixel artifacts.
 * Returns { canvas, ctx, w, h }.
 */
async function renderPage(pdf, pageNum, scale) {
  const page     = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const w        = Math.ceil(viewport.width);
  const h        = Math.ceil(viewport.height);
  const canvas   = createCanvas(w, h);
  const ctx      = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return { canvas, ctx, w, h };
}

/**
 * Rotate a canvas by angleDeg (must be 90, 180, or 270).
 * Returns a new canvas with the rotated content.
 */
function rotateCanvas(srcCanvas, angleDeg) {
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;
  const isOdd90 = angleDeg === 90 || angleDeg === 270;
  const dw = isOdd90 ? sh : sw;
  const dh = isOdd90 ? sw : sh;

  const dst = createCanvas(dw, dh);
  const ctx = dst.getContext('2d');
  ctx.translate(dw / 2, dh / 2);
  ctx.rotate((angleDeg * Math.PI) / 180);
  ctx.drawImage(srcCanvas, -sw / 2, -sh / 2);
  return dst;
}

// ── XObject image extraction ───────────────────────────────────────────────

/**
 * Multiply two CTM matrices in [a,b,c,d,e,f] (column-major) format.
 */
function mulCTM(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * Convert a pdfjs image object to RGBA ImageData.
 * Handles:
 *   kind=1  GRAYSCALE_1BPP  (1 bit per pixel, MSB-first)
 *   kind=2  RGB_24BPP
 *   kind=3  RGBA_32BPP
 * Returns null for unknown kinds.
 */
function imageObjToImageData(imgObj) {
  const { width, height, data, kind } = imgObj;
  if (!width || !height || !data) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);

  if (kind === 3) {
    // Already RGBA — copy as-is
    rgba.set(data.subarray(0, rgba.length));
  } else if (kind === 2) {
    // RGB → RGBA
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      rgba[j]   = data[i];
      rgba[j+1] = data[i+1];
      rgba[j+2] = data[i+2];
      rgba[j+3] = 255;
    }
  } else if (kind === 1) {
    // 1BPP grayscale, packed bytes, MSB first
    let srcI = 0, bit = 7;
    for (let p = 0; p < width * height; p++) {
      const val = ((data[srcI] >> bit) & 1) ? 255 : 0;
      if (--bit < 0) { bit = 7; srcI++; }
      const j = p * 4;
      rgba[j] = rgba[j+1] = rgba[j+2] = val;
      rgba[j+3] = 255;
    }
  } else {
    return null;
  }

  return new ImageDataCtor(rgba, width, height);
}

/**
 * Extract all paintImageXObject calls from a PDF page.
 *
 * For each image XObject found, resolves its native pixel data and computes
 * its normalized bounding box on the page (top-left origin, 0–1 range).
 *
 * @param {object} page  pdfjs page object (already obtained via pdf.getPage)
 * @returns {Promise<Array<{name:string, imgData:ImageData, normLocation:{x,y,w,h}}>>}
 */
async function extractPageImages(page) {
  const opList  = await page.getOperatorList();
  const ops     = opList.fnArray;
  const args    = opList.argsArray;

  const viewport = page.getViewport({ scale: 1 });
  const pageW    = viewport.width;
  const pageH    = viewport.height;

  const OPS_SAVE      = pdfjs.OPS.save;             // 2
  const OPS_RESTORE   = pdfjs.OPS.restore;           // 3
  const OPS_TRANSFORM = pdfjs.OPS.transform;         // 12
  const OPS_PAINT_IMG = pdfjs.OPS.paintImageXObject; // 85

  const identity  = [1, 0, 0, 1, 0, 0];
  const ctmStack  = [identity.slice()];
  let   ctm       = identity.slice();

  // Collect (name, ctm) pairs first, then resolve images in parallel
  const pending = []; // { name, ctm }

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op === OPS_SAVE) {
      ctmStack.push(ctm.slice());
    } else if (op === OPS_RESTORE) {
      ctm = ctmStack.pop() ?? identity.slice();
    } else if (op === OPS_TRANSFORM) {
      const [a, b, c, d, e, f] = args[i];
      ctm = mulCTM(ctm, [a, b, c, d, e, f]);
    } else if (op === OPS_PAINT_IMG) {
      pending.push({ name: args[i][0], ctm: ctm.slice() });
    }
  }

  if (pending.length === 0) return [];

  // Resolve all XObject images (may involve async loading)
  const results = await Promise.all(pending.map(({ name, ctm: localCTM }) =>
    new Promise((resolve) => {
      page.objs.get(name, (imgObj) => {
        if (!imgObj || !imgObj.data) return resolve(null);

        const imgData = imageObjToImageData(imgObj);
        if (!imgData) return resolve(null);

        // Image unit square maps to these page-space corners:
        //   BL = (e, f),   BR = (e+a, f+b)
        //   TL = (e+c, f+d), TR = (e+a+c, f+b+d)
        const [a, b, c, d, e, f] = localCTM;
        const xs = [e, e + a, e + c, e + a + c];
        const ys = [f, f + b, f + d, f + b + d];
        const minX = Math.max(0, Math.min(...xs));
        const maxX = Math.min(pageW, Math.max(...xs));
        const minY = Math.max(0, Math.min(...ys));
        const maxY = Math.min(pageH, Math.max(...ys));

        // PDF Y-axis is bottom-up; flip to top-down (HTML/canvas convention)
        const normX = minX / pageW;
        const normY = 1 - maxY / pageH;
        const normW = (maxX - minX) / pageW;
        const normH = (maxY - minY) / pageH;

        resolve({
          name,
          imgData,
          normLocation: { x: normX, y: normY, w: normW, h: normH },
        });
      });
    })
  ));

  return results.filter(Boolean);
}

/**
 * Try to decode a single XObject image.
 * Tries the native pixels first, then 90°/180°/270° rotations.
 * Returns { url, format, location } using the full-page normLocation, or null.
 */
async function tryDecodeXObj(entry) {
  const { imgData, normLocation } = entry;
  const w = imgData.width;
  const h = imgData.height;

  // Attempt 0°  — no canvas required
  const res0 = await tryDecode(imgData, w, h);
  if (res0) return { url: res0.url, format: res0.format, location: normLocation };

  // Rotations require a canvas so we can call drawImage
  const srcCanvas = createCanvas(w, h);
  srcCanvas.getContext('2d').putImageData(imgData, 0, 0);

  for (const angle of [90, 180, 270]) {
    const rotated = rotateCanvas(srcCanvas, angle);
    const rw = rotated.width;
    const rh = rotated.height;
    const imgD = rotated.getContext('2d').getImageData(0, 0, rw, rh);
    const res  = await tryDecode(imgD, rw, rh);
    if (res) return { url: res.url, format: res.format, location: normLocation };
  }

  return null;
}

// ── Deduplication helpers ──────────────────────────────────────────────────

/** Intersection-over-Union for two normalized bboxes. */
function bboxIou(a, b) {
  if (!a || !b) return 0;
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 1e-9 ? inter / union : 0;
}

/**
 * Returns true when `candidate` is already covered by `results`:
 *   - same page + same URL, OR
 *   - same page + bbox IoU > 0.7
 */
function isDupe(results, candidate) {
  return results.some(r =>
    r.page === candidate.page && (
      r.url === candidate.url ||
      bboxIou(r.location, candidate.location) > 0.7
    )
  );
}

// ── Public: full PDF scan ──────────────────────────────────────────────────
export async function scanPdfForQR(pdfPath) {
  const ready = await loadDeps();
  if (!ready) return [];

  try {
    const pdf     = await openPdf(pdfPath);
    const results = [];
    const stats   = { xobj: 0, scale3: 0, scale5: 0, tiles: 0 };

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        // ── Stage 0: XObject extraction (native pixels, no interpolation) ──
        // Scan ALL images on the page — do NOT break after the first hit.
        try {
          const page   = await pdf.getPage(pageNum);
          const images = await extractPageImages(page);
          for (const entry of images) {
            const res = await tryDecodeXObj(entry);
            if (!res) continue;
            const candidate = { page: pageNum, source: 'auto', ...res };
            if (!isDupe(results, candidate)) {
              results.push(candidate);
              stats.xobj++;
            }
          }
        } catch (xErr) {
          console.warn(`[QR Scanner] XObj page ${pageNum}:`, xErr.message);
        }

        // If XObject strategy already found something on this page we still
        // run the render fallback only for pages where XObj found nothing,
        // to catch QR codes that are vector-drawn (not raster XObjects).
        const pageHasResult = results.some(r => r.page === pageNum);
        if (pageHasResult) continue;

        // ── Stage 1: scale=3, full page render ──────────────────────────
        const r3    = await renderPage(pdf, pageNum, 3);
        const imgD3 = r3.ctx.getImageData(0, 0, r3.w, r3.h);
        const found1 = await tryDecode(imgD3, r3.w, r3.h);
        if (found1) {
          const candidate = { page: pageNum, source: 'auto', ...found1 };
          if (!isDupe(results, candidate)) { results.push(candidate); stats.scale3++; }
          continue;
        }

        // ── Stage 2: scale=5, full page render ──────────────────────────
        const r5    = await renderPage(pdf, pageNum, 5);
        const imgD5 = r5.ctx.getImageData(0, 0, r5.w, r5.h);
        const found2 = await tryDecode(imgD5, r5.w, r5.h);
        if (found2) {
          const candidate = { page: pageNum, source: 'auto', ...found2 };
          if (!isDupe(results, candidate)) { results.push(candidate); stats.scale5++; }
          continue;
        }

        // ── Stage 3: 4 tiles from scale=3 canvas ────────────────────────
        const tW = Math.floor(r3.w / 2);
        const tH = Math.floor(r3.h / 2);
        for (const { ox, oy } of [
          { ox: 0,  oy: 0  },
          { ox: tW, oy: 0  },
          { ox: 0,  oy: tH },
          { ox: tW, oy: tH },
        ]) {
          const tw     = ox === 0 ? tW : r3.w - tW;
          const th     = oy === 0 ? tH : r3.h - tH;
          const tileD  = r3.ctx.getImageData(ox, oy, tw, th);
          const foundT = await tryDecode(tileD, tw, th);
          if (foundT) {
            foundT.location = {
              x: ox / r3.w + foundT.location.x * (tw / r3.w),
              y: oy / r3.h + foundT.location.y * (th / r3.h),
              w: foundT.location.w * (tw / r3.w),
              h: foundT.location.h * (th / r3.h),
            };
            const candidate = { page: pageNum, source: 'auto', ...foundT };
            if (!isDupe(results, candidate)) { results.push(candidate); stats.tiles++; }
            break;
          }
        }
      } catch (pageErr) {
        console.warn(`[QR Scanner] page ${pageNum} failed:`, pageErr.message);
      }
    }

    console.log(
      `[QR Scanner] scanned ${pdf.numPages} pages, found ${results.length}` +
      ` (xobj: ${stats.xobj}, scale3: ${stats.scale3}, scale5: ${stats.scale5}, tiles: ${stats.tiles})`
    );
    return results;
  } catch (err) {
    console.error('[QR Scanner] scan failed:', err.message);
    return [];
  }
}

// ── Public: ROI scan (manual assist) ──────────────────────────────────────
/**
 * Scan a specific region of interest on one page.
 *
 * Strategy 1 (preferred): find XObject images whose bounding box overlaps
 * the ROI and decode them at native resolution.
 *
 * Strategy 2 (fallback): render the full page at `scale`, crop the ROI, and
 * try 4 rotations — same as the original approach, with debug PNGs saved.
 *
 * @param {string}  pdfPath
 * @param {number}  pageNum  1-indexed
 * @param {{ x, y, w, h }} roi  normalized 0–1 (relative to full page)
 * @param {number}  scale    render scale for fallback (default 5)
 * @returns {Promise<{ result: {url,format,location}|null, debug: object }>}
 */
export async function scanPageRoi(pdfPath, pageNum, roi, scale = 5) {
  const ready = await loadDeps();
  if (!ready) return { result: null, debug: { error: 'deps not loaded' } };

  try {
    const pdf  = await openPdf(pdfPath);
    const page = await pdf.getPage(pageNum);

    // ── Strategy 1: XObject images overlapping the ROI ────────────────────
    let result = null;
    let allImages = [];
    try {
      allImages = await extractPageImages(page);
    } catch (xErr) {
      console.warn('[QR Scanner] XObj extract (ROI):', xErr.message);
    }

    const roiImages = allImages.filter(({ normLocation: loc }) =>
      loc.x          < roi.x + roi.w &&
      loc.x + loc.w  > roi.x &&
      loc.y          < roi.y + roi.h &&
      loc.y + loc.h  > roi.y
    );

    for (const entry of roiImages) {
      const res = await tryDecodeXObj(entry);
      if (res) { result = res; break; }
    }

    const debug = {
      strategy:     result ? 'xobj' : null,
      roiNorm:      roi,
      xobjTotal:    allImages.length,
      xobjInRoi:    roiImages.length,
    };

    if (result) {
      console.log(`[QR Scanner] ROI scan found via XObj: ${result.url}`);
      return { result, debug };
    }

    // ── Strategy 2: Render + crop fallback ───────────────────────────────
    debug.strategy = 'render';
    const r  = await renderPage(pdf, pageNum, scale);

    const px = Math.max(0, Math.floor(roi.x * r.w));
    const py = Math.max(0, Math.floor(roi.y * r.h));
    const pw = Math.max(4, Math.ceil(roi.w * r.w));
    const ph = Math.max(4, Math.ceil(roi.h * r.h));

    const roiCanvas = createCanvas(pw, ph);
    const roiCtx    = roiCanvas.getContext('2d');
    roiCtx.fillStyle = '#ffffff';
    roiCtx.fillRect(0, 0, pw, ph);
    roiCtx.drawImage(r.canvas, px, py, pw, ph, 0, 0, pw, ph);

    // Save debug PNGs
    await mkdir(DEBUG_DIR, { recursive: true });
    const ts       = Date.now();
    const fullName = `full_page-${pageNum}_${ts}.png`;
    const roiName  = `roi_page-${pageNum}_${ts}.png`;
    await writeFile(join(DEBUG_DIR, fullName), await r.canvas.encode('png'));
    await writeFile(join(DEBUG_DIR, roiName),  await roiCanvas.encode('png'));
    console.log(`[QR Scanner] debug PNGs → storage/debug/${fullName} + ${roiName}`);

    debug.pagePx  = { w: r.w, h: r.h };
    debug.roiPx   = { x: px, y: py, w: pw, h: ph };
    debug.scale   = scale;
    debug.fullPng = fullName;
    debug.roiPng  = roiName;

    for (const angle of [0, 90, 180, 270]) {
      const src  = angle === 0 ? roiCanvas : rotateCanvas(roiCanvas, angle);
      const cw   = src.width;
      const ch   = src.height;
      const imgD = src.getContext('2d').getImageData(0, 0, cw, ch);
      result = await tryDecode(imgD, cw, ch);
      if (result) {
        debug.foundAtAngle = angle;
        // Remap from ROI-relative to full-page normalized coords
        result.location = {
          x: roi.x + result.location.x * roi.w,
          y: roi.y + result.location.y * roi.h,
          w: result.location.w * roi.w,
          h: result.location.h * roi.h,
        };
        break;
      }
    }

    return { result, debug };
  } catch (err) {
    console.error('[QR Scanner] ROI scan failed:', err.message);
    return { result: null, debug: { error: err.message } };
  }
}
