import { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api.js';
import { loadPdf, renderPage } from '../utils/pdfLoader.js';
import { S } from '../utils/strings.js';

function BrochureCover({ brochure }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdf = await loadPdf(api.pdfUrl(brochure.filename));
        const { canvas } = await renderPage(pdf, 1, 0.4);
        if (!cancelled && canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d');
          canvasRef.current.width = canvas.width;
          canvasRef.current.height = canvas.height;
          ctx.drawImage(canvas, 0, 0);
        }
      } catch {/* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [brochure.filename]);

  return (
    <div className="brochure-card-cover">
      <canvas ref={canvasRef} />
      {!canvasRef.current?.width && <span className="cover-placeholder">📄</span>}
    </div>
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
    if (f && f.type === 'application/pdf') {
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
      setError('');
    } else {
      setError(S.pdfOnly);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
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
            onDrop={handleDrop}
          >
            <div className="drop-zone-icon">{file ? '✅' : '📄'}</div>
            <div className="drop-zone-text">
              {file ? file.name : S.dropZoneText}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf"
            style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files[0])}
          />

          <div className="form-field">
            <label className="label">{S.labelTitleField}</label>
            <input
              className="input"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={S.labelTitleField}
            />
          </div>
          <div className="form-field">
            <label className="label">{S.labelDescField}</label>
            <textarea
              className="input"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={3}
              style={{ resize: 'vertical' }}
            />
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

export default function Home() {
  const [brochures, setBrochures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.listBrochures()
      .then(setBrochures)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (iso) =>
    new Date(iso).toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric' });

  return (
    <div className="home-page">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">{S.brand}</Link>
        <div className="navbar-actions">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/admin')}>
            {S.adminBtn}
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowUpload(true)}>
            {S.uploadPdf}
          </button>
        </div>
      </nav>

      <div className="home-hero">
        <h1>{S.homeHeroTitle}</h1>
        <p>{S.homeHeroSub}</p>
        <button className="btn btn-primary btn-lg" onClick={() => setShowUpload(true)}>
          {S.uploadFirst2}
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <div className="spinner" />
        </div>
      ) : (
        <div className="home-grid">
          {brochures.length === 0 && (
            <div className="empty-state">
              <h2>{S.noBrochures}</h2>
              <p>{S.uploadFirst}</p>
            </div>
          )}
          {brochures.map(b => (
            <Link key={b.id} to={`/brochure/${b.id}`} className="brochure-card">
              <BrochureCover brochure={b} />
              <div className="brochure-card-body">
                <div className="brochure-card-title">{b.title}</div>
                {b.description && (
                  <div className="brochure-card-meta" style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    {b.description}
                  </div>
                )}
                <div className="brochure-card-meta">
                  {b.pageCount > 0 ? `${b.pageCount} עמודים · ` : ''}
                  {formatDate(b.createdAt)}
                </div>
              </div>
              <div className="brochure-card-footer">
                <span className="badge badge-accent">PDF</span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{S.openBrochure}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onCreated={(b) => {
            setBrochures(prev => [b, ...prev]);
            setShowUpload(false);
            navigate(`/brochure/${b.id}`);
          }}
        />
      )}
    </div>
  );
}
