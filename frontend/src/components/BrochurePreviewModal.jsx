/**
 * BrochurePreviewModal – full-screen admin preview of a brochure.
 *
 * Renders the PDF with the same HotspotLayer used in the public viewer
 * (QR overlays, hotspots, override images) without navigating away from Admin.
 *
 * Props:
 *  - pdfUrl      string
 *  - qrCodes     array  (all pages)
 *  - hotspots    array  (all pages)
 *  - pageCount   number (hint while PDF loads)
 *  - onClose     () => void
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { loadPdf, renderPage } from '../utils/pdfLoader.js';
import HotspotLayer from './HotspotLayer.jsx';
import { S } from '../utils/strings.js';

const PREVIEW_SCALE = 1.5;

function PreviewCanvas({ pgData }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !pgData?.canvas) return;
    const el = ref.current;
    el.width  = pgData.w;
    el.height = pgData.h;
    el.getContext('2d').drawImage(pgData.canvas, 0, 0);
  }, [pgData]);
  return <canvas ref={ref} width={pgData?.w} height={pgData?.h} style={{ display: 'block' }} />;
}

export default function BrochurePreviewModal({
  pdfUrl,
  qrCodes   = [],
  hotspots  = [],
  pageCount = 1,
  onClose,
}) {
  const [pdfDoc,      setPdfDoc]      = useState(null);
  const [pages,       setPages]       = useState({});
  const [currentPage, setCurrentPage] = useState(1);
  const [loading,     setLoading]     = useState(true);
  const renderQueue = useRef(new Set());

  useEffect(() => {
    let cancelled = false;
    loadPdf(pdfUrl)
      .then(pdf  => { if (!cancelled) { setPdfDoc(pdf); setLoading(false); } })
      .catch(err => { console.error(err); if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pdfUrl]);

  const ensurePage = useCallback(async (pageNum) => {
    if (!pdfDoc || pageNum < 1 || pageNum > pdfDoc.numPages) return;
    if (pages[pageNum] || renderQueue.current.has(pageNum)) return;
    renderQueue.current.add(pageNum);
    const { canvas, width, height } = await renderPage(pdfDoc, pageNum, PREVIEW_SCALE);
    setPages(prev => ({ ...prev, [pageNum]: { canvas, w: width, h: height } }));
    renderQueue.current.delete(pageNum);
  }, [pdfDoc, pages]);

  useEffect(() => {
    if (!pdfDoc) return;
    [currentPage - 1, currentPage, currentPage + 1]
      .filter(p => p >= 1 && p <= pdfDoc.numPages)
      .forEach(ensurePage);
  }, [currentPage, pdfDoc, ensurePage]);

  const numPages  = pdfDoc?.numPages || pageCount;
  const goTo      = (n) => setCurrentPage(Math.max(1, Math.min(numPages, n)));
  const pg        = pages[currentPage];
  const qrForPage = qrCodes.filter(q => q.page === currentPage);
  const hsForPage = hotspots.filter(h => h.page === currentPage);

  const onBackdrop = (e) => { if (e.target === e.currentTarget) onClose(); };

  useEffect(() => {
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goTo(currentPage + 1);
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   goTo(currentPage - 1);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentPage, numPages]);

  return (
    <div
      onClick={onBackdrop}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.78)',
        zIndex: 500,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '92vw', height: '92vh',
          background: 'var(--bg)',
          borderRadius: 8,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
        }}
      >
        {/* ── Toolbar ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '9px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {/* Admin Preview badge */}
          <span style={{
            fontSize: '0.7rem', fontWeight: 700,
            background: 'rgba(124,107,240,0.18)',
            color: 'var(--accent-light)',
            padding: '2px 8px', borderRadius: 20,
            letterSpacing: '0.04em',
          }}>
            {S.adminPreviewBadge}
          </span>

          <div style={{ flex: 1 }} />

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => goTo(currentPage - 1)}
            disabled={currentPage <= 1}
          >›</button>

          <input
            type="number"
            min={1} max={numPages}
            value={currentPage}
            onChange={e => goTo(parseInt(e.target.value, 10) || 1)}
            style={{
              width: 50, textAlign: 'center', padding: '3px 6px',
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem',
            }}
          />

          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {S.ofPages(numPages)}
          </span>

          <button
            className="btn btn-ghost btn-sm"
            onClick={() => goTo(currentPage + 1)}
            disabled={currentPage >= numPages}
          >‹</button>

          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />

          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            {S.closePreview}
          </button>
        </div>

        {/* ── Canvas area ── */}
        <div style={{
          flex: 1, overflow: 'auto',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          background: '#111',
          padding: '28px 24px',
        }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: '16vh' }}>
              <div className="spinner" />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{S.loadingPdf}</p>
            </div>
          ) : pg ? (
            <div style={{
              position: 'relative',
              width: pg.w, height: pg.h,
              flexShrink: 0,
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              borderRadius: 2,
            }}>
              <PreviewCanvas pgData={pg} />
              <HotspotLayer
                qrCodes={qrForPage}
                hotspots={hsForPage}
                canvasW={pg.w}
                canvasH={pg.h}
                onNavigate={goTo}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: '16vh' }}>
              <div className="spinner" />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{S.renderingPage(currentPage)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
