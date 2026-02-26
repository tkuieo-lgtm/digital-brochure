/**
 * TocDrawer – RTL slide-in TOC panel for the ViewerFlip.
 *
 * Always rendered in DOM so CSS transform produces smooth slide-in AND slide-out.
 *
 * Props:
 *   open        boolean
 *   onClose     () => void
 *   items       Array<{ title: string, page: number }>
 *   currentPage number
 *   onSelect    (page: number) => void
 */
import { useEffect } from 'react';
import { S } from '../utils/strings.js';

function logEvent(type, data = {}) {
  console.log(JSON.stringify({ type, ...data, timestamp: Date.now() }));
}

export default function TocDrawer({ open, onClose, items = [], currentPage, onSelect }) {
  // ── Body scroll lock ──────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  // ── ESC key ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop — fades in/out independently of the panel */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.35)',
          zIndex: 40,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
        onClick={onClose}
      />

      {/* Panel — slides in from the right (RTL natural side) */}
      <div
        className="toc-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={S.tocTitle}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          background: 'var(--bg)',
          borderLeft: '1px solid var(--border)',
          padding: '24px',
          paddingTop: 'max(24px, env(safe-area-inset-top, 24px))',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom, 24px))',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          zIndex: 41,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s ease',
          willChange: 'transform',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
            {S.tocTitle}
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Items */}
        {items.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {S.noTocEntries}
          </p>
        ) : (
          <div>
            {items.map((entry, i) => {
              const isActive = currentPage === entry.page;
              return (
                <div
                  key={i}
                  onClick={() => { logEvent('toc_click', { page: entry.page, title: entry.title }); onSelect(entry.page); }}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '1rem',
                    padding: '12px 0',
                    borderBottom: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? 'var(--accent)' : 'var(--text)',
                    transition: 'opacity 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = '0.7'; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                >
                  <span>{entry.title}</span>
                  <span style={{
                    fontSize: '0.78rem',
                    color: 'var(--text-muted)',
                    flexShrink: 0,
                    marginRight: 4,
                  }}>
                    {S.pageLabel} {entry.page}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
