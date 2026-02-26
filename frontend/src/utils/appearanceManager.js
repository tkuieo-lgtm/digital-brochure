/**
 * appearanceManager – per-brochure background / theme runtime manager.
 *
 * Modes:
 *   "auto"  – colors extracted from PDF page 1 (themeFromPdf engine)
 *   "color" – admin-chosen colorTheme object
 *   "image" – admin-uploaded background image + derived UI theme
 *
 * The single `applyAppearance(config, scope)` function handles all three modes
 * and returns a cleanup fn suitable for use in useLayoutEffect.
 *
 * Image mode injects a `position:fixed` bg-layer div behind all content.
 * Auto/color modes use the CSS body gradient (already defined in index.css).
 */
import { DEFAULT_THEME, extractThemeFromPdf, applyThemeToRoot } from './themeFromPdf.js';
import { api } from './api.js';

// ─── In-memory cache ──────────────────────────────────────────────────────────
const memCache = {};
const LS_KEY   = (id) => `brochureAppearance:${id}`;

// ─── Bg-layer singleton (image mode only) ────────────────────────────────────
let bgLayerEl = null;

function getBgLayer() {
  if (!bgLayerEl) {
    bgLayerEl = document.createElement('div');
    bgLayerEl.id = 'theme-bg-layer';
    document.body.appendChild(bgLayerEl);
  }
  return bgLayerEl;
}

function hideBgLayer() {
  if (bgLayerEl) bgLayerEl.style.cssText = 'display:none';
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

/** Return cached appearance for id, or null on miss. */
export function loadCachedAppearance(id) {
  if (memCache[id]) return memCache[id];
  try {
    const raw = localStorage.getItem(LS_KEY(id));
    if (raw) { const a = JSON.parse(raw); memCache[id] = a; return a; }
  } catch { /* ignore */ }
  return null;
}

/** Write appearance to memCache + localStorage. */
export function updateAppearanceCache(id, config) {
  memCache[id] = config;
  try { localStorage.setItem(LS_KEY(id), JSON.stringify(config)); } catch { /* ignore */ }
}

// ─── Apply ────────────────────────────────────────────────────────────────────

/**
 * Apply an appearance config to the page immediately.
 * Call inside useLayoutEffect so it runs before paint.
 *
 * @param {object} config  – appearance object (mode + optional fields)
 * @param {string} scope   – label for dev logging ('viewer' | 'cover' | 'admin')
 * @returns {() => void}   cleanup – restore previous state on unmount
 */
export function applyAppearance(config, scope = '') {
  const mode       = config?.mode ?? 'auto';
  const prevBodyBg = document.body.style.getPropertyValue('background');

  if (mode === 'image' && config.image?.url) {
    const { url, fit = 'cover', dim = 0.3, blur = 0 } = config.image;
    const layer  = getBgLayer();
    const extend = blur > 0 ? Math.ceil(blur * 2) + 4 : 0;

    layer.style.cssText = `
      position: fixed;
      inset: -${extend}px;
      z-index: 0;
      pointer-events: none;
      background: url("${url}") center / ${fit} no-repeat;
      filter: blur(${blur}px) brightness(${(1 - dim).toFixed(2)});
    `;

    // Clear the body gradient so the image layer shows through
    document.body.style.setProperty('background', 'transparent');

    // Toolbar / accent colors come from colorTheme or autoTheme
    const uiTheme = config.colorTheme ?? config.autoTheme ?? DEFAULT_THEME;
    const restoreTheme = applyThemeToRoot(uiTheme, scope);

    return () => {
      hideBgLayer();
      if (prevBodyBg) document.body.style.setProperty('background', prevBodyBg);
      else document.body.style.removeProperty('background');
      restoreTheme();
    };
  }

  // Auto or color mode: bg-layer not needed; body CSS gradient handles background
  hideBgLayer();
  document.body.style.removeProperty('background');

  const theme = mode === 'color'
    ? (config.colorTheme ?? DEFAULT_THEME)
    : (config.autoTheme  ?? DEFAULT_THEME);

  return applyThemeToRoot(theme, scope);
}

// ─── Load + apply (async, for viewers) ───────────────────────────────────────

/**
 * Load appearance from API, extract autoTheme from PDF if needed,
 * and call setAppearanceFn twice: once immediately with cache, once after fetch.
 *
 * If mode=auto and no autoTheme is stored yet, runs extractThemeFromPdf
 * and saves the result back to the server (so future viewers skip extraction).
 *
 * @param {string}   id             brochure id
 * @param {object}   pdfDoc         PDFDocumentProxy (can be null for initial call)
 * @param {function} setAppearanceFn  React state setter
 */
export async function loadAndApplyAppearance(id, pdfDoc, setAppearanceFn) {
  // Show cached appearance immediately (no flash)
  const cached = loadCachedAppearance(id);
  if (cached) setAppearanceFn(cached);

  try {
    let remote = await api.getAppearance(id);

    // Auto mode with no saved autoTheme → extract from PDF now and persist
    if (remote.mode === 'auto' && !remote.autoTheme && pdfDoc) {
      const autoTheme = await extractThemeFromPdf(pdfDoc, id);
      remote = { ...remote, autoTheme };
      api.saveAppearance(id, remote).catch(() => {}); // fire-and-forget
    }

    updateAppearanceCache(id, remote);
    setAppearanceFn(remote);
  } catch { /* fallback: keep cached or default */ }
}
