/**
 * themeFromPdf – extract a per-brochure color theme from the first PDF page.
 *
 * Algorithm:
 *   1. Render page 1 at 18% scale (fast, ~100 px wide).
 *   2. Sample every 12th pixel; skip transparent / near-white / near-black / near-gray.
 *   3. Build a 36-bucket hue histogram weighted by saturation.
 *   4. Dominant hue → theme colors via HSL math.
 *   5. Cache in memory (memCache) + localStorage.
 *
 * Exports:
 *   DEFAULT_THEME          – safe fallback (matches existing dark-purple tokens)
 *   loadCachedTheme(id)    – memCache → localStorage, returns null on miss
 *   extractThemeFromCanvas – pure fn; works on any canvas element
 *   extractThemeFromPdf    – renders thumbnail, calls extractThemeFromCanvas
 *   applyTheme(el, theme)  – sets CSS vars on a DOM element
 */

const memCache = {};
const CACHE_KEY = (id) => `brochureTheme:${id}`;

// ─── Defaults (mirror current dark-purple design tokens) ─────────────────────
export const DEFAULT_THEME = {
  bg1:        '#0c0c18',
  bg2:        '#13132a',
  bg3:        '#1a1a35',
  accent:     '#7c6bf0',
  accentSoft: '#4a3d9a',
  glassTint:  'rgba(10, 10, 22, 0.82)',
};

// ─── Color math helpers ───────────────────────────────────────────────────────

/** '#rrggbb' → { h: 0-360, s: 0-100, l: 0-100 } */
function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const { h, s, l } = rgbToHsl(r, g, b);
  return { h, s: s * 100, l: l * 100 };
}

/** RGB 0-255 → HSL (h: 0-360, s: 0-1, l: 0-1) */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l   = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else                h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** HSL (h: 0-360, s: 0-100, l: 0-100) → '#rrggbb' */
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k     = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** HSL (h: 0-360, s: 0-100, l: 0-100) → 'rgba(r, g, b, alpha)' */
function hslToRgba(h, s, l, alpha) {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)) * 255);
  };
  return `rgba(${f(0)}, ${f(8)}, ${f(4)}, ${alpha})`;
}

/** Build a dark theme from a single dominant hue (0-360°). */
export function buildThemeFromHue(h) {
  return {
    bg1:        hslToHex( h, 30,  8),
    bg2:        hslToHex( h, 25, 13),
    bg3:        hslToHex( h, 20, 18),
    accent:     hslToHex( h, 75, 62),
    accentSoft: hslToHex( h, 45, 40),
    glassTint:  hslToRgba(h, 30,  6, 0.82),
  };
}

/** Build a light theme from a dominant hue (backgrounds at L≈80–94%). */
export function buildLightThemeFromHue(h) {
  return {
    bg1:        hslToHex( h, 22, 94),
    bg2:        hslToHex( h, 18, 87),
    bg3:        hslToHex( h, 14, 79),
    accent:     hslToHex( h, 68, 38),
    accentSoft: hslToHex( h, 42, 60),
    glassTint:  hslToRgba(h, 20, 92, 0.88),
  };
}

/** Build a neutral (mid-tone) theme from a dominant hue (backgrounds at L≈28–45%). */
export function buildNeutralThemeFromHue(h) {
  return {
    bg1:        hslToHex( h, 22, 28),
    bg2:        hslToHex( h, 18, 36),
    bg3:        hslToHex( h, 15, 45),
    accent:     hslToHex( h, 72, 68),
    accentSoft: hslToHex( h, 48, 50),
    glassTint:  hslToRgba(h, 22, 24, 0.82),
  };
}

/**
 * Build a theme where bg1 is set directly from the chosen hex color.
 * bg2/bg3 are derived by shifting lightness; accent is preserved if supplied.
 */
