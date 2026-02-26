import jsQR from 'jsqr';

/**
 * Scan a rendered canvas for QR codes.
 * Returns an array of { url, location: { x, y, w, h } } (normalized 0-1).
 */
export function scanCanvasForQR(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);

  const code = jsQR(imageData.data, width, height, {
    inversionAttempts: 'dontInvert',
  });

  if (!code) return [];

  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = code.location;
  const x = Math.min(topLeftCorner.x, bottomLeftCorner.x) / width;
  const y = Math.min(topLeftCorner.y, topRightCorner.y) / height;
  const x2 = Math.max(topRightCorner.x, bottomRightCorner.x) / width;
  const y2 = Math.max(bottomLeftCorner.y, bottomRightCorner.y) / height;

  return [
    {
      url: code.data,
      location: {
        x: Math.max(0, x),
        y: Math.max(0, y),
        w: Math.min(1, x2) - Math.max(0, x),
        h: Math.min(1, y2) - Math.max(0, y),
      },
    },
  ];
}

/**
 * Scan all pages of a PDF document for QR codes.
 * pdfDoc: pdfjs document proxy
 * renderPage: async (pageNum) => canvas
 * onProgress: (current, total) => void
 * Returns array of { page, url, location }
 */
export async function scanAllPages(pdfDoc, renderPageFn, onProgress) {
  const total = pdfDoc.numPages;
  const results = [];

  for (let i = 1; i <= total; i++) {
    if (onProgress) onProgress(i, total);
    try {
      const { canvas } = await renderPageFn(i);
      const codes = scanCanvasForQR(canvas);
      codes.forEach(c => results.push({ page: i, ...c }));
    } catch (e) {
      console.warn(`QR scan failed on page ${i}:`, e);
    }
  }

  return results;
}
