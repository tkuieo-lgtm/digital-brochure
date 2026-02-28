/**
 * ShareDownloadBar – Download button + Share button.
 *
 * Share strategy:
 *   1. navigator.share  → native OS share sheet (mobile / modern desktop)
 *   2. Fallback modal   → Copy link / WhatsApp / Email
 *
 * Props:
 *   brochure  { title, description, filename }
 *   viewUrl   string — the public /view/:id URL to share
 */
import { useState } from 'react';
import { api } from '../utils/api.js';
import { S } from '../utils/strings.js';
import { track } from '../utils/analyticsClient.js';

export default function ShareDownloadBar({ brochure, viewUrl }) {
  const [showModal, setShowModal] = useState(false);
  const [copied,    setCopied]    = useState(false);

  const handleShare = async () => {
    track('share_click', { url: viewUrl });
    if (navigator.share) {
      try {
        await navigator.share({
          title: brochure.title,
          text:  S.shareText(brochure.title),
          url:   viewUrl,
        });
        return; // native sheet handled it
      } catch { /* user cancelled or API unavailable — fall through */ }
    }
    setShowModal(true);
  };

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(viewUrl); } catch { /* ignore */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const waLink   = `https://wa.me/?text=${encodeURIComponent(S.shareText(brochure.title) + ' ' + viewUrl)}`;
  const mailLink = `mailto:?subject=${encodeURIComponent(brochure.title)}&body=${encodeURIComponent(S.shareText(brochure.title) + '\n' + viewUrl)}`;

  return (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <a
          href={brochure.pdfUrl}
          download
          className="btn btn-ghost btn-sm"
          onClick={() => track('download_click', { filename: brochure.filename })}
        >
          {S.downloadBtn}
        </a>
        <button className="btn btn-ghost btn-sm" onClick={handleShare}>
          {S.shareBtn}
        </button>
      </div>

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
    </>
  );
}
