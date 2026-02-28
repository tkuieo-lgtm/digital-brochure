import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';
import { loadPdf, renderPage } from '../utils/pdfLoader.js';
import { S } from '../utils/strings.js';
import { loadCachedAppearance, applyAppearance, loadAndApplyAppearance } from '../utils/appearanceManager.js';
import { track, sessionStart, sessionEnd } from '../utils/analyticsClient.js';

export default function Cover() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [brochure,   setBrochure]   = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [ready,      setReady]      = useState(false);
  const [appearance, setAppearance] = useState(() => loadCachedAppearance(id) ?? { mode: 'auto' });
  const [showModal,  setShowModal]  = useState(false);
  const [copied,     setCopied]     = useState(false);
  const canvasRef   = useRef(null);
  const bgCanvasRef = useRef(null);

  const shareUrl = `${window.location.origin}/brochure/${id}`;

  const openViewer = useCallback(() => {
    track('open_viewer_click', { brochureId: id });
    navigate(`/view/${id}`);
  }, [navigate, id]);

  // Enter key → open viewer
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Enter') openViewer(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openViewer]);

  // ── Session tracking ──────────────────────────────────────────────────────
  useEffect(() => {
    sessionStart(id, 'cover');
    const onUnload = () => sessionEnd(id);
    const onHide   = () => { if (document.visibilityState === 'hidden') sessionEnd(id); };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [id]);

  // ── Apply per-brochure appearance (sync before paint) ────────────────────
  useLayoutEffect(() => applyAppearance(appearance, 'cover'), [appearance]);

  useEffect(() => {
    api.getBrochure(id)
      .then(b => {
        setBrochure(b);
        setLoading(false);
        return loadPdf(b.pdfUrl);
      })
      .then(pdf => {
        loadAndApplyAppearance(id, pdf, setAppearance).catch(() => {});
        return renderPage(pdf, 1, 1.2);
      })
      .then(({ canvas }) => {
        if (canvasRef.current) {
          canvasRef.current.width  = canvas.width;
          canvasRef.current.height = canvas.height;
          canvasRef.current.getContext('2d').drawImage(canvas, 0, 0);
        }
        if (bgCanvasRef.current) {
          bgCanvasRef.current.width  = canvas.width;
          bgCanvasRef.current.height = canvas.height;
          bgCanvasRef.current.getContext('2d').drawImage(canvas, 0, 0);
        }
        setReady(true);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, [id]);

  // ── Share handlers ────────────────────────────────────────────────────────
  const handleShare = async () => {
    track('share_click', { brochureId: id, url: shareUrl });
    if (navigator.share) {
      try {
        await navigator.share({
          title: brochure?.title ?? '',
          text:  S.shareText(brochure?.title ?? ''),
          url:   shareUrl,
        });
        return;
      } catch { /* cancelled or unavailable – fall through to modal */ }
    }
    setShowModal(true);
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shareUrl); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

  const waLink   = `https://wa.me/?text=${encodeURIComponent(S.shareText(brochure.title) + ' ' + shareUrl)}`;
  const mailLink = `mailto:?subject=${encodeURIComponent(brochure.title)}&body=${encodeURIComponent(S.shareText(brochure.title) + '\n' + shareUrl)}`;

  return (
    <div style={{ minHeight: '100vh', background: 'transparent', position: 'relative', overflow: 'hidden', zIndex: 1 }}>
      {/* Blurred PDF preview — full-page subtle background */}
      <canvas
        ref={bgCanvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          filter: 'blur(48px) saturate(0.6)',
          opacity: 0.18,
          pointerEvents: 'none',
          transform: 'scale(1.08)',
        }}
      />

      <div className="cover-page" style={{ position: 'relative', zIndex: 1 }}>
        <div className="cover-book">
          <div className="cover-spine" />
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>

        <div
          className="cover-info"
          style={{
            opacity:   ready ? 1 : 0,
            transform: ready ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 0.45s ease, transform 0.45s ease',
          }}
        >
          <h1 className="cover-title">{brochure.title}</h1>
          {brochure.description && (
            <p className="cover-desc">{brochure.description}</p>
          )}

          {/* ── 3-button action row: [שתף] | [פתחו את החוברת] | [הורדה] ── */}
          <div className="cover-actions">
            <button className="btn btn-secondary cover-action-side" onClick={handleShare}>
              {S.shareBtn}
            </button>

            <button
              className="btn btn-primary cover-action-main"
              onClick={openViewer}
              style={{ boxShadow: '0 6px 24px var(--accent-glow)' }}
            >
              {S.openBrochureBtn}
            </button>

            <a
              href={brochure.pdfUrl}
              download
              className="btn btn-secondary cover-action-side"
              onClick={() => track('download_click', { brochureId: id })}
            >
              {S.downloadBtn}
            </a>
          </div>

          {brochure.pageCount > 0 && (
            <p style={{ marginTop: 20, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              {S.coverPageCount(brochure.pageCount)}
            </p>
          )}
        </div>
      </div>

      {/* Share modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div
            className="modal"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: 340 }}
          >
            <h2 style={{ marginBottom: 16, fontSize: '1.05rem' }}>{S.shareTitle}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn btn-secondary" onClick={copyLink}>
                {copied ? S.linkCopied : S.copyLinkBtn}
              </button>
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary"
                style={{ textAlign: 'center' }}
              >
                {S.shareWhatsapp}
              </a>
              <a
                href={mailLink}
                className="btn btn-secondary"
                style={{ textAlign: 'center' }}
              >
                {S.shareEmail}
              </a>
            </div>
            <div className="modal-footer" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>
                {S.shareClose}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
