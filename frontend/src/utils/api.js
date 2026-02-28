const BASE = '/api';

async function req(method, path, body) {
  const opts = { method, headers: {} };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    opts.body = body;
  }
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// Brochures
export const api = {
  listBrochures: () => req('GET', '/brochures'),
  getBrochure: (id) => req('GET', `/brochures/${id}`),
  createBrochure: (formData) => req('POST', '/brochures', formData),
  updateBrochure: (id, data) => req('PUT', `/brochures/${id}`, data),
  deleteBrochure: (id) => req('DELETE', `/brochures/${id}`),

  // Metadata
  getMetadata: (id) => req('GET', `/metadata/${id}`),
  updateMetadata: (id, data) => req('PUT', `/metadata/${id}`, data),
  submitQrScan: (id, qrCodes) => req('POST', `/metadata/${id}/qr-scan`, { qrCodes }),
  rescanQr: (id) => req('POST', `/metadata/${id}/qr-rescan`),
  scanRoi:  (id, data) => req('POST', `/metadata/${id}/qr-scan-roi`, data),

  updateQr: (id, qrId, data) => req('PUT',   `/metadata/${id}/qr/${qrId}`, data),
  patchQr:  (id, qrId, data) => req('PATCH', `/metadata/${id}/qr/${qrId}`, data),
  deleteQr: (id, qrId) => req('DELETE', `/metadata/${id}/qr/${qrId}`),

  addHotspot: (id, data) => req('POST', `/metadata/${id}/hotspots`, data),
  updateHotspot: (id, hsId, data) => req('PUT', `/metadata/${id}/hotspots/${hsId}`, data),
  deleteHotspot: (id, hsId) => req('DELETE', `/metadata/${id}/hotspots/${hsId}`),

  updateToc: (id, toc) => req('PUT', `/metadata/${id}/toc`, { toc }),

  // Appearance (per-brochure theme / background)
  getAppearance:    (id)       => req('GET', `/metadata/${id}/appearance`),
  saveAppearance:   (id, data) => req('PUT', `/metadata/${id}/appearance`, data),
  uploadBackground: (id, file) => {
    const fd = new FormData();
    fd.append('image', file);
    return req('POST', `/brochures/${id}/background`, fd);
  },

  // Analytics
  getAnalyticsSummary: (brochureId, from, to) => {
    const p = new URLSearchParams();
    if (brochureId) p.set('brochureId', brochureId);
    if (from) p.set('from', from);
    if (to)   p.set('to',   to);
    return req('GET', `/analytics/summary?${p}`);
  },
  getAnalyticsEvents: (brochureId, from, to) => {
    const p = new URLSearchParams();
    if (brochureId) p.set('brochureId', brochureId);
    if (from) p.set('from', from);
    if (to)   p.set('to',   to);
    return req('GET', `/analytics/events?${p}`);
  },
};
