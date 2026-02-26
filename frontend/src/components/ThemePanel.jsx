import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api.js';
import { S } from '../utils/strings.js';
import {
  DEFAULT_THEME,
  buildThemeFromHue,
  buildLightThemeFromHue,
  buildNeutralThemeFromHue,
  buildThemeFromBgHex,
  extractThemeFromPdf,
  extractMultipleThemesFromPdf,
} from '../utils/themeFromPdf.js';
import { updateAppearanceCache } from '../utils/appearanceManager.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Derive the UI theme object from an appearance config. */
function themeFromConfig(config) {
  if (!config) return DEFAULT_THEME;
  const { mode, autoTheme, colorTheme } = config;
  if (mode === 'image') return colorTheme ?? autoTheme ?? DEFAULT_THEME;
  if (mode === 'color') return colorTheme ?? DEFAULT_THEME;
  return autoTheme ?? DEFAULT_THEME;
}

/** Parse a hex color string to hue (0-360). Falls back to 250 (purple). */
function hexToHue(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 250;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return Math.round(h * 360);
}

// ─── Preview card ─────────────────────────────────────────────────────────────

function PreviewCard({ config, pendingFile }) {
  const theme = themeFromConfig(config);
  const mode  = config?.mode ?? 'auto';
  const img   = config?.image;

  // If there is a pending (not-yet-uploaded) file, create an object URL for preview
  const [objUrl, setObjUrl] = useState(null);
  useEffect(() => {
    if (!pendingFile) { setObjUrl(null); return; }
    const url = URL.createObjectURL(pendingFile);
    setObjUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingFile]);

  const bgImageUrl = objUrl ?? (mode === 'image' ? img?.url : null);
  const fit        = img?.fit ?? 'cover';
  const dim        = img?.dim ?? 0.3;
  const blur       = img?.blur ?? 0;

  return (
    <div className="theme-preview-card">
      {/* Background layer */}
      {bgImageUrl ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `url("${bgImageUrl}") center / ${fit} no-repeat`,
            filter: `blur(${blur}px) brightness(${(1 - dim).toFixed(2)})`,
          }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${theme.bg3} 0%, ${theme.bg1} 65%)`,
          }}
        />
      )}

      {/* Mock toolbar */}
      <div
        className="theme-preview-toolbar"
        style={{ background: theme.glassTint, color: theme.accent }}
      >
        <span style={{ fontSize: '0.7rem', color: '#fff', opacity: 0.8 }}>📖 חוברת</span>
        <span
          style={{
            width: 10, height: 10,
            borderRadius: '50%',
            background: theme.accent,
            display: 'inline-block',
          }}
        />
      </div>

      {/* Mock page area */}
      <div
        style={{
          position: 'absolute',
          inset: '36px 0 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        {[0, 1].map(i => (
          <div
            key={i}
            style={{
              width: 48,
              height: 68,
              background: 'rgba(255,255,255,0.88)',
              borderRadius: 3,
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Auto mode panel ──────────────────────────────────────────────────────────

const AUTO_SET_LABELS = ['כהים', 'בהירים', 'ניטרלי'];

function AutoModePanel({ appearance, pdfDoc, onUpdate }) {
  const [scanning, setScanning] = useState(false);

  const autoThemes  = appearance?.autoThemes;   // array[3] once scanned
  const autoThemeIdx = appearance?.autoThemeIdx ?? 0;
  const singleTheme  = appearance?.autoTheme ?? DEFAULT_THEME;

  // Derive 3 display themes: real extracted ones if available, else synthesised from accent hue.
  const displayThemes = useMemo(() => {
    if (autoThemes?.length === 3) return autoThemes;
    const h = hexToHue(singleTheme.accent);
    return [
      buildThemeFromHue(h),
      buildLightThemeFromHue(h),
      buildNeutralThemeFromHue(h),
    ];
  }, [autoThemes, singleTheme]);

  const hasScanned = !!autoThemes;

  const doScan = async () => {
    if (!pdfDoc) return;
    setScanning(true);
    try {
      const themes = await extractMultipleThemesFromPdf(pdfDoc);
      const idx = hasScanned ? autoThemeIdx : 0;
      onUpdate({ ...appearance, mode: 'auto', autoThemes: themes, autoThemeIdx: idx, autoTheme: themes[idx] });
    } finally {
      setScanning(false);
    }
  };

  const selectSet = (i) => {
    if (!hasScanned) return;
    onUpdate({ ...appearance, autoThemeIdx: i, autoTheme: autoThemes[i] });
  };

  return (
    <div>
      <p className="theme-section-label">סטים אוטומטיים מה-PDF</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {displayThemes.map((t, i) => (
          <button
            key={i}
            className={`theme-auto-set ${hasScanned && autoThemeIdx === i ? 'active' : ''}`}
            onClick={() => selectSet(i)}
            disabled={!hasScanned}
            title={hasScanned ? AUTO_SET_LABELS[i] : 'לחץ "סרוק מחדש" לבחירה'}
          >
            <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
              {[t.bg1, t.bg3, t.accent].map((c, j) => (
                <div
                  key={j}
                  style={{
                    width: 18, height: 18, borderRadius: 4,
                    background: c,
                    border: '1px solid rgba(128,128,128,0.3)',
                  }}
                />
              ))}
            </div>
            <span style={{ fontSize: '0.72rem' }}>{AUTO_SET_LABELS[i]}</span>
          </button>
        ))}
      </div>
      {!hasScanned && (
        <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 10 }}>
          לחץ "סרוק מחדש" לחילוץ 3 סטי צבעים מה-PDF
        </p>
      )}
      {pdfDoc && (
        <button className="btn btn-secondary btn-sm" onClick={doScan} disabled={scanning}>
          {scanning ? '⏳ סורק...' : S.themeReScan}
        </button>
      )}
    </div>
  );
}

// ─── Color mode panel ─────────────────────────────────────────────────────────

function ColorModePanel({ colorTheme, onChange }) {
  const theme  = colorTheme ?? DEFAULT_THEME;

  // Bg picker: use the chosen color directly as bg1; derive bg2/bg3 from it; keep accent.
  const updateBg = (hex) => {
    onChange(buildThemeFromBgHex(hex, theme.accent, theme.accentSoft));
  };

  // Accent picker: rebuild accent/accentSoft from the chosen hue; keep existing bg vars.
  const updateAccent = (hex) => {
    const hue     = hexToHue(hex);
    const derived = buildThemeFromHue(hue);
    onChange({ ...theme, accent: derived.accent, accentSoft: derived.accentSoft });
  };

  // "צור גוון" — sync bg and accent from the current accent hue (full coherent theme).
  const syncFromAccent = () => {
    onChange(buildThemeFromHue(hexToHue(theme.accent)));
  };

  return (
    <div>
      <p className="theme-section-label">צבעים</p>
      <div className="color-row">
        <label>{S.themeBgLabel}</label>
        <input
          type="color"
          className="color-swatch-input"
          value={theme.bg1}
          onChange={e => updateBg(e.target.value)}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{theme.bg1}</span>
      </div>
      <div className="color-row">
        <label>{S.themeAccentLabel}</label>
        <input
          type="color"
          className="color-swatch-input"
          value={theme.accent}
          onChange={e => updateAccent(e.target.value)}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{theme.accent}</span>
      </div>
      <button className="btn btn-secondary btn-sm" onClick={syncFromAccent}>
        {S.themeGenPalette}
      </button>
    </div>
  );
}

// ─── Image mode panel ─────────────────────────────────────────────────────────

function ImageModePanel({ imageConfig, onChange, onFileSelect }) {
  const img    = imageConfig ?? {};
  const fit    = img.fit  ?? 'cover';
  const dim    = img.dim  ?? 0.3;
  const blur   = img.blur ?? 0;
  const fileRef = useRef(null);

  return (
    <div>
      {/* Upload zone */}
      <p className="theme-section-label">{S.themeUpload}</p>
      <div
        className="theme-upload-zone"
        onClick={() => fileRef.current?.click()}
      >
        {img.url
          ? <span style={{ color: 'var(--accent-light)' }}>תמונה נוכחית · לחץ להחלפה</span>
          : <span>לחץ לבחירת תמונה (PNG / JPG / WEBP)</span>
        }
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(file);
          e.target.value = '';
        }}
      />

      {/* Fit */}
      <p className="theme-section-label" style={{ marginTop: 16 }}>{S.themeFit}</p>
      <div className="theme-fit-row">
        {['cover', 'contain'].map(v => (
          <button
            key={v}
            className={`theme-fit-btn ${fit === v ? 'active' : ''}`}
            onClick={() => onChange({ ...img, fit: v })}
          >
            {v === 'cover' ? S.themeFitCover : S.themeFitContain}
          </button>
        ))}
      </div>

      {/* Dim */}
      <div className="theme-slider-row">
        <label>{S.themeDim}</label>
        <input
          type="range"
          className="theme-slider"
          min={0} max={0.6} step={0.05}
          value={dim}
          onChange={e => onChange({ ...img, dim: parseFloat(e.target.value) })}
        />
        <span className="theme-slider-val">{Math.round(dim * 100)}%</span>
      </div>

      {/* Blur */}
      <div className="theme-slider-row">
        <label>{S.themeBlur}</label>
        <input
          type="range"
          className="theme-slider"
          min={0} max={12} step={1}
          value={blur}
          onChange={e => onChange({ ...img, blur: parseInt(e.target.value, 10) })}
        />
        <span className="theme-slider-val">{blur}px</span>
      </div>
    </div>
  );
}

// ─── ThemePanel (main export) ─────────────────────────────────────────────────

export default function ThemePanel({ brochureId, pdfDoc, showToast }) {
  const [appearance, setAppearance] = useState({ mode: 'auto' });
  const [pendingFile, setPendingFile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.getAppearance(brochureId).then(setAppearance).catch(() => {});
  }, [brochureId]);

  const setMode = (mode) => setAppearance(a => ({ ...a, mode }));

  const handleSave = async () => {
    setSaving(true);
    try {
      let cfg = { ...appearance };

      if (appearance.mode === 'image' && pendingFile) {
        const { url } = await api.uploadBackground(brochureId, pendingFile);
        cfg = { ...cfg, image: { ...(cfg.image ?? {}), url } };
        setPendingFile(null);
      }

      const saved = await api.saveAppearance(brochureId, cfg);
      updateAppearanceCache(brochureId, saved);
      setAppearance(saved);
      showToast(S.themeSaved, 'success');
    } catch (e) {
      showToast(e.message || 'שגיאה בשמירה', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const reset = { mode: 'auto' };
    setAppearance(reset);
    updateAppearanceCache(brochureId, reset);
  };

  const mode = appearance.mode ?? 'auto';

  return (
    <div className="theme-panel">
      <PreviewCard config={appearance} pendingFile={pendingFile} />

      {/* Mode selector */}
      <div>
        <p className="theme-section-label">מצב עיצוב</p>
        <div className="theme-mode-row">
          {[
            { key: 'auto',  label: S.themeModeAuto  },
            { key: 'color', label: S.themeModeColor  },
            { key: 'image', label: S.themeModeImage  },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`theme-mode-btn ${mode === key ? 'active' : ''}`}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Mode-specific controls */}
      {mode === 'auto' && (
        <AutoModePanel
          appearance={appearance}
          pdfDoc={pdfDoc}
          onUpdate={setAppearance}
        />
      )}

      {mode === 'color' && (
        <ColorModePanel
          colorTheme={appearance.colorTheme}
          onChange={(colorTheme) => setAppearance(a => ({ ...a, colorTheme }))}
        />
      )}

      {mode === 'image' && (
        <>
          <ImageModePanel
            imageConfig={appearance.image}
            onChange={(image) => setAppearance(a => ({ ...a, image }))}
            onFileSelect={(file) => setPendingFile(file)}
          />
          {/* Optional: accent color for toolbar glass in image mode */}
          <div>
            <p className="theme-section-label">צבע ממשק (סרגל כלים)</p>
            <ColorModePanel
              colorTheme={appearance.colorTheme}
              onChange={(colorTheme) => setAppearance(a => ({ ...a, colorTheme }))}
            />
          </div>
        </>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '...' : S.themeSave}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleReset}
        >
          {S.themeReset}
        </button>
      </div>
    </div>
  );
}
