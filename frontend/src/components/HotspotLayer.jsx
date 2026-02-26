/**
 * HotspotLayer – renders clickable overlay areas on a rendered PDF page.
 * All coordinates are normalized (0-1) relative to page dimensions.
 *
 * Props:
 *  - qrCodes:  [{id, url, overrideUrl, overrideImageUrl, location:{x,y,w,h}}]
 *  - hotspots: [{id, label, action:{type,value}, location}]
 *  - onNavigate: (pageNum) => void
 *  - canvasW, canvasH: rendered canvas pixel dimensions
 *
 * QR behaviour:
 *  - If a QR has overrideImageUrl: render an <img> at the bbox so phone cameras
 *    can scan the new QR code directly off the screen. Click opens overrideUrl.
 *  - Otherwise: transparent clickable div (original behaviour).
 */
import { useEffect, useState } from 'react';

// Padding fraction (relative to QR size) added around the square overlay.
const QR_OVERLAY_PAD = 0.12;

// Detect touch-primary device (coarse pointer = mobile/tablet)
const isTouchDevice = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

/**
 * Compute a square, padded, clamped bbox centred on `loc`.
 * Result always covers the original bbox entirely.
 */
function squareBbox(loc) {
  const size = Math.max(loc.w, loc.h);
  const cx   = loc.x + loc.w / 2;
  const cy   = loc.y + loc.h / 2;
  const pad  = size * QR_OVERLAY_PAD;
  const half = (size + pad) / 2;
  const x = Math.max(0, cx - half);
  const y = Math.max(0, cy - half);
  const w = Math.min(1 - x, size + pad);
  const h = Math.min(1 - y, size + pad);
  return { x, y, w, h };
}

export default function HotspotLayer({ qrCodes = [], hotspots = [], onNavigate, canvasW, canvasH }) {
  // On touch devices, briefly pulse all hotspots so they're discoverable
  const [pulsing, setPulsing] = useState(() => isTouchDevice());

  useEffect(() => {
    if (!pulsing) return;
    const t = setTimeout(() => setPulsing(false), 3000);
    return () => clearTimeout(t);
  }, [pulsing]);

  if (!canvasW || !canvasH) return null;

  const handleHotspot = (hs) => {
    if (!hs.action) return;
    if (hs.action.type === 'page') {
      onNavigate(parseInt(hs.action.value, 10));
    } else if (hs.action.type === 'url') {
      window.open(hs.action.value, '_blank', 'noopener,noreferrer');
    }
  };

  const locStyle = (loc) => ({
    position: 'absolute',
    left:   `${loc.x * 100}%`,
    top:    `${loc.y * 100}%`,
    width:  `${loc.w * 100}%`,
    height: `${loc.h * 100}%`,
  });

  return (
    <div className="hotspot-layer">
      {qrCodes.map(qr => {
        const targetUrl = qr.overrideUrl || qr.url;
        const loc       = qr.location;

        if (qr.overrideImageUrl) {
          // Perfect square centred on the original bbox + small padding
          const expanded = squareBbox(loc);
          return (
            <img
              key={qr.id}
              src={qr.overrideImageUrl}
              alt={`QR → ${targetUrl}`}
              title={`QR → ${targetUrl}`}
              onClick={() => window.open(targetUrl, '_blank', 'noopener,noreferrer')}
              style={{
                ...locStyle(expanded),
                display:        'block',
                cursor:         'pointer',
                pointerEvents:  'auto',       // override any parent pointer-events:none
                imageRendering: 'pixelated',  // sharp pixels — no smoothing
                objectFit:      'fill',
              }}
            />
          );
        }

        // Original: transparent clickable hotspot
        return (
          <div
            key={qr.id}
            className={`hotspot-item qr-hotspot${pulsing ? ' hotspot-item--pulse' : ''}`}
            style={locStyle(loc)}
            title={`QR → ${targetUrl}`}
            onClick={() => window.open(targetUrl, '_blank', 'noopener,noreferrer')}
          />
        );
      })}

      {hotspots.map(hs => (
        <div
          key={hs.id}
          className={`hotspot-item${pulsing ? ' hotspot-item--pulse' : ''}`}
          style={locStyle(hs.location)}
          title={hs.label}
          onClick={() => handleHotspot(hs)}
        />
      ))}
    </div>
  );
}