export function buildThemeFromBgHex(bg1Hex, accentHex = null, accentSoftHex = null) {
  const { h, s, l } = hexToHsl(bg1Hex);
  const isDark = l < 50;
  const bg2 = hslToHex(h, s, isDark ? Math.min(l + 7, 92) : Math.max(l - 7, 5));
  const bg3 = hslToHex(h, s, isDark ? Math.min(l + 14, 95) : Math.max(l - 14, 5));
  const glassTint = hslToRgba(h, Math.min(s, 30), l, 0.82);
  const accent = accentHex ?? hslToHex(h, 75, isDark ? 62 : 38);
  const accentSoft = accentSoftHex ?? hslToHex(h, 45, isDark ? 40 : 58);
  return { bg1: bg1Hex, bg2, bg3, accent, accentSoft, glassTint };
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

/** Return cached theme for brochureId, or null on miss. */
export function loadCachedTheme(id) {
  if (memCache[id]) return memCache[id];
  try {
    const raw = localStorage.getItem(CACHE_KEY(id));
    if (raw) {
      const t = JSON.parse(raw);
      memCache[id] = t;
      return t;
    }
  } catch { /* ignore */ }
  return null;
}

function saveCache(id, theme) {
  memCache[id] = theme;
  try { localStorage.setItem(CACHE_KEY(id), JSON.stringify(theme)); } catch { /* ignore */ }
}

// ─── Extraction ───────────────────────────────────────────────────────────────

/**
 * Extract theme from an existing canvas.
 * Returns a theme object, or null if the image has no strong dominant color.
 */
export function extractThemeFromCanvas(canvas) {
  let ctx;
  try { ctx = canvas.getContext('2d'); } catch { return null; }
  const { width, height } = canvas;
  if (!width || !height) return null;

  const data    = ctx.getImageData(0, 0, width, height).data;
  const buckets = new Float32Array(36); // 36 × 10° hue buckets
  const STRIDE  = 12; // sample every 12th pixel
  let   counted = 0;

  for (let i = 0; i < data.length; i += STRIDE * 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a < 128) continue;          // transparent
    const { h, s, l } = rgbToHsl(r, g, b);
    if (l > 0.88) continue;         // near-white
    if (l < 0.12) continue;         // near-black (raised from 0.08 → skips dark muddy tones)
    if (s < 0.22) continue;         // desaturated / gray (raised from 0.15 → skips browns)
    // Prefer mid-tone pixels (l 0.25–0.75) — bright brand colors, not dark shadows.
    // Very dark pixels (l < 0.25) get 25% weight so they don't dominate the histogram.
    const lightPref = (l >= 0.25 && l <= 0.75) ? 1.0 : 0.25;
    buckets[Math.floor(h / 10) % 36] += s * lightPref;
    counted++;
  }

  if (counted < 8) return null; // too few colorful pixels

  // Find dominant bucket
  let maxWeight = 0, dominantIdx = 0;
  for (let k = 0; k < 36; k++) {
    if (buckets[k] > maxWeight) { maxWeight = buckets[k]; dominantIdx = k; }
  }
  if (maxWeight < 0.5) return null; // no clear dominant hue

  const dominantHue = dominantIdx * 10 + 5; // center of the 10° bucket
  return buildThemeFromHue(dominantHue);
}

/**
 * Render the first PDF page at thumbnail scale (~18%), extract a color theme,
 * persist the result in memCache + localStorage, and return it.
 * Resolves to DEFAULT_THEME if extraction yields nothing usable.
 *
 * @param {PDFDocumentProxy} pdfDoc
 * @param {string}           brochureId
 * @param {object}           [override]  – from metadata.themeOverride (admin)
 */
export async function extractThemeFromPdf(pdfDoc, brochureId, override) {
  // Admin manual override takes priority
  if (override) {
    const theme = { ...DEFAULT_THEME, ...override };
    saveCache(brochureId, theme);
    return theme;
  }

  // Already extracted this session — skip re-render
  if (memCache[brochureId]) return memCache[brochureId];

  try {
    const THUMB_SCALE = 0.18;
    const page     = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: THUMB_SCALE });
    const canvas   = document.createElement('canvas');
    canvas.width   = Math.round(viewport.width);
    canvas.height  = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const theme = extractThemeFromCanvas(canvas) ?? DEFAULT_THEME;
    saveCache(brochureId, theme);
    return theme;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Render the first PDF page and extract THREE themed variants:
 *   [0] dark    – weighted toward lower-L pixels (L 0.12–0.50)
 *   [1] light   – weighted toward higher-L pixels (L 0.50–0.88)
 *   [2] neutral – balanced weights (current algorithm)
 *
 * Returns an array of 3 theme objects. Never throws (falls back gracefully).
 */
