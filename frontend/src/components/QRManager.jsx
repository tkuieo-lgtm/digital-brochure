/**
 * QRManager – displays and edits detected QR codes for a brochure.
 *
 * Props:
 *  - brochureId  string
 *  - qrCodes     array of { id, page, url, originalUrl, overrideUrl, overrideImageUrl, location }
 *  - onChange    (updatedQrCodes) => void
 *
 * Note: Preview is now a global button in BrochureAdmin navbar.
 */
import { useState } from 'react';
import { api } from '../utils/api.js';
import { S } from '../utils/strings.js';
import QRRoiScanner from './QRRoiScanner.jsx';

// ── Edit / Override modal ──────────────────────────────────────────────────
function QREditModal({ brochureId, qr, onSaved, onClose }) {
  const [url,     setUrl]     = useState(qr.overrideUrl || qr.url);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [preview, setPreview] = useState(qr.overrideImageUrl || null);

  const save = async () => {
    const trimmed = url.trim();
    if (!trimmed) { setError('כתובת לא יכולה להיות ריקה'); return; }
    setSaving(true);
    setError('');
    try {
      const { qr: updated, qrCodes } = await api.patchQr(brochureId, qr.id, { url: trimmed });
      setPreview(updated.overrideImageUrl);
      onSaved(qrCodes);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 480, width: '92vw' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{S.editQrTitle(qr.page)}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="form-field">
          <label className="label">{S.targetUrl}</label>
          <input
            className="input"
            value={url}
            onChange={e => setUrl(e.target.value)}
            autoFocus
            style={{ fontSize: '0.85rem', direction: 'ltr', textAlign: 'left' }}
          />
          {qr.originalUrl && qr.originalUrl !== url && (
            <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginTop: 4, direction: 'ltr', textAlign: 'left' }}>
              {S.originalLbl}{qr.originalUrl}
            </p>
          )}
        </div>

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginBottom: 8 }}>{error}</p>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={saving}
              style={{ width: '100%' }}
            >
              {saving ? S.generating : S.saveGenerate}
            </button>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
              {S.qrNote}
            </p>
          </div>

          {preview && (
            <div style={{ textAlign: 'center', flexShrink: 0 }}>
              <img
                src={preview}
                alt="QR"
                style={{ width: 96, height: 96, imageRendering: 'pixelated', border: '1px solid var(--border)', borderRadius: 4 }}
              />
              <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>{S.previewLbl}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Single QR row ──────────────────────────────────────────────────────────
function QRRow({ brochureId, qr, onChange, onDelete }) {
  const [showEdit, setShowEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const del = async () => {
    if (!confirm(S.deleteQrConfirm)) return;
    setDeleting(true);
    try {
      const updated = await api.deleteQr(brochureId, qr.id);
      onDelete(updated.qrCodes);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <tr>
        <td>
          <span className="badge badge-accent">ע.{qr.page}</span>
          {qr.source === 'manual' && (
            <span className="badge" style={{ marginRight: 4, background: 'rgba(240,160,64,0.2)', color: 'var(--warning, #f0a040)', fontSize: '0.65rem' }}>ידני</span>
          )}
        </td>
        <td>
          {qr.overrideImageUrl ? (
            <img
              src={qr.overrideImageUrl}
              alt="QR"
              style={{ width: 40, height: 40, imageRendering: 'pixelated', borderRadius: 2 }}
            />
          ) : (
            <div className="qr-thumbnail">{qr.format || 'QR'}</div>
          )}
        </td>
        <td style={{ maxWidth: 260 }}>
          <a
            href={qr.overrideUrl || qr.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '0.8rem', wordBreak: 'break-all', color: 'var(--accent-light)', direction: 'ltr', textAlign: 'left', display: 'block' }}
          >
            {qr.overrideUrl || qr.url}
          </a>
          {qr.overrideUrl && qr.originalUrl && qr.overrideUrl !== qr.originalUrl && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: 2, direction: 'ltr', textAlign: 'left' }}>
              {S.originalLbl}{qr.originalUrl}
            </div>
          )}
          {!qr.overrideUrl && qr.originalUrl && qr.originalUrl !== qr.url && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: 2, direction: 'ltr', textAlign: 'left' }}>
              {S.originalLbl}{qr.originalUrl}
            </div>
          )}
        </td>
        <td>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowEdit(true)}>{S.editQrBtn}</button>
            <button className="btn btn-danger btn-sm" onClick={del} disabled={deleting}>✕</button>
          </div>
        </td>
      </tr>

      {showEdit && (
        <QREditModal
          brochureId={brochureId}
          qr={qr}
          onSaved={(qrCodes) => { onChange(qrCodes); setShowEdit(false); }}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

// ── Main QRManager ─────────────────────────────────────────────────────────
export default function QRManager({ brochureId, pdfUrl, pageCount, qrCodes = [], onChange }) {
  const [scanning,   setScanning]   = useState(false);
  const [scanError,  setScanError]  = useState('');
  const [showManual, setShowManual] = useState(false);

  const handleRescan = async () => {
    setScanning(true);
    setScanError('');
    try {
      const updated = await api.rescanQr(brochureId);
      onChange(updated.qrCodes);
    } catch (e) {
      setScanError(e.message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="qr-manager">
      <div className="section-header">
        <div>
          <h2>{S.qrTitle}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            {scanning
              ? S.qrScanning
              : qrCodes.length === 0
                ? S.qrNone
                : S.qrCount(qrCodes.length)}
          </p>
          {scanError && (
            <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: 4 }}>{scanError}</p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={handleRescan} disabled={scanning}>
            {scanning ? S.scanning : S.scanNow}
          </button>
          {pdfUrl && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowManual(true)}>
              {S.manualAssist}
            </button>
          )}
        </div>
      </div>

      {qrCodes.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ fontSize: '2rem', marginBottom: 12 }}>🔍</p>
          <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
            {S.qrEmptyMsg}<br />{S.qrEmptySub}
          </p>
          <button className="btn btn-primary" onClick={handleRescan} disabled={scanning}>
            {scanning ? S.scanning : S.scanNow}
          </button>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{S.colPage}</th>
                <th>{S.colQr}</th>
                <th>{S.colUrl}</th>
                <th>{S.colActions}</th>
              </tr>
            </thead>
            <tbody>
              {qrCodes.map(qr => (
                <QRRow
                  key={qr.id}
                  brochureId={brochureId}
                  qr={qr}
                  onChange={onChange}
                  onDelete={onChange}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showManual && pdfUrl && (
        <QRRoiScanner
          brochureId={brochureId}
          pdfUrl={pdfUrl}
          pageCount={pageCount || 1}
          onAdded={(updatedQrCodes) => onChange(updatedQrCodes)}
          onClose={() => setShowManual(false)}
        />
      )}
    </div>
  );
}
