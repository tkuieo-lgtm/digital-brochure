/**
 * HotspotEditor – lets admin draw hotspot rectangles on a PDF page.
 * Props:
 *  - canvas      HTMLCanvasElement of the rendered page (for display)
 *  - hotspots    existing hotspots for this page
 *  - onAdd       (hotspot) => void   hotspot = { label, action, location }
 *  - onDelete    (id) => void
 *  - pdfDoc      pdfjs doc (optional) – enables page thumbnail picker
 *  - pageCount   number (optional)
 */
import { useRef, useState, useEffect } from 'react';
import { S } from '../utils/strings.js';
import { renderPage } from '../utils/pdfLoader.js';

// ── Page thumbnail picker modal ─────────────────────────────────────────
function PagePickerModal({ pdfDoc, pageCount, onPick, onClose }) {
  const [thumbs, setThumbs] = useState({});

  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    (async () => {
      for (let p = 1; p <= pageCount; p++) {
        if (cancelled) break;
        const { canvas } = await renderPage(pdfDoc, p, 0.2);
        if (!cancelled) setThumbs(prev => ({ ...prev, [p]: canvas }));
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, pageCount]);

  return (
    <div className="modal-backdrop" style={{ zIndex: 1100 }}>
      <div className="modal" style={{ maxWidth: 560, width: '96vw', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{S.pickPageTitle}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
          gap: 10,
        }}>
          {Array.from({ length: pageCount }, (_, i) => i + 1).map(p => (
            <div
              key={p}
              onClick={() => onPick(p)}
              style={{
                cursor: 'pointer',
                border: '2px solid var(--border)',
                borderRadius: 6,
                overflow: 'hidden',
                background: '#fff',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{ width: '100%', aspectRatio: '0.7', background: '#f3f3f3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {thumbs[p] ? (
                  <canvas
                    ref={el => {
                      if (el && thumbs[p]) {
                        el.width  = thumbs[p].width;
                        el.height = thumbs[p].height;
                        el.getContext('2d').drawImage(thumbs[p], 0, 0);
                      }
                    }}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                  />
                ) : (
                  <div className="spinner" style={{ width: 20, height: 20 }} />
                )}
              </div>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '3px 0' }}>
                {S.pageLabel} {p}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main HotspotEditor ─────────────────────────────────────────────────
export default function HotspotEditor({ canvas, hotspots = [], onAdd, onDelete, pdfDoc, pageCount }) {
  const displayRef  = useRef(null);
  const overlayRef  = useRef(null);
  const [drawing,        setDrawing]        = useState(false);
  const [startPt,        setStartPt]        = useState(null);
  const [rect,           setRect]           = useState(null);
  const [showModal,      setShowModal]      = useState(false);
  const [showPagePicker, setShowPagePicker] = useState(false);
  const [form,           setForm]           = useState({ label: '', actionType: 'page', actionValue: '' });

  useEffect(() => {
    if (!canvas || !displayRef.current) return;
    const el = displayRef.current;
    el.width  = canvas.width;
    el.height = canvas.height;
    el.getContext('2d').drawImage(canvas, 0, 0);
  }, [canvas]);

  const getPt = (e) => {
    const el = displayRef.current;
    const r  = el.getBoundingClientRect();
    const scaleX = el.width  / r.width;
    const scaleY = el.height / r.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - r.left) * scaleX,
      y: (clientY - r.top)  * scaleY,
    };
  };

  useEffect(() => {
    const el = overlayRef.current;
    if (!el || !canvas) return;
    el.width  = canvas.width;
    el.height = canvas.height;
    const ctx = el.getContext('2d');
    ctx.clearRect(0, 0, el.width, el.height);

    hotspots.forEach(hs => {
      const { x, y, w, h } = hs.location;
      ctx.strokeStyle = 'rgba(124, 107, 240, 0.85)';
      ctx.lineWidth   = 2;
      ctx.fillStyle   = 'rgba(124, 107, 240, 0.12)';
      ctx.fillRect(x * el.width, y * el.height, w * el.width, h * el.height);
      ctx.strokeRect(x * el.width, y * el.height, w * el.width, h * el.height);

      ctx.fillStyle = 'rgba(124, 107, 240, 0.9)';
      ctx.font = `${Math.max(11, el.width * 0.015)}px sans-serif`;
      ctx.fillText(hs.label, x * el.width + 4, y * el.height + Math.max(14, el.height * 0.02));
    });

    if (rect) {
      ctx.strokeStyle = 'rgba(240, 160, 64, 0.9)';
      ctx.lineWidth   = 2;
      ctx.fillStyle   = 'rgba(240, 160, 64, 0.12)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }
  }, [hotspots, canvas, rect]);

  const onMouseDown = (e) => { e.preventDefault(); setStartPt(getPt(e)); setDrawing(true); };
  const onMouseMove = (e) => {
    if (!drawing || !startPt) return;
    e.preventDefault();
    const pt = getPt(e);
    setRect({
      x: Math.min(startPt.x, pt.x), y: Math.min(startPt.y, pt.y),
      w: Math.abs(pt.x - startPt.x), h: Math.abs(pt.y - startPt.y),
    });
  };
  const onMouseUp = (e) => {
    if (!drawing || !rect) { setDrawing(false); return; }
    e.preventDefault();
    setDrawing(false);
    if (rect.w < 10 || rect.h < 10) { setRect(null); return; }
    setShowModal(true);
  };

  const saveHotspot = () => {
    if (!rect || !canvas) return;
    onAdd({
      label:    form.label || 'אזור',
      action:   { type: form.actionType, value: form.actionValue },
      location: {
        x: rect.x / canvas.width,  y: rect.y / canvas.height,
        w: rect.w / canvas.width,  h: rect.h / canvas.height,
      },
    });
    setRect(null);
    setShowModal(false);
    setForm({ label: '', actionType: 'page', actionValue: '' });
  };

  const canvasStyle = { width: '100%', display: 'block', cursor: 'crosshair', userSelect: 'none' };

  return (
    <>
      <div className="hotspot-canvas-wrap" style={{ position: 'relative' }}>
        <canvas ref={displayRef} style={canvasStyle} />
        <canvas
          ref={overlayRef}
          style={{ ...canvasStyle, position: 'absolute', inset: 0, height: '100%' }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        />
      </div>

      {/* Hotspot list */}
      <div style={{ marginTop: 16 }}>
        {hotspots.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '16px 0' }}>
            {S.drawHint}
          </p>
        )}
        {hotspots.map(hs => (
          <div key={hs.id} className="hotspot-list-item">
            <div>
              <div className="hotspot-list-label">{hs.label}</div>
              <div className="hotspot-list-action">
                {hs.action.type === 'page'
                  ? S.hotspotToPage(hs.action.value)
                  : `🔗 ${hs.action.value}`}
              </div>
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(hs.id)}>✕</button>
          </div>
        ))}
      </div>

      {/* Configure hotspot modal */}
      {showModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{S.configHotspot}</h2>

            <div className="form-field">
              <label className="label">{S.hotspotLabel}</label>
              <input
                className="input"
                value={form.label}
                onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                placeholder={S.hotspotLabelPh}
                autoFocus
              />
            </div>

            <div className="form-field">
              <label className="label">{S.hotspotAction}</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                <button
                  className={`btn ${form.actionType === 'page' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={() => setForm(f => ({ ...f, actionType: 'page', actionValue: '' }))}
                >
                  {S.goToPage}
                </button>
                <button
                  className={`btn ${form.actionType === 'url' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                  onClick={() => setForm(f => ({ ...f, actionType: 'url', actionValue: '' }))}
                >
                  {S.openUrl}
                </button>
              </div>

              {form.actionType === 'page' ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    className="input"
                    type="number"
                    value={form.actionValue}
                    onChange={e => setForm(f => ({ ...f, actionValue: e.target.value }))}
                    placeholder={S.pageNumberPh}
                    min={1}
                    style={{ flex: 1 }}
                  />
                  {pdfDoc && pageCount > 0 && (
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setShowPagePicker(true)}
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {S.pickPageBtn}
                    </button>
                  )}
                </div>
              ) : (
                <input
                  className="input"
                  type="url"
                  value={form.actionValue}
                  onChange={e => setForm(f => ({ ...f, actionValue: e.target.value }))}
                  placeholder={S.urlPh}
                  style={{ direction: 'ltr', textAlign: 'left' }}
                />
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => { setShowModal(false); setRect(null); }}>
                {S.cancelBtn}
              </button>
              <button className="btn btn-primary" onClick={saveHotspot} disabled={!form.actionValue}>
                {S.saveHotspot}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Page thumbnail picker */}
      {showPagePicker && pdfDoc && (
        <PagePickerModal
          pdfDoc={pdfDoc}
          pageCount={pageCount}
          onPick={(p) => {
            setForm(f => ({ ...f, actionValue: String(p) }));
            setShowPagePicker(false);
          }}
          onClose={() => setShowPagePicker(false)}
        />
      )}
    </>
  );
}