export async function extractMultipleThemesFromPdf(pdfDoc) {
  const dominantHue = (data, weightFn) => {
    const buckets = new Float32Array(36);
    let counted = 0;
    for (let i = 0; i < data.length; i += 12 * 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 128) continue;
      const { h, s, l } = rgbToHsl(r, g, b);
      if (l > 0.88 || l < 0.12 || s < 0.15) continue;
      buckets[Math.floor(h / 10) % 36] += s * weightFn(l);
      counted++;
    }
    if (counted < 8) return null;
    let maxW = 0, domIdx = 0;
    for (let k = 0; k < 36; k++) {
      if (buckets[k] > maxW) { maxW = buckets[k]; domIdx = k; }
    }
    return maxW < 0.5 ? null : domIdx * 10 + 5;
  };

  try {
    const THUMB_SCALE = 0.18;
    const page     = await pdfDoc.getPage(1);
    const viewport = page.getViewport({ scale: THUMB_SCALE });
    const canvas   = document.createElement('canvas');
    canvas.width   = Math.round(viewport.width);
    canvas.height  = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;

    const darkHue    = dominantHue(data, l => l <= 0.50 ? 1.0 : 0.08);
    const lightHue   = dominantHue(data, l => l >= 0.50 ? 1.0 : 0.08);
    const neutralHue = dominantHue(data, l => (l >= 0.25 && l <= 0.75) ? 1.0 : 0.25);
    const fallback   = neutralHue ?? darkHue ?? lightHue ?? 250;

    return [
      buildThemeFromHue(darkHue ?? fallback),
      buildLightThemeFromHue(lightHue ?? fallback),
      buildNeutralThemeFromHue(neutralHue ?? fallback),
    ];
  } catch {
    return [
      DEFAULT_THEME,
      buildLightThemeFromHue(250),
      buildNeutralThemeFromHue(250),
    ];
  }
}

/**
 * Apply a theme object as CSS custom properties on a DOM element.
 * Call on the root div so vars cascade to all children.
 */
export function applyTheme(el, theme) {
  if (!el || !theme) return;
  el.style.setProperty('--theme-bg1',         theme.bg1);
  el.style.setProperty('--theme-bg2',         theme.bg2);
  el.style.setProperty('--theme-bg3',         theme.bg3);
  el.style.setProperty('--theme-accent',      theme.accent);
  el.style.setProperty('--theme-accent-soft', theme.accentSoft);
  el.style.setProperty('--theme-glass-tint',  theme.glassTint);
}

/** Names of the custom properties managed by this module (order matters). */
const THEME_VARS = [
  '--theme-bg1', '--theme-bg2', '--theme-bg3',
  '--theme-accent', '--theme-accent-soft', '--theme-glass-tint',
];

/** Fallback values parallel to THEME_VARS — vars are never set to empty. */
const THEME_VAR_DEFAULTS = [
  DEFAULT_THEME.bg1, DEFAULT_THEME.bg2, DEFAULT_THEME.bg3,
  DEFAULT_THEME.accent, DEFAULT_THEME.accentSoft, DEFAULT_THEME.glassTint,
];

/**
 * Apply theme to document.documentElement.style (the `:root` element).
 * Snapshots existing values first; cleanup restores them (or DEFAULT_THEME if
 * the slot was empty) so vars are NEVER left blank after unmount.
 *
 * @param {object} theme
 * @param {string} [scope]  – shown in dev console ('viewer' | 'cover')
 * @returns {() => void}  Cleanup — call in useLayoutEffect return.
 */
export function applyThemeToRoot(theme, scope = '') {
  const root = document.documentElement;

  // Snapshot current inline-style values before overwriting
  const prev = THEME_VARS.map(v => root.style.getPropertyValue(v));

  root.style.setProperty('--theme-bg1',         theme.bg1);
  root.style.setProperty('--theme-bg2',         theme.bg2);
  root.style.setProperty('--theme-bg3',         theme.bg3);
  root.style.setProperty('--theme-accent',      theme.accent);
  root.style.setProperty('--theme-accent-soft', theme.accentSoft);
  root.style.setProperty('--theme-glass-tint',  theme.glassTint);

  if (import.meta.env.DEV) {
    console.log('[theme] applied', scope, theme.bg1, theme.accent);
  }

  // Cleanup: restore previous value, or DEFAULT_THEME if slot was empty.
  // Never calls removeProperty — vars stay defined so body gradient never blanks.
  return () => {
    THEME_VARS.forEach((v, i) => {
      root.style.setProperty(v, prev[i] || THEME_VAR_DEFAULTS[i]);
    });
  };
}
