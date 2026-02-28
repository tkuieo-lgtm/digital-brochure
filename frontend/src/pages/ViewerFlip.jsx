/**
 * ViewerFlip – Flipbook viewer (Sprint 5 + Sprint 6).
 *
 * Portrait / 2-page-spread flipbook with:
 *  - RTL navigation (← = next, → = prev, like a Hebrew book)
 *  - Desktop ≥900px: 2-page spread via CSS scaleX(-1) RTL trick
 *  - Mobile <900px : single-page portrait mode
 *  - Mobile swipe (left = next, right = prev) + pinch-to-zoom
 *  - Pan when zoomed (mouse drag desktop / single-finger drag mobile)
 *  - Double-click / double-tap to toggle zoom 1× ↔ 1.8×
 *  - Fullscreen with auto-hide toolbar (book fills 92 % of height)
 *  - HotspotLayer + QR overlays preserved inside each flip page
 *  - TOC drawer
 */
import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import HTMLFlipBook from 'react-pageflip';
import { api } from '../utils/api.js';
import { loadPdf, renderPage } from '../utils/pdfLoader.js';
import HotspotLayer from '../components/HotspotLayer.jsx';
import TocDrawer from '../components/TocDrawer.jsx';
import ShareDownloadBar from '../components/ShareDownloadBar.jsx';
import { S } from '../utils/strings.js';
import { loadCachedAppearance, applyAppearance, loadAndApplyAppearance } from '../utils/appearanceManager.js';
import { track, sessionStart, sessionEnd } from '../utils/analyticsClient.js';

// ─────────────────────────────────────────────────────────────────────────────
const RENDER_SCALE      = 1.5;
const TOOLBAR_H         = 52;

const MOCK_TOC = [
  { title: 'פרק 1 – מבוא',      page: 1  },
  { title: 'פרק 2 – שירותים',   page: 4  },
  { title: 'פרק 3 – צור קשר',   page: 10 },
];
const SWIPE_MIN         = 50;
const ZOOM_STEP         = 0.25;
const ZOOM_MIN          = 0.4;
const ZOOM_MAX          = 3.0;
const TOOLBAR_HIDE_MS   = 3000;
const SPREAD_BREAKPOINT = 900; // px – show 2-page spread above this width

// ─────────────────────────────────────────────────────────────────────────────
// Single flip page – must be forwardRef for react-pageflip
// In spread mode each page gets an inner scaleX(-1) to un-mirror its content
// (the outer HTMLFlipBook wrapper already has scaleX(-1) for RTL page order)
// ─────────────────────────────────────────────────────────────────────────────
const FlipPage = React.forwardRef(
  function FlipPage({ pgData, pageW, pageH, qrCodes, hotspots, onNavigate, spread }, ref) {
    const canvasRef = useRef(null);

    useEffect(() => {
      if (!canvasRef.current || !pgData) return;
      const el = canvasRef.current;
      el.width  = pgData.w;
      el.height = pgData.h;
      el.getContext('2d').drawImage(pgData.canvas, 0, 0);
    }, [pgData]);

    return (
      <div
        ref={ref}
        style={{
          position: 'relative',
          width: '100%', height: '100%',
          background: '#fff',
          userSelect: 'none',
          overflow: 'hidden',
        }}
      >
        {pgData ? (
          // Double scaleX(-1) when spread:
          //   outer wrapper (below) mirrors the book → RTL page order
          //   this inner div mirrors content back → readable text
          <div style={{
            width: '100%', height: '100%',
            position: 'relative',
            transform: spread ? 'scaleX(-1)' : undefined,
          }}>
            <canvas
              ref={canvasRef}
              style={{ display: 'block', width: '100%', height: '100%' }}
            />
            <HotspotLayer
              qrCodes={qrCodes}
              hotspots={hotspots}
              canvasW={pageW}
              canvasH={pageH}
              onNavigate={onNavigate}
            />
          </div>
        ) : (
          <div className="flip-page-loading">
            <div className="spinner" />
          </div>
        )}
      </div>
    );
  }
);

