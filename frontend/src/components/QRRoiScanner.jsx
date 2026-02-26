/**
 * QRRoiScanner – modal for manually scanning a selected area of a PDF page.
 *
 * Props:
 *  - brochureId   string
 *  - pdfUrl       string
 *  - pageCount    number
 *  - onAdded      (updatedQrCodes) => void
 *  - onClose      () => void
 */
import { useState, useEffect, useRef } from 'react';
import { loadPdf, renderPageInto } from '../utils/pdfLoader.js';
import { api } from '../utils/api.js';
import { S } from '../utils/strings.js';

export default function QRRoiScanner({ brochureId, pdfUrl, pageCount, onAdded, onClose }) {
  const [pdfDoc,    setPdfDoc]    = useState(null);
  const [page,      setPage]      = useState(1);
  const [rendering, setRendering] = useState(false);
  const [scanning,  setScanning]  = useState(false);
  const [drawing,   setDrawing]   = useState(false);
  const [startPt,   setStartPt]   = useState(null);
  const [rect,      setRect]      = useState(null);
  const [result,    setResult]    = useState(null);
  const [canvasDim, setCanvasDim] = useState({ w: 1, h: 1 });

  const displayRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    loadPdf(pdfUrl).then(setPdfDoc).catch(console.error);
  }, [pdfUrl]);

  useEffect(() => {
    if (!pdfDoc || !displayRef.current) return;
    setRect(null);
    setResult(null);
    setRendering(true);

    renderPageInto(pdfDoc, page, displayRef.current, 1.5).then(() => {
      const disp = displayRef.current;
      const ovl  = overlayRef.current;
      if (ovl && disp) {
        ovl.width  = disp.width;
        ovl.height = disp.height;
        setCanvasDim({ w: disp.width, h: disp.height });
      }
      setRendering(false);
    }).catch(console.error);
  }, [pdfDoc, page]);

  useEffect(() => {
    const ovl = overlayRef.current;
    if (!ovl) return;
    const ctx = ovl.getContext('2d');
    ctx.clearRect(0, 0, ovl.width, ovl.height);
    if (rect) {
      ctx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
      ctx.lineWidth   = 2;
      ctx.fillStyle   = 'rgba(255, 80, 80, 0.12)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  }, [rect]);

  const getPt = (e) => {
    const ovl = overlayRef.current;
    const r   = ovl.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (ovl.width  / r.width),
      y: (e.clientY - r.top)  * (ovl.height / r.height),
    };
  };

  const onMouseDown = (e) => { e.preventDefault(); setStartPt(getPt(e)); setDrawing(true); setResult(null); };
  const onMouseMove = (e) => {
    if (!drawing || !startPt) return;
    e.preventDefault();
    const pt = getPt(e);
    setRect({
      x: Math.min(startPt.x, pt.x), y: Math.min(startPt.y, pt.y),
      w: Math.abs(pt.x - startPt.x), h: Math.abs(pt.y - startPt.y),
    });
  };
  const onMouseUp = () => {
    if (!drawing) return;
    setDrawing(false);
    if (rect && (rect.w < 15 || rect.h < 15)) setRect(null);
  };

  const scanRoi = async () => {
    if (!rect) return;
    const roi = {
      x: rect.x / canvasDim.w, y: rect.y / canvasDim.h,
      w: rect.w / canvasDim.w, h: rect.h / canvasDim.h,
    };
    setScanning(true);
    try {
      const res = await api.scanRoi(brochureId, { page, roi });
      if (res.found) {
        setResult({ url: res.qr.url, format: res.qr.format, debug: res.debug });
        onAdded(res.qrCodes);
      } else {
        setResult({ type: 'not-found', debug: res.debug });
      }
    } catch (e) {
      setResult({ type: 'not-found', debug: { error: e.message } });
    } finally {
      setScanning(false);
    }
  };

  const goToPage = (n) => setPage(Math.max(1, Math.min(pageCount || 1, n)));

  const roiNorm = rect ? {
    x: (rect.x / canvasDim.w).toFixed(3), y: (rect.y / canvasDim.h).toFixed(3),
    w: (rect.w / canvasDim.w).toFixed(3), h: (rect.h / canvasDim.h).toFixed(3),
  } : null;

  const isFound    = result && result.url;
  const isNotFound = result && result.type === 'not-found';

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 780, width: '92vw', maxHeight: '92vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>{S.manualQrTitle}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>{S.closeBtn}</button>
        </div>

        {/* Page navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => goToPage(page - 1)} disabled={page <= 1}>›</button>
          <span style={{ fontSize: '0.9rem' }}>{S.pageLabel}</span>
          <input
            type="number"
            className="input"
            value={page}
            min={1}
            max={pageCount}
            onChange={e => { const v = parseInt(e.target.value, 10); if (v >= 1 && v <= pageCount) setPage(v); }}
            style={{ width: 60, textAlign: 'center' }}
          />
          <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{S.ofPages(pageCount)}</span>
          <button className="btn btn-secondary btn-sm" onClick={() => goToPage(page + 1)} disabled={page >= pageCount}>‹</button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginRight: 8 }}>
            {S.canvasPx(canvasDim.w, canvasDim.h)}
          </span>
        </div>

        {/* Canvas area */}
        <div style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', background: '#222', minHeight: 200 }}>
          {rendering && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', zIndex: 5, pointerEvents: 'none' }}>
              <div className="spinner" style={{ marginLeft: 8 }} /> {S.renderingPage(page)}
            </div>
          )}
          <canvas ref={displayRef} style={{ display: 'block', width: '100%' }} />
          <canvas
            ref={overlayRef}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'crosshair', display: rendering ? 'none' : 'block' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
          />
        </div>

        {roiNorm && (
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4, fontFamily: 'monospace', direction: 'ltr', textAlign: 'left' }}>
            {S.roiNormLbl(roiNorm.x, roiNorm.y, roiNorm.w, roiNorm.h)}
          </p>
        )}

        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 6, marginBottom: 12 }}>
          {S.roiInstructions}
        </p>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={scanRoi} disabled={!rect || scanning || rendering}>
            {scanning ? S.scanningRoi : S.scanSelected}
          </button>
          {rect && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setRect(null); setResult(null); }}>
              {S.clearRoi}
            </button>
          )}
        </div>

        {/* Result: found */}
        {isFound && (
          <div style={{ marginTop: 12, padding: 12, background: 'rgba(0,200,100,0.08)', borderRadius: 4, border: '1px solid rgba(0,200,100,0.3)' }}>
            <strong style={{ color: '#4caf7d' }}>{S.barcodeFound}</strong>{' '}
            <span style={{ fontSize: '0.85rem' }}>
              {result.format}: <code style={{ wordBreak: 'break-all', direction: 'ltr' }}>{result.url}</code>
            </span>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
              {S.addedToQrList}
            </p>
            {result.debug && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 2, fontFamily: 'monospace', direction: 'ltr', textAlign: 'left' }}>
                {S.debugInfo(result.debug.pagePx?.w, result.debug.pagePx?.h, result.debug.foundAtAngle, result.debug.roiPng)}
              </p>
            )}
          </div>
        )}

        {/* Result: not found */}
        {isNotFound && (
          <div style={{ marginTop: 12, padding: 12, background: 'rgba(220,60,60,0.08)', borderRadius: 4, border: '1px solid rgba(220,60,60,0.3)' }}>
            <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
              {S.barcodeNotFound}
            </span>
            {result.debug && result.debug.roiPng && (
              <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 6, fontFamily: 'monospace', direction: 'ltr', textAlign: 'left' }}>
                {S.debugNotFound(result.debug.pagePx?.w, result.debug.pagePx?.h, result.debug.scale, result.debug.roiPx?.x, result.debug.roiPx?.y, result.debug.roiPx?.w, result.debug.roiPx?.h)}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
