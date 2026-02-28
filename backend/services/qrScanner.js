/**
 * Server-side QR scanner — pure JavaScript, no native binaries.
 *
 * Dependencies (zero native addons):
 *   pdfjs-dist  — pure JS PDF renderer
 *   pureimage   — pure JS canvas (replaces @napi-rs/canvas)
 *   jsqr        — pure JS QR decoder
 *
 * Strategy:
 *   Stage 0 (primary):   extract raw image XObjects from the PDF and decode
 *                        them at native resolution — no page rendering needed.
 *   Stages 1-3 (fallback): render pages via pdfjs + pureimage, then try jsqr
 *                        on the full page and on 4 tile crops.
 *
 * Public API:
 *   scanPdfForQR(pdfBuffer)           — scan all pages
 *   scanPageRoi(pdfBuffer, pg, roi)   — scan a specific page region
 */

// ── Lazy-loaded dependencies ───────────────────────────────────────────────

let pdfjs   = null;
let pureimg = null;
let jsQR    = null;

async function loadDeps() {
  if (pdfjs) return true;
  try {
    const [pdfjsMod, pureimgMod, jsqrMod] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('pureimage'),
      import('jsqr'),
    ]);
    pdfjs   = pdfjsMod;
    pureimg = pureimgMod.default ?? pureimgMod; // handle CJS default export
    jsQR    = jsqrMod.default ?? jsqrMod;
    return true;
  } catch (err) {
    console.warn('[QR Scanner] deps unavailable:', err.message);
    return false;
  }
}

// ── Minimal ImageData class (no canvas library needed) ────────────────────

class ImageData {
  constructor(data, width, height) {
    this.data   = data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
    this.width  = width;
    this.height = height;
  }
}

// ── Preprocessing ──────────────────────────────────────────────────────────

function toGrayscale(imgData) {
  const src = imgData.data;
  const dst = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const g = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0;
    dst[i] = dst[i + 1] = dst[i + 2] = g;
    dst[i + 3] = src[i + 3];
  }
  return new ImageData(dst, imgData.width, imgData.height);
}

// ── Pure-JS pixel rotations (no canvas needed) ────────────────────────────

/** Rotate RGBA buffer 90° clockwise. Returns { data, width, height }. */
function rotate90CW(data, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  const nw  = height; // new width after rotation
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcI = (y * width + x) * 4;
      const dstI = (x * nw + (height - 1 - y)) * 4;
      out[dstI]     = data[srcI];
      out[dstI + 1] = data[srcI + 1];
      out[dstI + 2] = data[srcI + 2];
      out[dstI + 3] = data[srcI + 3];
    }
  }
  return { data: out, width: height, height: width };
}

/** Rotate RGBA buffer 180°. Dimensions unchanged. */
function rotate180(data, width, height) {
  const out = new Uint8ClampedArray(data.length);
  const n   = width * height;
  for (let i = 0; i < n; i++) {
    const j = n - 1 - i;
    out[j * 4]     = data[i * 4];
    out[j * 4 + 1] = data[i * 4 + 1];
    out[j * 4 + 2] = data[i * 4 + 2];
    out[j * 4 + 3] = data[i * 4 + 3];
  }
  return { data: out, width, height };
}

/** Rotate RGBA buffer 270° clockwise (= 90° CCW). Returns { data, width, height }. */
function rotate270CW(data, width, height) {
  const out = new Uint8ClampedArray(width * height * 4);
  const nw  = height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcI = (y * width + x) * 4;
      const dstI = ((width - 1 - x) * nw + y) * 4;
      out[dstI]     = data[srcI];
      out[dstI + 1] = data[srcI + 1];
      out[dstI + 2] = data[srcI + 2];
      out[dstI + 3] = data[srcI + 3];
    }
  }
  return { data: out, width: height, height: width };
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

// ── Core decode (jsqr only — pure JS) ─────────────────────────────────────

/** Returns { url, format, location } or null. */
async function tryDecode(imgData, w, h) {
  // Pass 1: jsqr direct
  const code = jsQR(imgData.data, w, h, { inversionAttempts: 'attemptBoth' });
  if (code?.data?.trim()) {
    return { url: code.data, format: 'QRCode', location: jsqrToNorm(code, w, h) };
  }

  // Pass 2: jsqr on grayscale (helps colour / low-contrast images)
  const gray     = toGrayscale(imgData);
  const codeGray = jsQR(gray.data, w, h, { inversionAttempts: 'attemptBoth' });
  if (codeGray?.data?.trim()) {
    return { url: codeGray.data, format: 'QRCode', location: jsqrToNorm(codeGray, w, h) };
  }

  return null;
}

