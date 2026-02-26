import * as pdfjs from 'pdfjs-dist';

// Configure the worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href;

/**
 * Load a PDF document from a URL.
 * Returns a pdfjs PDFDocumentProxy.
 */
export async function loadPdf(url) {
  const loadingTask = pdfjs.getDocument({ url, cMapUrl: 'https://unpkg.com/pdfjs-dist/cmaps/', cMapPacked: true });
  return loadingTask.promise;
}

/**
 * Render a single page (1-indexed) to a new <canvas> element.
 * Returns { canvas, width, height, viewport }.
 */
export async function renderPage(pdfDoc, pageNum, scale = 1.5) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;

  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    viewport,
  };
}

/**
 * Render a page into an existing <canvas> element.
 */
export async function renderPageInto(pdfDoc, pageNum, canvas, scale = 1.5) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return viewport;
}

/**
 * Extract text content from a page (for TOC generation).
 */
export async function extractPageText(pdfDoc, pageNum) {
  const page = await pdfDoc.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map(item => item.str).join(' ');
}
