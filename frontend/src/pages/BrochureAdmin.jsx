import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api.js';
import { track } from '../utils/analyticsClient.js';
import { S } from '../utils/strings.js';
import { loadPdf, renderPage } from '../utils/pdfLoader.js';
import HotspotEditor from '../components/HotspotEditor.jsx';
import QRManager from '../components/QRManager.jsx';
import BrochurePreviewModal from '../components/BrochurePreviewModal.jsx';
import ThemePanel from '../components/ThemePanel.jsx';

const SCALE = 1.5;

function Toast({ msg, type, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2500);
    return () => clearTimeout(t);
  }, [onDone]);
  return <div className={`toast ${type}`}>{msg}</div>;
}

// ── TOC Editor ────────────────────────────────────────────────────────────
function TocEditor({ toc, onSave, pdfDoc, pageCount }) {
  const [entries,     setEntries]     = useState(toc);
  const [saving,      setSaving]      = useState(false);
  const [suggesting,  setSuggesting]  = useState(false);
  const [suggestErr,  setSuggestErr]  = useState('');

  useEffect(() => setEntries(toc), [toc]);

  const add    = () => setEntries(e => [...e, { title: '', page: 1 }]);
  const remove = (i) => setEntries(e => e.filter((_, idx) => idx !== i));
  const update = (i, field, val) =>
    setEntries(e => e.map((entry, idx) => idx === i ? { ...entry, [field]: val } : entry));

  const save = async () => {
    setSaving(true);
    await onSave(entries.filter(e => e.title));
    setSaving(false);
  };

  const autoSuggest = async () => {
    if (!pdfDoc) return;
    setSuggesting(true);
    setSuggestErr('');
    try {
      // Extract text items from every page, collect (text, fontSize, pageNum)
      const candidates = [];
      for (let p = 1; p <= pageCount; p++) {
        const page = await pdfDoc.getPage(p);
        const content = await page.getTextContent();
        for (const item of content.items) {
          if (!item.str?.trim()) continue;
          // transform[0] and transform[3] give approximate font size
          const fontSize = Math.abs(item.transform?.[3] ?? item.height ?? 0);
          candidates.push({ text: item.str.trim(), fontSize, page: p });
        }
      }
      if (candidates.length === 0) { setSuggestErr(S.autoSuggestNone); return; }

      // Compute median font size — headings are larger
      const sizes = candidates.map(c => c.fontSize).sort((a, b) => a - b);
      const median = sizes[Math.floor(sizes.length / 2)] || 10;
      const threshold = median * 1.25;

      // Keep candidates larger than threshold, short enough to be a heading (≤60 chars)
      const headings = candidates.filter(c => c.fontSize >= threshold && c.text.length <= 60);

      // Deduplicate by page (keep first heading per page)
      const seen = new Set();
      const unique = [];
      for (const h of headings) {
        if (!seen.has(h.page)) { seen.add(h.page); unique.push(h); }
      }

      if (unique.length === 0) { setSuggestErr(S.autoSuggestNone); return; }
      setEntries(unique.map(h => ({ title: h.text, page: h.page })));
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div>
      <div className="section-header">
        <h2>{S.tocTitle}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {pdfDoc && (
            <button className="btn btn-secondary btn-sm" onClick={autoSuggest} disabled={suggesting}>
              {suggesting ? S.autoSuggestBusy : S.autoSuggestBtn}
            </button>
          )}
          <button className="btn btn-secondary btn-sm" onClick={add}>{S.addTocEntry}</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? S.saving : S.saveToc}
          </button>
        </div>
      </div>
      {suggestErr && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 12 }}>{suggestErr}</p>
      )}

      {entries.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ color: 'var(--text-muted)' }}>{S.noTocEntries}</p>
        </div>
      ) : (
        <div className="toc-editor">
          {entries.map((entry, i) => (
            <div key={i} className="toc-editor-item">
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', minWidth: 20 }}>{i + 1}.</span>
              <input
                className="input"
                style={{ flex: 1 }}
                value={entry.title}
                onChange={e => update(i, 'title', e.target.value)}
                placeholder={S.sectionPlaceholder}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{S.pageLabel}</span>
              <input
                type="number"
                className="input"
                style={{ width: 70 }}
                value={entry.page}
                min={1}
                onChange={e => update(i, 'page', parseInt(e.target.value, 10) || 1)}
              />
              <button className="btn btn-danger btn-sm" onClick={() => remove(i)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page thumbnail strip ──────────────────────────────────────────────────
function PageStrip({ pdfDoc, selectedPage, onSelect }) {
  const [thumbs, setThumbs] = useState({});
  const numPages = pdfDoc?.numPages || 0;

  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    (async () => {
      for (let i = 1; i <= numPages; i++) {
        if (cancelled) break;
        const { canvas } = await renderPage(pdfDoc, i, 0.2);
        if (!cancelled) setThumbs(prev => ({ ...prev, [i]: canvas }));
      }
    })();
    return () => { cancelled = true; };
  }, [pdfDoc, numPages]);

  return (
    <div className="page-strip">
      {Array.from({ length: numPages }, (_, i) => i + 1).map(p => (
        <div
          key={p}
          className={`page-thumb ${selectedPage === p ? 'active' : ''}`}
          onClick={() => onSelect(p)}
          title={`${S.pageLabel} ${p}`}
        >
          {thumbs[p] ? (
            <canvas
              width={thumbs[p].width}
              height={thumbs[p].height}
              ref={el => {
                if (el && thumbs[p]) {
                  el.width = thumbs[p].width;
                  el.height = thumbs[p].height;
                  el.getContext('2d').drawImage(thumbs[p], 0, 0);
                }
              }}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          ) : (
            <span style={{ fontSize: '0.65rem' }}>p.{p}</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Hotspots tab ──────────────────────────────────────────────────────────
function HotspotsTab({ brochureId, pdfDoc, hotspots, onChange, showToast }) {
  const [selectedPage, setSelectedPage] = useState(1);
  const [pageCanvas, setPageCanvas]     = useState(null);
  const renderQueue   = useRef(new Set());
  const pageCanvases  = useRef({});

  const loadPage = useCallback(async (pageNum) => {
    if (!pdfDoc || renderQueue.current.has(pageNum) || pageCanvases.current[pageNum]) return;
    renderQueue.current.add(pageNum);
    const { canvas } = await renderPage(pdfDoc, pageNum, SCALE);
    pageCanvases.current[pageNum] = canvas;
    renderQueue.current.delete(pageNum);
    return canvas;
  }, [pdfDoc]);

  useEffect(() => {
    if (!pdfDoc) return;
    (async () => {
      const c = await loadPage(selectedPage);
      setPageCanvas(pageCanvases.current[selectedPage] || c);
    })();
  }, [selectedPage, pdfDoc, loadPage]);

  const pageHotspots = hotspots.filter(h => h.page === selectedPage);

  const addHotspot = async (data) => {
    try {
      const created = await api.addHotspot(brochureId, { ...data, page: selectedPage });
      onChange([...hotspots, created]);
      showToast(S.hotspotAdded, 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  const deleteHotspot = async (hsId) => {
    await api.deleteHotspot(brochureId, hsId);
    onChange(hotspots.filter(h => h.id !== hsId));
    showToast(S.hotspotRemoved, 'success');
  };

  return (
    <div>
      <div className="section-header">
        <div>
          <h2>{S.hotspotsTitle}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
            {S.hotspotsDesc}
          </p>
        </div>
        <span className="badge badge-accent">{S.tabHotspots(hotspots.length)}</span>
      </div>

      <PageStrip pdfDoc={pdfDoc} selectedPage={selectedPage} onSelect={setSelectedPage} />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 24, alignItems: 'start' }}>
        <div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 8 }}>
            {S.pageN(selectedPage)}
          </p>
          {pageCanvas ? (
            <HotspotEditor
              canvas={pageCanvas}
              hotspots={pageHotspots}
              onAdd={addHotspot}
              onDelete={deleteHotspot}
              pdfDoc={pdfDoc}
              pageCount={pdfDoc?.numPages || 0}
            />
          ) : (
            <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="spinner" />
            </div>
          )}
        </div>

        <div>
          <h3 style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', marginBottom: 12 }}>
            {S.allHotspots}
          </h3>
          {hotspots.length === 0 ? (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{S.noHotspots}</p>
          ) : (
            hotspots.map(hs => (
              <div key={hs.id} className="hotspot-list-item">
                <div>
                  <div className="hotspot-list-label">{hs.label}</div>
                  <div className="hotspot-list-action">
                    {S.pageLabel} {hs.page} · {hs.action?.type === 'page'
                      ? S.hotspotToPage(hs.action.value)
                      : S.hotspotToUrl}
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => deleteHotspot(hs.id)}
                >✕</button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Analytics tab ─────────────────────────────────────────────────────────
function KPICard({ label, value }) {
  return (
    <div style={{
      background: 'var(--surface2)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      padding: '16px',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--accent)' }}>{value}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function AnalyticsTab({ brochureId }) {
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const nDaysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };

  const [from,    setFrom]    = useState(() => nDaysAgo(7));
  const [to,      setTo]      = useState(todayStr);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const s = await api.getAnalyticsSummary(brochureId, from, to);
      setSummary(s);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [brochureId, from, to]);

  useEffect(() => { load(); }, [load]);

  const exportCsv = async () => {
    try {
      const events = await api.getAnalyticsEvents(brochureId, from, to);
      const header = 'event,sessionId,brochureId,ts,page,zoom\n';
      const rows = events.map(e =>
        [e.event, e.sessionId ?? '', e.brochureId ?? '', e.ts ?? '', e.page ?? '', e.zoom ?? '']
          .map(v => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      ).join('\n');
      const blob = new Blob([header + rows], { type: 'text/csv' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `analytics-${brochureId}-${from}-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <div>
      {/* Controls */}
      <div className="section-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2>אנליטיקה</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>מ-</label>
          <input
            type="date"
            className="input"
            style={{ width: 140 }}
            value={from}
            onChange={e => setFrom(e.target.value)}
          />
          <label style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>עד-</label>
          <input
            type="date"
            className="input"
            style={{ width: 140 }}
            value={to}
            onChange={e => setTo(e.target.value)}
          />
          <button className="btn btn-secondary btn-sm" onClick={load} disabled={loading}>
            {loading ? '...' : 'טען'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={exportCsv}>
            ייצא CSV
          </button>
        </div>
      </div>

      {error && (
        <p style={{ color: 'var(--danger)', marginBottom: 16 }}>{error}</p>
      )}

      {summary && (
        <>
          {/* KPI cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
            gap: 12,
            marginBottom: 28,
          }}>
            <KPICard label="סשנים"         value={summary.sessions} />
            <KPICard label="אירועים"        value={summary.events} />
            <KPICard label="שהייה ממוצעת"  value={`${summary.avgDwellSec}ש'`} />
            <KPICard label="שיתופים"        value={summary.eventCounts?.share_click ?? 0} />
            <KPICard label="הורדות"         value={summary.eventCounts?.download_click ?? 0} />
          </div>

          {/* Top pages */}
          {summary.topPages.length > 0 ? (
            <div>
              <h3 style={{
                fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-muted)', marginBottom: 12,
              }}>
                עמודים פופולריים
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{
                    textAlign: 'right', fontSize: '0.8rem',
                    color: 'var(--text-muted)', borderBottom: '1px solid var(--border)',
                  }}>
                    <th style={{ padding: '6px 0', fontWeight: 600 }}>עמוד</th>
                    <th style={{ padding: '6px 0', fontWeight: 600 }}>צפיות</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.topPages.map(({ page, views }) => (
                    <tr key={page} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 0', fontSize: '0.9rem' }}>עמוד {page}</td>
                      <td style={{ padding: '8px 0', fontSize: '0.9rem' }}>{views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              אין נתוני עמודים לטווח זה
            </p>
          )}
        </>
      )}

      {!loading && !summary && !error && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
          לחץ "טען" לצפייה בנתונים
        </p>
      )}
    </div>
  );
}

// ── Main BrochureAdmin ────────────────────────────────────────────────────
export default function BrochureAdmin() {
  const { id } = useParams();
  const [brochure,     setBrochure]     = useState(null);
  const [metadata,     setMetadata]     = useState(null);
  const [pdfDoc,       setPdfDoc]       = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [tab,          setTab]          = useState('info');
  const [toast,        setToast]        = useState(null);
  const [editTitle,    setEditTitle]    = useState('');
  const [editDesc,     setEditDesc]     = useState('');
  const [saving,       setSaving]       = useState(false);
  const [showPreview,  setShowPreview]  = useState(false);
  const [showShare,    setShowShare]    = useState(false);

  const showToast = (msg, type = 'success') => setToast({ msg, type });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, meta] = await Promise.all([api.getBrochure(id), api.getMetadata(id)]);
        if (cancelled) return;
        setBrochure(b);
        setMetadata(meta);
        setEditTitle(b.title);
        setEditDesc(b.description || '');
        const pdf = await loadPdf(b.pdfUrl);
        if (cancelled) return;
        setPdfDoc(pdf);
        if (b.pageCount !== pdf.numPages) {
          api.updateBrochure(id, { pageCount: pdf.numPages }).catch(() => {});
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const saveInfo = async () => {
    setSaving(true);
    const updated = await api.updateBrochure(id, { title: editTitle, description: editDesc });
    setBrochure(updated);
    showToast(S.savedOk, 'success');
    setSaving(false);
  };

  const saveToc = async (toc) => {
    const updated = await api.updateToc(id, toc);
    setMetadata(updated);
    showToast(S.tocSaved, 'success');
  };

  const copyLink = async () => {
    const url = `${window.location.origin}/brochure/${id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    track('share_click', { brochureId: id, method: 'copy' });
    showToast(S.linkCopied, 'success');
  };

  const shareLink = async () => {
    const url   = `${window.location.origin}/brochure/${id}`;
    const title = brochure?.title || '';
    const text  = S.shareText(title);
    track('share_click', { brochureId: id, method: 'native' });
    if (navigator.share && navigator.canShare?.({ title, text, url })) {
      try { await navigator.share({ title, text, url }); } catch { /* cancelled */ }
    } else {
      setShowShare(true);
    }
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
        <p style={{ color: 'var(--danger)' }}>החוברת לא נמצאה.</p>
        <Link to="/admin" className="btn btn-secondary" style={{ marginTop: 16 }}>{S.allBrochures}</Link>
      </div>
    );
  }

  const tabs = [
    { key: 'info',      label: S.tabInfo },
    { key: 'toc',       label: S.tocTitle },
    { key: 'hotspots',  label: S.tabHotspots(metadata?.hotspots?.length || 0) },
    { key: 'qr',        label: S.tabQr(metadata?.qrCodes?.length || 0) },
    { key: 'theme',     label: S.tabTheme },
    { key: 'analytics', label: 'אנליטיקה' },
  ];

  return (
    <div className="brochure-admin-page">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">{S.brand}</Link>
        <div className="navbar-actions">
          <Link to="/admin" className="btn btn-ghost btn-sm">{S.allBrochures}</Link>
          <Link to={`/brochure/${id}`} className="btn btn-secondary btn-sm">{S.coverBtn}</Link>

          {/* Copy Link */}
          <button className="btn btn-ghost btn-sm" onClick={copyLink} title={S.copyLinkBtn}>
            🔗 {S.copyLinkBtn}
          </button>

          {/* Share */}
          <button className="btn btn-ghost btn-sm" onClick={shareLink}>
            {S.shareBtn}
          </button>

          {/* Global Preview — always visible regardless of active tab */}
          {pdfDoc && metadata && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowPreview(true)}
            >
              👁 {S.previewBtn}
            </button>
          )}

          <Link to={`/view/${id}`} className="btn btn-primary btn-sm">{S.viewBtn}</Link>
        </div>
      </nav>

      <div className="brochure-admin-container">
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 700 }}>{brochure.title}</h1>
          {brochure.pageCount > 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 4 }}>
              {brochure.pageCount} {S.pageLabel} · {brochure.filename}
            </p>
          )}
        </div>

        {/* Tabs */}
        <div className="brochure-admin-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={`tab-btn ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Info tab */}
        {tab === 'info' && (
          <div className="card" style={{ maxWidth: 560 }}>
            <h2 style={{ marginBottom: 20, fontSize: '1.1rem' }}>{S.brochureInfo}</h2>
            <div className="form-field">
              <label className="label">{S.labelTitle}</label>
              <input className="input" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
            </div>
            <div className="form-field">
              <label className="label">{S.labelDesc}</label>
              <textarea
                className="input"
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                rows={3}
                style={{ resize: 'vertical' }}
              />
            </div>
            <div className="form-field">
              <label className="label">{S.labelPdf}</label>
              <input className="input" value={brochure.originalFilename || brochure.filename} readOnly style={{ opacity: 0.6 }} />
            </div>
            <button className="btn btn-primary" onClick={saveInfo} disabled={saving}>
              {saving ? S.saving : S.saveChanges}
            </button>
          </div>
        )}

        {/* TOC tab */}
        {tab === 'toc' && metadata && (
          <div className="card">
            <TocEditor
              toc={metadata.toc}
              onSave={saveToc}
              pdfDoc={pdfDoc}
              pageCount={pdfDoc?.numPages || 0}
            />
          </div>
        )}

        {/* Hotspots tab */}
        {tab === 'hotspots' && pdfDoc && metadata && (
          <div className="card">
            <HotspotsTab
              brochureId={id}
              pdfDoc={pdfDoc}
              hotspots={metadata.hotspots}
              onChange={(hs) => setMetadata(m => ({ ...m, hotspots: hs }))}
              showToast={showToast}
            />
          </div>
        )}

        {/* QR tab */}
        {tab === 'qr' && metadata && brochure && (
          <div className="card">
            <QRManager
              brochureId={id}
              qrCodes={metadata.qrCodes}
              pdfUrl={brochure.pdfUrl}
              pageCount={brochure.pageCount || pdfDoc?.numPages || 0}
              onChange={(qrs) => setMetadata(m => ({ ...m, qrCodes: qrs }))}
            />
          </div>
        )}

        {/* Theme tab */}
        {tab === 'theme' && (
          <div className="card" style={{ maxWidth: 520 }}>
            <ThemePanel
              brochureId={id}
              pdfDoc={pdfDoc}
              showToast={showToast}
            />
          </div>
        )}

        {/* Analytics tab */}
        {tab === 'analytics' && (
          <div className="card">
            <AnalyticsTab brochureId={id} />
          </div>
        )}
      </div>

      {/* Global Preview Modal */}
      {showPreview && pdfDoc && metadata && (
        <BrochurePreviewModal
          pdfUrl={brochure.pdfUrl}
          qrCodes={metadata.qrCodes}
          hotspots={metadata.hotspots}
          pageCount={brochure.pageCount || pdfDoc?.numPages || 0}
          onClose={() => setShowPreview(false)}
        />
      )}

      {/* Share fallback modal */}
      {showShare && brochure && (() => {
        const url  = `${window.location.origin}/brochure/${id}`;
        const text = S.shareText(brochure.title);
        const waUrl    = `https://wa.me/?text=${encodeURIComponent(text + '\n' + url)}`;
        const emailUrl = `mailto:?subject=${encodeURIComponent(brochure.title)}&body=${encodeURIComponent(text + '\n' + url)}`;
        return (
          <div className="modal-backdrop">
            <div className="modal" style={{ maxWidth: 360, width: '92vw', textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{S.shareTitle}</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowShare(false)}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <a href={waUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ justifyContent: 'center' }}>
                  {S.shareWhatsapp}
                </a>
                <a href={emailUrl} className="btn btn-secondary" style={{ justifyContent: 'center' }}>
                  {S.shareEmail}
                </a>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowShare(false)}>
                  {S.shareClose}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {toast && <Toast msg={toast.msg} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
