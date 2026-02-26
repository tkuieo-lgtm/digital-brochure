/**
 * FlipBook – a smooth CSS 3D page-turn viewer for PDF pages.
 *
 * Props:
 *  - pdfDoc        pdfjs document proxy
 *  - metadata      { qrCodes, hotspots }
 *  - initialPage   number (1-based)
 *  - onPageChange  (pageNum) => void
 *  - zoom          number (1 = 100%)
 *  - onNavigate    (pageNum) => void (from hotspots)
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { renderPage } from '../utils/pdfLoader.js';
import { scanCanvasForQR } from '../utils/qrDetector.js';
import HotspotLayer from './HotspotLayer.jsx';

const RENDER_SCALE = 1.8;

export default function FlipBook({ pdfDoc, metadata, initialPage = 1, onPageChange, zoom = 1, onNavigate, onQrFound }) {
  const numPages = pdfDoc?.numPages || 0;

  // current spread: pages (left, right). Page 1 = cover (right side only).
  const [spread, setSpread] = useState(initialPage);
  const [pages, setPages] = useState({});       // pageNum → { canvas, w, h }
  const [flipping, setFlipping] = useState(null); // 'left' | 'right' | null
  const [pageSize, setPageSize] = useState({ w: 600, h: 800 });

  const containerRef = useRef(null);
  const renderQueue = useRef(new Set());

  // Clamp spread so left page is always odd (or 0 for cover-only)
  const leftPage  = spread <= 1 ? null : (spread % 2 === 0 ? spread - 1 : spread);
  const rightPage = spread <= 1 ? 1    : (spread % 2 === 0 ? spread     : spread + 1);

  const canGoPrev = spread > 1;
  const canGoNext = rightPage < numPages || (leftPage !== null && leftPage < numPages);

  const ensurePage = useCallback(async (pageNum) => {
    if (!pdfDoc || !pageNum || pageNum < 1 || pageNum > pdfDoc.numPages) return;
    if (pages[pageNum] || renderQueue.current.has(pageNum)) return;
    renderQueue.current.add(pageNum);

    const { canvas, width, height } = await renderPage(pdfDoc, pageNum, RENDER_SCALE);

    // QR scan on first render
    if (onQrFound) {
      const codes = scanCanvasForQR(canvas);
      if (codes.length > 0) {
        onQrFound(pageNum, codes);
      }
    }

    setPages(prev => ({ ...prev, [pageNum]: { canvas, w: width, h: height } }));
    setPageSize({ w: width, h: height });
    renderQueue.current.delete(pageNum);
  }, [pdfDoc, pages, onQrFound]);

  // Pre-render the current spread and neighbors
  useEffect(() => {
    if (!pdfDoc) return;
    const toRender = [leftPage, rightPage, leftPage ? leftPage - 1 : null, rightPage ? rightPage + 1 : null]
      .filter(p => p && p >= 1 && p <= numPages);
    toRender.forEach(ensurePage);
  }, [spread, pdfDoc, numPages, ensurePage, leftPage, rightPage]);

  const goNext = () => {
    if (!canGoNext || flipping) return;
    setFlipping('right');
    setTimeout(() => {
      setSpread(s => {
        const next = s <= 1 ? 2 : s + 2;
        const clamped = Math.min(next, numPages % 2 === 0 ? numPages : numPages - 1);
        if (onPageChange) onPageChange(clamped);
        return clamped;
      });
      setFlipping(null);
    }, 600);
  };

  const goPrev = () => {
    if (!canGoPrev || flipping) return;
    setFlipping('left');
    setTimeout(() => {
      setSpread(s => {
        const prev = s <= 2 ? 1 : s - 2;
        if (onPageChange) onPageChange(prev);
        return prev;
      });
      setFlipping(null);
    }, 600);
  };

  const navigateTo = (pageNum) => {
    if (pageNum < 1 || pageNum > numPages) return;
    const target = pageNum === 1 ? 1 : (pageNum % 2 === 0 ? pageNum : pageNum - 1);
    setSpread(target);
    if (onPageChange) onPageChange(pageNum);
  };

  // Expose navigate
  useEffect(() => {
    if (onNavigate) onNavigate.current = navigateTo;
  });

  // Hotspots & QR for current pages
  const qrForPage = (p) => (metadata?.qrCodes || []).filter(q => q.page === p);
  const hsForPage = (p) => (metadata?.hotspots || []).filter(h => h.page === p);

  const scaled = zoom !== 1;
  const bookW = spread === 1 ? pageSize.w : pageSize.w * 2;
  const bookH = pageSize.h;
  const maxH = window.innerHeight - 120;
  const fitScale = Math.min(1, (maxH / bookH), ((window.innerWidth - 120) / bookW));
  const finalScale = fitScale * zoom;

  const renderSide = (pageNum) => {
    if (!pageNum) return <div style={{ width: pageSize.w, height: pageSize.h, background: 'var(--paper)' }} />;
    const pg = pages[pageNum];
    if (!pg) {
      return (
        <div style={{ width: pageSize.w, height: pageSize.h, background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="spinner" style={{ width: 24, height: 24 }} />
        </div>
      );
    }
    return (
      <div className="page-canvas-wrap" style={{ width: pg.w, height: pg.h, position: 'relative', flexShrink: 0 }}>
        <canvas
          ref={el => { if (el && pg.canvas) { el.width = pg.w; el.height = pg.h; el.getContext('2d').drawImage(pg.canvas, 0, 0); } }}
          width={pg.w}
          height={pg.h}
        />
        <HotspotLayer
          qrCodes={qrForPage(pageNum)}
          hotspots={hsForPage(pageNum)}
          canvasW={pg.w}
          canvasH={pg.h}
          onNavigate={navigateTo}
        />
        <div style={{
          position: 'absolute', bottom: 8, right: 12,
          fontSize: '0.7rem', color: 'rgba(0,0,0,0.3)',
          fontFamily: 'var(--font)', pointerEvents: 'none',
        }}>
          {pageNum}
        </div>
      </div>
    );
  };

  return (
    <div className="flipbook-wrapper" ref={containerRef}>
      {/* Prev arrow */}
      <button
        className="nav-arrow left"
        onClick={goPrev}
        disabled={!canGoPrev}
        style={{ position: 'relative', transform: 'none', top: 'auto', flexShrink: 0 }}
      >
        ‹
      </button>

      {/* Book */}
      <div
        className="flipbook-container"
        style={{
          transform: `scale(${finalScale})`,
          transformOrigin: 'center center',
          transition: scaled ? 'transform 0.3s' : 'none',
          display: 'flex',
          background: 'var(--paper)',
          overflow: 'hidden',
          borderRadius: 4,
        }}
      >
        {/* Flip animation classes */}
        <div
          style={{
            display: 'flex',
            transition: 'opacity 0.3s',
            opacity: flipping ? 0.7 : 1,
          }}
        >
          {spread > 1 && renderSide(leftPage)}
          {renderSide(rightPage)}
        </div>
      </div>

      {/* Next arrow */}
      <button
        className="nav-arrow right"
        onClick={goNext}
        disabled={!canGoNext}
        style={{ position: 'relative', transform: 'none', top: 'auto', flexShrink: 0 }}
      >
        ›
      </button>
    </div>
  );
}

// Export navigate ref helper
FlipBook.createNavigateRef = () => ({ current: null });