// ── PDF helpers ────────────────────────────────────────────────────────────

async function openPdf(pdfData) {
  const data = new Uint8Array(pdfData);
  return pdfjs.getDocument({
    data,
    verbosity:       0,
    useWorkerFetch:  false,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise;
}

/**
 * Create a pureimage canvas + context.
 * Adds ctx.canvas back-reference that pdfjs-dist may require.
 */
function makeCanvas(w, h) {
  const canvas = pureimg.make(w, h);
  const ctx    = canvas.getContext('2d');
  if (!ctx.canvas) ctx.canvas = canvas;
  return { canvas, ctx };
}

/**
 * Render one PDF page to an ImageData using pureimage.
 * Returns { imgData: ImageData, w, h } or throws.
 */
async function renderPage(pdf, pageNum, scale) {
  const page     = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const w        = Math.ceil(viewport.width);
  const h        = Math.ceil(viewport.height);
  const { ctx }  = makeCanvas(w, h);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();

  const raw = ctx.getImageData(0, 0, w, h);
  return { imgData: new ImageData(raw.data, w, h), w, h };
}

/**
 * Crop a rectangle from an ImageData. Safe — clamps to bounds.
 */
function cropImageData(imgData, px, py, pw, ph) {
  px = Math.max(0, px);
  py = Math.max(0, py);
  pw = Math.min(pw, imgData.width  - px);
  ph = Math.min(ph, imgData.height - py);
  if (pw <= 0 || ph <= 0) return new ImageData(new Uint8ClampedArray(4), 1, 1);

  const out = new Uint8ClampedArray(pw * ph * 4);
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const srcI = ((py + y) * imgData.width + (px + x)) * 4;
      const dstI = (y * pw + x) * 4;
      out[dstI]     = imgData.data[srcI];
      out[dstI + 1] = imgData.data[srcI + 1];
      out[dstI + 2] = imgData.data[srcI + 2];
      out[dstI + 3] = imgData.data[srcI + 3];
    }
  }
  return new ImageData(out, pw, ph);
}

// ── XObject image extraction ───────────────────────────────────────────────

/** Multiply two CTM matrices [a,b,c,d,e,f] (column-major). */
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
 * kind=1 GRAYSCALE_1BPP | kind=2 RGB_24BPP | kind=3 RGBA_32BPP
 */
function imageObjToImageData(imgObj) {
  const { width, height, data, kind } = imgObj;
  if (!width || !height || !data) return null;

  const rgba = new Uint8ClampedArray(width * height * 4);

  if (kind === 3) {
    rgba.set(data.subarray(0, rgba.length));
  } else if (kind === 2) {
    for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
      rgba[j]   = data[i];
      rgba[j+1] = data[i+1];
      rgba[j+2] = data[i+2];
      rgba[j+3] = 255;
    }
  } else if (kind === 1) {
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

  return new ImageData(rgba, width, height);
}

/**
 * Extract all paintImageXObject calls from a PDF page.
 * Returns [{ name, imgData, normLocation }].
 */
