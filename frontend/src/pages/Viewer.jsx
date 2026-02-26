import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api.js';
import { loadPdf, renderPage } from '../utils/pdfLoader.js';
import { scanCanvasForQR } from '../utils/qrDetector.js';
import TOC from '../components/TOC.jsx';
import HotspotLayer from '../components/HotspotLayer.jsx';
import { S } from '../utils/strings.js';

const SCALE = 1.8;

// Properly redraws when pgData changes (ref callback alone doesn't re-run on state update)
function PageCanvas({ pgData, style }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !pgData?.canvas) return;
    const el = canvasRef.current;
    el.width = pgData.w;
    el.height = pgData.h;
    el.getContext('2d').drawImage(pgData.canvas, 0, 0);
  }, [pgData]);
  return <canvas ref={canvasRef} width={pgData?.w} height={pgData?.h} style={style} />;
}

function Toast({ msg, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);
  return <div className={`toast ${type}`}>{msg}</div>;
}

export default function Viewer() {
  const { id } = useParams();
  const [brochure, setBrochure] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [tocOpen, setTocOpen] = useState(true);
  const [pages, setPages] = useState({});    // pageNum → { canvas, w, h }
  const [toast, setToast] = useState(null);

  const navRef = useRef(null);
  const renderQueue = useRef(new Set());
  const foundQrPages = useRef(new Set());
  const pendingQr = useRef([]);
  const qrFlushTimer = useRef(null);

  // Load brochure + PDF
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, meta] = await Promise.all([api.getBrochure(id), api.getMetadata(id)]);
        if (cancelled) return;
        setBrochure(b);
        setMetadata(meta);
        const pdf = await loadPdf(api.pdfUrl(b.filename));
        if (cancelled) return;
        setPdfDoc(pdf);

        // Update page count if needed
        if (b.pageCount !== pdf.numPages) {
          api.updateBrochure(id, { pageCount: pdf.numPages }).catch(() => {});
          setBrochure(prev => ({ ...prev, pageCount: pdf.numPages }));
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // Render a page and scan for QR
  const ensurePage = useCallback(async (pageNum) => {
    if (!pdfDoc || !pageNum || pageNum < 1 || pageNum > pdfDoc.numPages) return;
    if (pages[pageNum] || renderQueue.current.has(pageNum)) return;
    renderQueue.current.add(pageNum);

    const { canvas, width, height } = await renderPage(pdfDoc, pageNum, SCALE);

    // QR detection (skip if already scanned for this page)
    if (!foundQrPages.current.has(pageNum)) {
      foundQrPages.current.add(pageNum);
      const codes = scanCanvasForQR(canvas);
      if (codes.length > 0 && metadata && !metadata.qrScanned) {
        pendingQr.current.push(...codes.map(c => ({ page: pageNum, ...c })));
        // Debounce flush
        clearTimeout(qrFlushTimer.current);
        qrFlushTimer.current = setTimeout(() => {
          if (pendingQr.current.length > 0) {
            const batch = [...pendingQr.current];
            pendingQr.current = [];
            api.submitQrScan(id, batch)
              .then(updated => setMetadata(updated))
              .catch(() => {});
          }
        }, 1500);
      }
    }

    setPages(prev => ({ ...prev, [pageNum]: { canvas, w: width, h: height } }));
    renderQueue.current.delete(pageNum);
  }, [pdfDoc, pages, id, metadata]);

  // Pre-render current page and neighbors
  useEffect(() => {
    if (!pdfDoc) return;
    const numPages = pdfDoc.numPages;
    const toRender = [
      currentPage,
      currentPage - 1,
      currentPage + 1,
      currentPage + 2,
    ].filter(p => p >= 1 && p <= numPages);
    toRender.forEach(ensurePage);
  }, [currentPage, pdfDoc, ensurePage]);

  const numPages = pdfDoc?.numPages || 0;

  // Navigation helpers
  const goTo = useCallback((pageNum) => {
    const clamped = Math.max(1, Math.min(pageNum, numPages));
    setCurrentPage(clamped);
  }, [numPages]);

  const goPrev = () => goTo(currentPage - 1);
  const goNext = () => goTo(currentPage + 1);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext();
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   goPrev();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentPage, numPages]);

  const pg = pages[currentPage];
  const qrForPage = (metadata?.qrCodes || []).filter(q => q.page === currentPage);
  const hsForPage = (metadata?.hotspots || []).filter(h => h.page === currentPage);

  // Fit scale: fill viewer area as much as possible
  const viewerRef = useRef(null);
  const [fitScale, setFitScale] = useState(1);
  useEffect(() => {
    if (!pg || !viewerRef.current) return;
    const rect = viewerRef.current.getBoundingClientRect();
    const padH = 48, padV = 48;
    const scaleX = (rect.width - padH) / pg.w;
    const scaleY = (rect.height - padV) / pg.h;
    setFitScale(Math.min(1, scaleX, scaleY));
  }, [pg, tocOpen]);

  const finalScale = fitScale * zoom;

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)' }}>{S.loadingPdf}</p>
      </div>
    );
  }

  if (!brochure) {
    return (
      <div className="loading-overlay">
        <div style={{ fontSize: '3rem', marginBottom: 12 }}>📄</div>
        <p style={{ color: 'var(--danger)', fontSize: '1rem' }}>{S.brochureNotFound}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 8 }}>
          {S.brochureNotFoundSub}
        </p>
      </div>
    );
  }

  return (
    <div className="viewer-page">
      {/* Toolbar */}
      <div className="viewer-toolbar">
        <Link to={`/brochure/${id}`} className="btn btn-ghost btn-sm">{S.backToViewer}</Link>
        <div className="toolbar-divider" />

        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setTocOpen(o => !o)}
          title={S.toggleToc}
        >
          ☰
        </button>

        <div className="viewer-title">{brochure.title}</div>

        {/* Zoom */}
        <div className="zoom-controls">
          <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}>−</button>
          <span className="zoom-val">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))}>+</button>
          <button onClick={() => setZoom(1)} title="Reset zoom" style={{ fontSize: '0.7rem' }}>↺</button>
        </div>

        <div className="toolbar-divider" />

        {/* Page input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input
            type="number"
            min={1}
            max={numPages}
            value={currentPage}
            onChange={e => goTo(parseInt(e.target.value, 10) || 1)}
            style={{
              width: 44, padding: '4px 6px', textAlign: 'center',
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 6, color: 'var(--text)', fontSize: '0.8rem',
            }}
          />
          <span className="viewer-page-info">{S.ofPages(numPages)}</span>
        </div>

        <div className="toolbar-divider" />

        <button className="btn btn-ghost btn-sm" onClick={goPrev} disabled={currentPage <= 1}>›</button>
        <button className="btn btn-ghost btn-sm" onClick={goNext} disabled={currentPage >= numPages}>‹</button>

      </div>

      {/* Body */}
      <div className="viewer-body">
        {/* TOC sidebar */}
        <div className={`viewer-toc-sidebar ${tocOpen ? '' : 'collapsed'}`}>
          <TOC
            toc={metadata?.toc || []}
            currentPage={currentPage}
            onNavigate={goTo}
          />
        </div>

        {/* Canvas area */}
        <div className="viewer-canvas-area" ref={viewerRef}>
          {pg ? (
            <div
              style={{
                position: 'relative',
                width: pg.w,
                height: pg.h,
                transform: `scale(${finalScale})`,
                transformOrigin: 'center center',
                transition: 'transform 0.2s',
                boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
                borderRadius: 2,
                flexShrink: 0,
              }}
            >
              <PageCanvas pgData={pg} style={{ display: 'block' }} />
              <HotspotLayer
                qrCodes={qrForPage}
                hotspots={hsForPage}
                canvasW={pg.w}
                canvasH={pg.h}
                onNavigate={goTo}
              />
              {/* Page number */}
              <div style={{
                position: 'absolute', bottom: 8, right: 12,
                fontSize: '0.65rem', color: 'rgba(0,0,0,0.3)',
                fontFamily: 'var(--font)', pointerEvents: 'none',
              }}>
                {currentPage}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div className="spinner" />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{S.renderingPage(currentPage)}</p>
            </div>
          )}

          {/* Navigation arrows (sides) */}
          <button
            className="nav-arrow left"
            onClick={goPrev}
            disabled={currentPage <= 1}
          >›</button>
          <button
            className="nav-arrow right"
            onClick={goNext}
            disabled={currentPage >= numPages}
          >‹</button>
        </div>
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
