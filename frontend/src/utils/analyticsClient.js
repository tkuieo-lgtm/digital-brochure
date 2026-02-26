/**
 * analyticsClient – lightweight event tracking.
 *
 * - getSessionId()  persistent session UUID in localStorage
 * - track(name, payload)  sendBeacon first, fetch fallback
 * - sessionStart / sessionEnd  fire on mount / unload
 */

const SESSION_KEY = 'brochure_session_id';
let _sessionStart = Date.now();

function getSessionId() {
  let sid = localStorage.getItem(SESSION_KEY);
  if (!sid) {
    sid = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(SESSION_KEY, sid);
  }
  return sid;
}

export function track(eventName, payload = {}) {
  const data = {
    event:     eventName,
    sessionId: getSessionId(),
    ts:        Date.now(),
    ...payload,
  };
  const body = JSON.stringify(data);
  // sendBeacon is fire-and-forget, works on page unload
  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' });
    if (navigator.sendBeacon('/api/analytics/event', blob)) return;
  }
  fetch('/api/analytics/event', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

export function sessionStart(brochureId, context = '') {
  _sessionStart = Date.now();
  track('session_start', { brochureId, context });
}

export function sessionEnd(brochureId) {
  track('session_end', { brochureId, dwellTime: Date.now() - _sessionStart });
}