// ─────────────────────────────────────────────────────────────────────────────
function pinchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function calcPageDims(canvasW, canvasH, { spread = false, fullscreen = false } = {}) {
  const aspect = canvasW / canvasH;
  // In spread mode each page gets approximately half the viewport width
  const maxW = Math.max(200,
    spread ? Math.floor(window.innerWidth / 2) - 24 : window.innerWidth - 32
  );
  // Reserve space for toolbar (overlay) so it never covers the book.
  // In fullscreen the toolbar auto-hides and book fills the full viewport.
  const toolbarReserve = fullscreen ? 0 : TOOLBAR_H;
  const vertPad        = fullscreen ? 4 : 8;
  const maxH = Math.max(200, window.innerHeight - toolbarReserve - vertPad);
  let pageW, pageH;
  if (maxW / aspect <= maxH) {
    pageW = maxW;
    pageH = maxW / aspect;
  } else {
    pageH = maxH;
    pageW = maxH * aspect;
  }
  return { pageW: Math.round(pageW), pageH: Math.round(pageH) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function ViewerFlip() {
  const { id } = useParams();

  // ── Per-brochure appearance (theme / background) ─────────────────────────
  const [appearance, setAppearance] = useState(() => loadCachedAppearance(id) ?? { mode: 'auto' });

  // ── PDF / metadata ────────────────────────────────────────────────────────
  const [pdfDoc,      setPdfDoc]      = useState(null);
  const [metadata,    setMetadata]    = useState(null);
  const [brochure,    setBrochure]    = useState(null);
  const [numPages,    setNumPages]    = useState(0);
  const [pages,       setPages]       = useState({});
  const [pageW,       setPageW]       = useState(0);
  const [pageH,       setPageH]       = useState(0);
  const [loadingInit, setLoadingInit] = useState(true);

  // ── Navigation ────────────────────────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const bookRef = useRef(null);

  // ── Layout ────────────────────────────────────────────────────────────────
  const [spreadMode, setSpreadMode] = useState(() => window.innerWidth >= SPREAD_BREAKPOINT);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [zoom,           setZoom]           = useState(1);
  const [panX,           setPanX]           = useState(0);
  const [panY,           setPanY]           = useState(0);
  const [dragging,       setDragging]       = useState(false);
  const [tocOpen,        setTocOpen]        = useState(false);
  const [isFullscreen,   setIsFullscreen]   = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(true);

  // ── Live refs (keep handlers free of stale-closure bugs) ─────────────────
  const zoomRef       = useRef(1);
  const panXRef       = useRef(0);
  const panYRef       = useRef(0);
  const pageWRef      = useRef(0);
  const pageHRef      = useRef(0);
  const spreadRef     = useRef(spreadMode);
  const showSpreadRef = useRef(spreadMode); // hysteresis-aware effective spread
  const isFullscreenR = useRef(false);
  useEffect(() => { zoomRef.current   = zoom;       }, [zoom]);
  useEffect(() => { panXRef.current   = panX;       }, [panX]);
  useEffect(() => { panYRef.current   = panY;       }, [panY]);
  useEffect(() => { pageWRef.current  = pageW;      }, [pageW]);
  useEffect(() => { pageHRef.current  = pageH;      }, [pageH]);
  useEffect(() => { spreadRef.current = spreadMode; }, [spreadMode]);

  // ── Touch / drag refs ─────────────────────────────────────────────────────
  const touchStartX   = useRef(0);
  const touchStartY   = useRef(0);
  const initPinchDist = useRef(0);
  const initZoom      = useRef(1);
  const isPinching          = useRef(false);
  const lastGestureWasPinch = useRef(false); // true while fingers lift after a pinch
  const touchStartTime      = useRef(0);     // for velocity-based flick detection
  const isDragging          = useRef(false);
  const dragStart           = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const prevTouchPos        = useRef({ x: 0, y: 0 }); // for incremental single-finger pan
  const lastTapTime         = useRef(0);   // for double-tap detection
  const lastTapX            = useRef(0);
  const lastTapY            = useRef(0);

  // ── Misc refs ─────────────────────────────────────────────────────────────
  const renderQueue = useRef(new Set());
  const pagesRef    = useRef({});   // mirrors pages state – used inside ensurePage to avoid dep
  const pageWH      = useRef({ w: 0, h: 0 }); // source-of-truth canvas dimensions
  const toolbarTimer = useRef(null);
  const flipAreaRef  = useRef(null);

  // ── Session tracking ─────────────────────────────────────────────────────
  useEffect(() => {
    sessionStart(id, 'viewer');
    const onUnload = () => sessionEnd(id);
    const onHide   = () => { if (document.visibilityState === 'hidden') sessionEnd(id); };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [id]);

  // ── Load brochure + PDF ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [b, meta] = await Promise.all([api.getBrochure(id), api.getMetadata(id)]);
        if (cancelled) return;
        setBrochure(b);
        setMetadata(meta);

        const pdf = await loadPdf(b.pdfUrl);
        if (cancelled) return;
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);

        const { canvas, width, height } = await renderPage(pdf, 1, RENDER_SCALE);
        if (cancelled) return;
        pageWH.current = { w: width, h: height };
        const { pageW: pw, pageH: ph } = calcPageDims(width, height, {
          spread: spreadRef.current,
          fullscreen: false,
        });
        setPageW(pw);
        setPageH(ph);
        pagesRef.current[1] = { canvas, w: width, h: height };
        setPages({ 1: { canvas, w: width, h: height } });
        setLoadingInit(false);
      } catch (e) {
        console.error(e);
        if (!cancelled) setLoadingInit(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  // ── Recalculate page dimensions ───────────────────────────────────────────
  const recalcDims = useCallback(() => {
    const { w, h } = pageWH.current;
    if (!w || !h) return;
    const { pageW: pw, pageH: ph } = calcPageDims(w, h, {
      spread: spreadRef.current,
      fullscreen: isFullscreenR.current,
    });
    setPageW(pw);
    setPageH(ph);
  }, []);

  // ── Preload pages ─────────────────────────────────────────────────────────
  const ensurePage = useCallback(async (pageNum) => {
    if (!pdfDoc || pageNum < 1 || pageNum > numPages) return;
    if (pagesRef.current[pageNum] || renderQueue.current.has(pageNum)) return;
    renderQueue.current.add(pageNum);
    try {
      const { canvas, width, height } = await renderPage(pdfDoc, pageNum, RENDER_SCALE);
      pagesRef.current[pageNum] = { canvas, w: width, h: height };
      setPages(prev => ({ ...prev, [pageNum]: { canvas, w: width, h: height } }));
    } catch { /* ignore */ }
    renderQueue.current.delete(pageNum);
  }, [pdfDoc, numPages]);

  // Preload sliding window around current page
  useEffect(() => {
    if (!pdfDoc || numPages === 0) return;
    const near = [currentPage - 1, currentPage, currentPage + 1, currentPage + 2];
    near.filter(p => p >= 1 && p <= numPages).forEach(ensurePage);
  }, [currentPage, pdfDoc, numPages, ensurePage]);

  // Background: preload all pages
  useEffect(() => {
    if (!pdfDoc || numPages === 0) return;
    for (let p = 1; p <= numPages; p++) ensurePage(p);
  }, [pdfDoc, numPages, ensurePage]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const goNext = useCallback(() => bookRef.current?.pageFlip().flipNext(), []);
  const goPrev = useCallback(() => bookRef.current?.pageFlip().flipPrev(), []);
  const goTo   = useCallback((pageNum) => {
    const p = Math.max(1, Math.min(numPages, pageNum));
    bookRef.current?.pageFlip().turnToPage(p - 1);
  }, [numPages]);
  const handleFlip = useCallback((e) => {
    const page = e.data + 1;
    setCurrentPage(page);
    track('page_change', { brochureId: id, page });
  }, [id]);

  // ── Keyboard (RTL: ← = next, → = prev) ───────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowLeft')  { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goPrev(); }
      if (e.key === 'Escape' && isFullscreenR.current) document.exitFullscreen?.();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev]);

  // ── Fullscreen ────────────────────────────────────────────────────────────
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else                             await document.exitFullscreen();
    } catch { /* unsupported on some browsers */ }
  };

  useEffect(() => {
    const handler = () => {
      const full = !!document.fullscreenElement;
      setIsFullscreen(full);
      isFullscreenR.current = full;
      recalcDims();
      // Briefly show toolbar when entering/exiting fullscreen, then auto-hide
      setToolbarVisible(true);
      clearTimeout(toolbarTimer.current);
      toolbarTimer.current = setTimeout(() => setToolbarVisible(false), TOOLBAR_HIDE_MS);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, [recalcDims]);

  // ── Toolbar auto-hide (always, not only in fullscreen) ────────────────────
  const showToolbar = useCallback(() => {
    setToolbarVisible(true);
    clearTimeout(toolbarTimer.current);
    toolbarTimer.current = setTimeout(() => setToolbarVisible(false), TOOLBAR_HIDE_MS);
  }, []);

  // Start auto-hide timer on mount (toolbar visible initially, hides after 3s)
  useEffect(() => {
    toolbarTimer.current = setTimeout(() => setToolbarVisible(false), TOOLBAR_HIDE_MS);
    return () => clearTimeout(toolbarTimer.current);
  }, []);

  // ── Pan helpers (all values via refs → stable callback) ──────────────────
  const clampPan = useCallback((x, y) => {
    // Use hysteresis-aware showSpreadRef so pan bounds match the actual rendered layout.
    const inSpread     = showSpreadRef.current;
    const toolbarH     = isFullscreenR.current ? 0 : TOOLBAR_H;
    const bookW        = pageWRef.current * (inSpread ? 2 : 1) * zoomRef.current;
    const bookH        = pageHRef.current * zoomRef.current;
    // Effective viewport height excludes the toolbar so pan stays within the visible area.
    const viewH        = window.innerHeight - toolbarH;
    const maxX         = Math.max(0, (bookW - window.innerWidth) / 2);
    const maxY         = Math.max(0, (bookH - viewH) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, []);

  // Re-clamp pan after every zoom change or page resize.
  // Resets to (0,0) when zoom ≤ 1; otherwise keeps the view inside bounds.
  useEffect(() => {
    if (zoom <= 1) {
      setPanX(0); setPanY(0);
      panXRef.current = 0; panYRef.current = 0;
      return;
    }
    const c = clampPan(panXRef.current, panYRef.current);
    if (c.x !== panXRef.current || c.y !== panYRef.current) {
      setPanX(c.x); setPanY(c.y);
    }
  }, [zoom, pageW, pageH, clampPan]);

  // ── Zoom helpers ──────────────────────────────────────────────────────────
  const changeZoom = useCallback((delta) => {
    setZoom(z => {
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(z + delta).toFixed(2)));
      zoomRef.current = next; // sync immediately so clampPan reads the right value
      return next;
    });
    // Zoom button always re-centers — don't carry stale pan offset into new zoom level
    setPanX(0); setPanY(0);
    panXRef.current = 0; panYRef.current = 0;
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  }, []);

  const handleDoubleClick = useCallback(() => {
    setZoom(z => {
      const next = z < 1.4 ? 1.8 : 1;
      if (next === 1) { setPanX(0); setPanY(0); }
      return next;
    });
  }, []);

  // ── Mouse drag (desktop pan when zoomed) ──────────────────────────────────
  const onMouseDown = useCallback((e) => {
    if (zoomRef.current <= 1) return;
    isDragging.current = true;
    setDragging(true);
    dragStart.current = {
      x: e.clientX, y: e.clientY,
      panX: panXRef.current, panY: panYRef.current,
    };
    e.preventDefault();
  }, []);

  const onMouseMove = useCallback((e) => {
    showToolbar();
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    const c = clampPan(dragStart.current.panX + dx, dragStart.current.panY + dy);
    setPanX(c.x);
    setPanY(c.y);
  }, [showToolbar, clampPan]);

  const onMouseUp = useCallback(() => {
    isDragging.current = false;
    setDragging(false);
  }, []);

  // ── Touch: swipe / pinch-to-zoom / single-finger pan ─────────────────────
  // Registered via native listeners (passive:false) for pinch preventDefault
  useEffect(() => {
    const el = flipAreaRef.current;
    if (!el) return;

    const onTouchStart = (e) => {
      showToolbar();
      if (e.touches.length === 2) {
        isPinching.current          = true;
        lastGestureWasPinch.current = true; // mark: fingers in a pinch gesture
        initPinchDist.current       = pinchDist(e.touches);
        initZoom.current            = zoomRef.current;
      } else if (e.touches.length === 1) {
        isPinching.current          = false;
        lastGestureWasPinch.current = false; // fresh single-finger gesture
        const t = e.touches[0];
        touchStartX.current    = t.clientX;
        touchStartY.current    = t.clientY;
        touchStartTime.current = Date.now();
        prevTouchPos.current   = { x: t.clientX, y: t.clientY }; // for incremental pan
        dragStart.current      = {
          x: t.clientX, y: t.clientY,
          panX: panXRef.current, panY: panYRef.current,
        };
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && isPinching.current) {
        e.preventDefault(); // requires non-passive listener
        const dist    = pinchDist(e.touches);
        const newZoom = +(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
          initZoom.current * (dist / initPinchDist.current)
        )).toFixed(2));
        zoomRef.current = newZoom; // sync immediately so single-finger pan guard reads correct value
        setZoom(newZoom);
        // After pinch, clampPan will run via the zoom effect. No pan reset here.
      } else if (e.touches.length === 1 && zoomRef.current > 1) {
        // ── Single-finger pan when zoomed (incremental delta) ───────────────
        // Incremental approach: delta from previous frame, not from gesture start.
        // This correctly handles pinch → single-finger transitions without position jumps.
        e.preventDefault();
        isDragging.current = true;
        setDragging(true);
        const curX = e.touches[0].clientX;
        const curY = e.touches[0].clientY;
        const dx   = curX - prevTouchPos.current.x;
        const dy   = curY - prevTouchPos.current.y;
        prevTouchPos.current = { x: curX, y: curY };
        const c = clampPan(panXRef.current + dx, panYRef.current + dy);
        setPanX(c.x);
        setPanY(c.y);
        panXRef.current = c.x;
        panYRef.current = c.y;
      } else if (e.touches.length === 1 && zoomRef.current <= 1) {
        // ── Prevent browser scroll only on confirmed horizontal swipe ────────
        const curDx = Math.abs(e.touches[0].clientX - touchStartX.current);
        const curDy = Math.abs(e.touches[0].clientY - touchStartY.current);
        if (curDx > 35 && curDx > curDy * 1.2) e.preventDefault();
      }
    };

    const onTouchEnd = (e) => {
      // End drag state so CSS transition re-enables (snap-back feel)
      isDragging.current = false;
      setDragging(false);

      // Guard: if we were pinching, don't process as a swipe.
      // When one finger lifts during a pinch (e.touches.length === 1), update
      // prevTouchPos so the remaining finger can pan smoothly without a jump.
      if (isPinching.current || lastGestureWasPinch.current) {
        isPinching.current = false;
        if (e.touches.length === 1) {
          // Remaining finger becomes new pan anchor
          prevTouchPos.current = {
            x: e.touches[0].clientX,
            y: e.touches[0].clientY,
          };
        } else if (e.touches.length === 0) {
          lastGestureWasPinch.current = false;
        }
        return;
      }

      if (e.changedTouches.length !== 1) return;
      const touch = e.changedTouches[0];

      const dx    = touchStartX.current - touch.clientX;
      const dy    = touchStartY.current - touch.clientY;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // ── Double-tap detection ─────────────────────────────────────────────
      // A tap has negligible movement (< 10px). Two taps within 300ms and 30px
      // of each other toggle zoom 1× ↔ 1.8×. Must be checked before swipe so
      // a tap never accidentally triggers a page flip.
      const isTap = absDx < 10 && absDy < 10;
      const now   = Date.now();
      const timeSinceLast = now - lastTapTime.current;
      const distFromLast  = Math.hypot(touch.clientX - lastTapX.current,
                                       touch.clientY - lastTapY.current);

      if (isTap && timeSinceLast < 400 && distFromLast < 30) {
        // Double-tap confirmed → toggle zoom
        handleDoubleClick();
        lastTapTime.current = 0; // reset so triple-tap doesn't retrigger
        return;
      }

      // Record tap position for potential double-tap pairing
      if (isTap) {
        lastTapTime.current = now;
        lastTapX.current    = touch.clientX;
        lastTapY.current    = touch.clientY;
      } else {
        lastTapTime.current = 0; // swipe/pan resets the double-tap window
      }

      // ── Swipe-to-flip (only when not zoomed) ────────────────────────────
      if (zoomRef.current <= 1) {
        // Reject if not clearly horizontal: >35 px AND >1.2× more horizontal than vertical
        if (absDx <= 35 || absDx <= absDy * 1.2) return;

        // Hebrew RTL book: swipe right (left→right, dx < 0) = next page
        //                  swipe left  (right→left, dx > 0) = prev page
        if (dx < 0) goNext();
        else        goPrev();
      }
    };

    // Reset all gesture state on system cancel (iOS interrupt, notification, etc.)
    const onTouchCancel = () => {
      isPinching.current          = false;
      lastGestureWasPinch.current = false;
      isDragging.current          = false;
      setDragging(false);
    };

    el.addEventListener('touchstart',  onTouchStart,  { passive: true });
    el.addEventListener('touchmove',   onTouchMove,   { passive: false });
    el.addEventListener('touchend',    onTouchEnd,    { passive: true });
    el.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      el.removeEventListener('touchstart',  onTouchStart);
      el.removeEventListener('touchmove',   onTouchMove);
      el.removeEventListener('touchend',    onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  // loadingInit in deps: on first mount flipAreaRef.current is null (loading screen
  // renders instead of the viewer), so the effect returns early. Adding loadingInit
  // forces the effect to re-run when loading finishes and the viewer div is in the DOM.
  }, [goNext, goPrev, showToolbar, clampPan, handleDoubleClick, loadingInit]);

  // ── Window resize → update spread mode + recalc dims ─────────────────────
  useEffect(() => {
    const onResize = () => {
      const newSpread = window.innerWidth >= SPREAD_BREAKPOINT;
      if (newSpread !== spreadRef.current) {
        setSpreadMode(newSpread);
        spreadRef.current = newSpread;
      }
      recalcDims();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [recalcDims]);

  // ── Analytics (zoom) ──────────────────────────────────────────────────────
  useEffect(() => { track('zoom_change', { brochureId: id, zoom }); }, [id, zoom]);

  // ── Apply appearance (sync before paint) ─────────────────────────────────
  useLayoutEffect(() => applyAppearance(appearance, 'viewer'), [appearance]);

  // ── Load appearance from API + extract autoTheme if needed ───────────────
  useEffect(() => {
    if (!pdfDoc) return;
    let live = true;
    loadAndApplyAppearance(id, pdfDoc, (a) => { if (live) setAppearance(a); });
    return () => { live = false; };
  }, [id, pdfDoc]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────
  const qrForPage = (p) => (metadata?.qrCodes  || []).filter(q => q.page === p);
  const hsForPage = (p) => (metadata?.hotspots || []).filter(h => h.page === p);

  // ─────────────────────────────────────────────────────────────────────────
  // Loading / error states
  // ─────────────────────────────────────────────────────────────────────────
  if (loadingInit || !pageW) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'transparent',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
      }}>
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          {S.loadingFirstPage}
        </p>
      </div>
    );
  }

  if (!brochure) {
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'transparent',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 12,
      }}>
        <div style={{ fontSize: '3rem' }}>📄</div>
        <p style={{ color: 'var(--danger)' }}>{S.brochureNotFound}</p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {S.brochureNotFoundSub}
        </p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Main render
  // ─────────────────────────────────────────────────────────────────────────
  // Hysteresis: collapse to single-page when zoom > 1.05, restore spread at zoom ≤ 1.0.
  // This prevents the book from remounting on tiny zoom fluctuations around zoom=1.
  if (!spreadMode) {
    showSpreadRef.current = false;
  } else if (zoom > 1.05 && showSpreadRef.current) {
    showSpreadRef.current = false;
  } else if (zoom <= 1.0 && !showSpreadRef.current) {
    showSpreadRef.current = spreadMode;
  }
  // In the hysteresis zone (1.0 < zoom ≤ 1.05) showSpreadRef.current is unchanged.
  const showSpread = showSpreadRef.current;

  return (
    <div
      className="viewer-flip-page"
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div className={`viewer-flip-toolbar${toolbarVisible ? '' : ' hidden'}`}>
        <Link to={`/brochure/${id}`} className="btn btn-ghost btn-sm">
          {S.backToViewer}
        </Link>

        <button className="btn btn-ghost btn-sm" onClick={() => setTocOpen(o => !o)}
          title={S.toggleToc}>
          {S.tocToggleBtn}
        </button>

        <div className="viewer-flip-title">{brochure.title}</div>

        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {S.pageOfTotal(currentPage, numPages)}
        </span>

        <button className="btn btn-ghost btn-sm" onClick={goPrev}
          disabled={currentPage <= 1}>›</button>
        <button className="btn btn-ghost btn-sm" onClick={goNext}
          disabled={currentPage >= numPages}>‹</button>

        <div className="zoom-controls">
          <button onClick={() => changeZoom(-ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>−</button>
          <span className="zoom-val">{Math.round(zoom * 100)}%</span>
          <button onClick={() => changeZoom(+ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>+</button>
          <button onClick={resetZoom} title={S.resetZoomBtn}
            style={{ fontSize: '0.75rem' }}>{S.resetZoomBtn}</button>
        </div>

        {brochure && (
          <ShareDownloadBar
            brochure={brochure}
            viewUrl={`${window.location.origin}/brochure/${id}`}
          />
        )}

        <button className="btn btn-ghost btn-sm" onClick={toggleFullscreen}
          title={isFullscreen ? S.exitFullscreenBtn : S.fullscreenBtn}
          style={{ fontSize: '0.8rem' }}>
          {isFullscreen ? S.exitFullscreenBtn : S.fullscreenBtn}
        </button>
      </div>

      {/* ── Flip area ──────────────────────────────────────────────────── */}
      <div
        ref={flipAreaRef}
        className={`viewer-flip-area${isFullscreen ? ' is-fullscreen' : ''}`}
        onDoubleClick={handleDoubleClick}
        onMouseDown={onMouseDown}
        style={{ cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }}
      >
        {/* Pan + Zoom transform — translate BEFORE scale so translation is in screen space */}
        <div style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: 'center center',
          willChange: 'transform',
          // Suppress transition while actively dragging (no lag); re-enable for snap-back
          transition: dragging ? 'none' : 'transform 0.12s ease',
        }}>
          {/* scaleX(-1) on outer wrapper reverses the flip animation to Hebrew RTL direction
              (pages enter from left) in BOTH portrait and spread modes.
              Each FlipPage has a compensating inner scaleX(-1) so content stays readable.
              spread-container class is still only applied in 2-page spread layout. */}
          <div
            className={showSpread ? 'spread-container' : undefined}
            style={{ transform: 'scaleX(-1)' }}
          >
            {numPages > 0 && (
              <HTMLFlipBook
                key={showSpread ? 'spread' : 'portrait'}
                ref={bookRef}
                width={pageW}
                height={pageH}
                size="fixed"
                usePortrait={!showSpread}
                useMouseEvents={false}
                mobileScrollSupport={false}
                drawShadow={true}
                showPageCorners={false}
                flippingTime={500}
                startPage={currentPage - 1}
                startZIndex={0}
                autoSize={false}
                clickEventForward={true}
                onFlip={handleFlip}
                style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.8)' }}
              >
                {Array.from({ length: numPages }, (_, i) => {
                  const p = i + 1;
                  return (
                    <FlipPage
                      key={p}
                      pageNum={p}
                      pgData={pages[p]}
                      pageW={pageW}
                      pageH={pageH}
                      qrCodes={qrForPage(p)}
                      hotspots={hsForPage(p)}
                      onNavigate={goTo}
                      spread={true}
                    />
                  );
                })}
              </HTMLFlipBook>
            )}
          </div>
        </div>

        {/* Side nav arrow overlays */}
        <button
          className="flip-nav-arrow flip-nav-prev"
          onClick={goPrev}
          disabled={currentPage <= 1}
          aria-label="עמוד קודם"
        >›</button>
        <button
          className="flip-nav-arrow flip-nav-next"
          onClick={goNext}
          disabled={currentPage >= numPages}
          aria-label="עמוד הבא"
        >‹</button>
      </div>

      {/* ── TOC Drawer ─────────────────────────────────────────────────── */}
      <TocDrawer
        open={tocOpen}
        onClose={() => setTocOpen(false)}
        items={(metadata?.toc?.length > 0) ? metadata.toc : MOCK_TOC}
        currentPage={currentPage}
        onSelect={(page) => { track('toc_click', { brochureId: id, page }); goTo(page); setTocOpen(false); }}
      />
    </div>
  );
}
