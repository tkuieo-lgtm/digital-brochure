import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';
import { loadPdf, renderPage } from '../utils/pdfLoader.js';
import { S } from '../utils/strings.js';

function BrochureRow({ b, onDelete }) {
  const canvasRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdf = await loadPdf(api.pdfUrl(b.filename));
        const { canvas } = await renderPage(pdf, 1, 0.25);
        if (!cancelled && canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          canvasRef.current.width = canvas.width;
          canvasRef.current.height = canvas.height;
          ctx.drawImage(canvas, 0, 0);
        }
      } catch {/* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [b.filename]);

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString('he-IL', { month: 'short', day: 'numeric', year: 'numeric' });

  const formatSize = (bytes) => {
    if (!bytes) return '—';
    if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <tr>
      <td style={{ width: 48 }}>
        <div style={{ width: 36, height: 48, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
          <canvas ref={canvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      </td>
      <td>
        <div style={{ fontWeight: 600 }}>{b.title}</div>
        {b.description && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>{b.description}</div>
        )}
      </td>
      <td>{b.pageCount || '—'}</td>
      <td>{b.qrCodes?.length || 0}</td>
      <td>{b.hotspots?.length || 0}</td>
      <td>{formatSize(b.fileSize)}</td>
      <td>{formatDate(b.createdAt)}</td>
      <td>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/view/${b.id}`)}>{S.viewBtnTbl}</button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate(`/admin/${b.id}`)}>{S.editBtnTbl}</button>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (confirm(S.confirmDelete(b.title))) {
                api.deleteBrochure(b.id).then(() => onDelete(b.id));
              }
            }}
          >
            {S.deleteBtnTbl}
          </button>
        </div>
      </td>
    </tr>
  );
}

function UploadModal({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const handleFile = (f) => {
    if (f?.type === 'application/pdf') {
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
    } else {
      setError(S.pdfOnly);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) { setError(S.selectPdf); return; }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      fd.append('title', title || file.name.replace(/\.pdf$/i, ''));
      fd.append('description', desc);
      const created = await api.createBrochure(fd);
      onCreated(created);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{S.uploadTitle}</h2>
        <form onSubmit={handleSubmit}>
          <div
            className={`drop-zone ${dragging ? 'drag-over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          >
            <div className="drop-zone-icon">{file ? '✅' : '📄'}</div>
            <div className="drop-zone-text">
              {file ? file.name : S.dropZoneText}
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])} />

          <div className="form-field">
            <label className="label">{S.labelTitleField}</label>
            <input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder={S.labelTitleField} />
          </div>
          <div className="form-field">
            <label className="label">{S.labelDescField}</label>
            <textarea className="input" value={desc} onChange={e => setDesc(e.target.value)}
              rows={2} style={{ resize: 'vertical' }} />
          </div>

          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: 12 }}>{error}</p>}

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>{S.cancelUpload}</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? S.uploadingBtn : S.uploadBtn}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Admin() {
  const [brochures, setBrochures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.listBrochures()
      .then(setBrochures)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="admin-page">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">{S.brand}</Link>
        <div className="navbar-actions">
          <Link to="/" className="btn btn-ghost btn-sm">{S.publicViewBtn}</Link>
        </div>
      </nav>

      <div className="admin-container">
        <div className="admin-header">
          <h1>{S.adminPanel}</h1>
          <button className="btn btn-primary" onClick={() => setShowUpload(true)}>
            {S.uploadPdf}
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <div className="spinner" />
          </div>
        ) : brochures.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 60 }}>
            <p style={{ fontSize: '3rem', marginBottom: 16 }}>📄</p>
            <h2 style={{ marginBottom: 8 }}>{S.noBrochures}</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>{S.uploadFirst}</p>
            <button className="btn btn-primary" onClick={() => setShowUpload(true)}>{S.uploadPdf}</button>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{S.colThumb}</th>
                    <th>{S.colTitleTh}</th>
                    <th>{S.colPagesTh}</th>
                    <th>{S.colQrTh}</th>
                    <th>{S.colHsTh}</th>
                    <th>{S.colSizeTh}</th>
                    <th>{S.colCreatedTh}</th>
                    <th>{S.colActionsTh}</th>
                  </tr>
                </thead>
                <tbody>
                  {brochures.map(b => (
                    <BrochureRow
                      key={b.id}
                      b={b}
                      onDelete={(del) => setBrochures(prev => prev.filter(x => x.id !== del))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onCreated={(b) => {
            setBrochures(prev => [b, ...prev]);
            setShowUpload(false);
            navigate(`/admin/${b.id}`);
          }}
        />
      )}
    </div>
  );
}