async function extractPageImages(page) {
  const opList  = await page.getOperatorList();
  const ops     = opList.fnArray;
  const args    = opList.argsArray;

  const viewport = page.getViewport({ scale: 1 });
  const pageW    = viewport.width;
  const pageH    = viewport.height;

  const OPS_SAVE      = pdfjs.OPS.save;
  const OPS_RESTORE   = pdfjs.OPS.restore;
  const OPS_TRANSFORM = pdfjs.OPS.transform;
  const OPS_PAINT_IMG = pdfjs.OPS.paintImageXObject;

  const identity = [1, 0, 0, 1, 0, 0];
  const ctmStack = [identity.slice()];
  let   ctm      = identity.slice();
  const pending  = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if      (op === OPS_SAVE)      { ctmStack.push(ctm.slice()); }
    else if (op === OPS_RESTORE)   { ctm = ctmStack.pop() ?? identity.slice(); }
    else if (op === OPS_TRANSFORM) {
      const [a, b, c, d, e, f] = args[i];
      ctm = mulCTM(ctm, [a, b, c, d, e, f]);
    } else if (op === OPS_PAINT_IMG) {
      pending.push({ name: args[i][0], ctm: ctm.slice() });
    }
  }

  if (pending.length === 0) return [];

  const results = await Promise.all(
    pending.map(({ name, ctm: localCTM }) =>
      new Promise((resolve) => {
        page.objs.get(name, (imgObj) => {
          if (!imgObj || !imgObj.data) return resolve(null);

          const imgData = imageObjToImageData(imgObj);
          if (!imgData) return resolve(null);

          const [a, b, c, d, e, f] = localCTM;
          const xs = [e, e+a, e+c, e+a+c];
          const ys = [f, f+b, f+d, f+b+d];
          const minX = Math.max(0, Math.min(...xs));
          const maxX = Math.min(pageW, Math.max(...xs));
          const minY = Math.max(0, Math.min(...ys));
          const maxY = Math.min(pageH, Math.max(...ys));

          // PDF Y-axis is bottom-up; flip to top-down
          resolve({
            name,
            imgData,
            normLocation: {
              x: minX / pageW,
              y: 1 - maxY / pageH,
              w: (maxX - minX) / pageW,
              h: (maxY - minY) / pageH,
            },
          });
        });
      })
    )
  );

  return results.filter(Boolean);
}

/**
 * Try to decode a single XObject image.
 * Tries 0° first, then 90°/180°/270° using pure-JS pixel rotation.
 */
async function tryDecodeXObj(entry) {
  const { imgData, normLocation } = entry;
  const w = imgData.width;
  const h = imgData.height;

  // 0° — no rotation needed
  const res0 = await tryDecode(imgData, w, h);
  if (res0) return { url: res0.url, format: res0.format, location: normLocation };

  // 90°, 180°, 270° — pure-JS pixel rotation, no canvas required
  for (const rotateFn of [rotate90CW, rotate180, rotate270CW]) {
    const r   = rotateFn(imgData.data, w, h);
    const res = await tryDecode(r, r.width, r.height);
    if (res) return { url: res.url, format: res.format, location: normLocation };
  }

  return null;
}

// ── Deduplication helpers ──────────────────────────────────────────────────

function bboxIou(a, b) {
  if (!a || !b) return 0;
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 1e-9 ? inter / union : 0;
}

function isDupe(results, candidate) {
  return results.some(r =>
    r.page === candidate.page && (
      r.url === candidate.url ||
      bboxIou(r.location, candidate.location) > 0.7
    )
  );
}

// ── Public: full PDF scan ──────────────────────────────────────────────────

export async function scanPdfForQR(pdfBuffer) {
  const ready = await loadDeps();
  if (!ready) return [];

  try {
    const pdf     = await openPdf(pdfBuffer);
    const results = [];
    const stats   = { xobj: 0, scale3: 0, scale5: 0, tiles: 0 };

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        // ── Stage 0: XObject extraction (native pixels, no rendering) ───────
        try {
          const page   = await pdf.getPage(pageNum);
          const images = await extractPageImages(page);
          for (const entry of images) {
            const res = await tryDecodeXObj(entry);
            if (!res) continue;
            const candidate = { page: pageNum, source: 'auto', ...res };
            if (!isDupe(results, candidate)) { results.push(candidate); stats.xobj++; }
          }
        } catch (xErr) {
          console.warn(`[QR Scanner] XObj page ${pageNum}:`, xErr.message);
        }

        // Skip render fallback if XObject already found something on this page
        if (results.some(r => r.page === pageNum)) continue;

        // ── Stages 1-3: page rendering fallback (pureimage) ─────────────────
        try {
          // Stage 1: scale=3 full page
          const r3 = await renderPage(pdf, pageNum, 3);
          const f1 = await tryDecode(r3.imgData, r3.w, r3.h);
          if (f1) {
            const c = { page: pageNum, source: 'auto', ...f1 };
            if (!isDupe(results, c)) { results.push(c); stats.scale3++; }
            continue;
          }

          // Stage 2: scale=5 full page
          const r5 = await renderPage(pdf, pageNum, 5);
          const f2 = await tryDecode(r5.imgData, r5.w, r5.h);
          if (f2) {
            const c = { page: pageNum, source: 'auto', ...f2 };
            if (!isDupe(results, c)) { results.push(c); stats.scale5++; }
            continue;
          }

          // Stage 3: 4 tiles from the scale=3 image
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
            const tile   = cropImageData(r3.imgData, ox, oy, tw, th);
            const foundT = await tryDecode(tile, tw, th);
            if (foundT) {
              foundT.location = {
                x: ox / r3.w + foundT.location.x * (tw / r3.w),
                y: oy / r3.h + foundT.location.y * (th / r3.h),
                w: foundT.location.w * (tw / r3.w),
                h: foundT.location.h * (th / r3.h),
              };
              const c = { page: pageNum, source: 'auto', ...foundT };
              if (!isDupe(results, c)) { results.push(c); stats.tiles++; }
              break;
            }
          }
        } catch (rErr) {
          console.warn(`[QR Scanner] render fallback page ${pageNum}:`, rErr.message);
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

export async function scanPageRoi(pdfBuffer, pageNum, roi, scale = 5) {
  const ready = await loadDeps();
  if (!ready) return { result: null, debug: { error: 'deps not loaded' } };

  try {
    const pdf  = await openPdf(pdfBuffer);
    const page = await pdf.getPage(pageNum);

    // Strategy 1: XObject images overlapping the ROI
    let result    = null;
    let allImages = [];
    try {
      allImages = await extractPageImages(page);
    } catch (xErr) {
      console.warn('[QR Scanner] XObj extract (ROI):', xErr.message);
    }

    const roiImages = allImages.filter(({ normLocation: loc }) =>
      loc.x         < roi.x + roi.w &&
      loc.x + loc.w > roi.x &&
      loc.y         < roi.y + roi.h &&
      loc.y + loc.h > roi.y
    );

    for (const entry of roiImages) {
      const res = await tryDecodeXObj(entry);
      if (res) { result = res; break; }
    }

    const debug = {
      strategy:  result ? 'xobj' : null,
      roiNorm:   roi,
      xobjTotal: allImages.length,
      xobjInRoi: roiImages.length,
    };

    if (result) {
      console.log(`[QR Scanner] ROI scan found via XObj: ${result.url}`);
      return { result, debug };
    }

    // Strategy 2: Render + crop fallback
    debug.strategy = 'render';
    try {
      const r  = await renderPage(pdf, pageNum, scale);
      const px = Math.max(0, Math.floor(roi.x * r.w));
      const py = Math.max(0, Math.floor(roi.y * r.h));
      const pw = Math.max(4, Math.ceil(roi.w  * r.w));
      const ph = Math.max(4, Math.ceil(roi.h  * r.h));

      debug.pagePx = { w: r.w, h: r.h };
      debug.roiPx  = { x: px, y: py, w: pw, h: ph };
      debug.scale  = scale;

      const roiImgData = cropImageData(r.imgData, px, py, pw, ph);

      for (const angle of [0, 90, 180, 270]) {
        let imgD;
        if (angle === 0) {
          imgD = roiImgData;
        } else if (angle === 90) {
          const r90 = rotate90CW(roiImgData.data, roiImgData.width, roiImgData.height);
          imgD = new ImageData(r90.data, r90.width, r90.height);
        } else if (angle === 180) {
          const r180 = rotate180(roiImgData.data, roiImgData.width, roiImgData.height);
          imgD = new ImageData(r180.data, r180.width, r180.height);
        } else {
          const r270 = rotate270CW(roiImgData.data, roiImgData.width, roiImgData.height);
          imgD = new ImageData(r270.data, r270.width, r270.height);
        }

        result = await tryDecode(imgD, imgD.width, imgD.height);
        if (result) {
          debug.foundAtAngle = angle;
          result.location = {
            x: roi.x + result.location.x * roi.w,
            y: roi.y + result.location.y * roi.h,
            w: result.location.w * roi.w,
            h: result.location.h * roi.h,
          };
          break;
        }
      }
    } catch (rErr) {
      console.warn('[QR Scanner] ROI render fallback:', rErr.message);
      debug.renderError = rErr.message;
    }

    return { result, debug };
  } catch (err) {
    console.error('[QR Scanner] ROI scan failed:', err.message);
    return { result: null, debug: { error: err.message } };
  }
}
