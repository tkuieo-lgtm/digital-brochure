/**
 * analytics.js – MVP event storage + aggregation.
 *
 * Storage: one JSONL file per calendar day  →  analytics bucket: events-YYYY-MM-DD.jsonl
 *
 * Routes:
 *   POST /api/analytics/event                            – append one event
 *   GET  /api/analytics/summary?brochureId&from&to      – KPIs + top pages
 *   GET  /api/analytics/events?brochureId&from&to       – raw events (for CSV export)
 */

import { Router } from 'express';
import * as storage from '../lib/storage.js';

const router = Router();

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Load all events in [from, to] date range (YYYY-MM-DD strings, inclusive).
 * Downloads all day-files in parallel.
 */
async function loadEvents(from, to) {
  const today = new Date().toISOString().slice(0, 10);
  const start = from ?? today;
  const end   = to   ?? today;

  // Build list of dates
  const dates = [];
  const cur   = new Date(start + 'T00:00:00Z');
  const last  = new Date(end   + 'T00:00:00Z');
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  // Download all day-files in parallel
  const allLines = await Promise.all(
    dates.map(async (date) => {
      try {
        const buf = await storage.download('analytics', `events-${date}.jsonl`);
        if (!buf) return [];
        return buf.toString('utf8').trim().split('\n').filter(Boolean);
      } catch { return []; }
    })
  );

  const events = [];
  for (const lines of allLines) {
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch { /* skip corrupt line */ }
    }
  }
  return events;
}

function buildSummary(events) {
  const sessions    = new Set();
  const pageViews   = {};
  const eventCounts = {};
  let   totalDwell  = 0;
  let   dwellCount  = 0;

  for (const e of events) {
    if (e.sessionId) sessions.add(e.sessionId);
    if (e.event)     eventCounts[e.event] = (eventCounts[e.event] ?? 0) + 1;
    if (e.event === 'page_change' && e.page) {
      pageViews[e.page] = (pageViews[e.page] ?? 0) + 1;
    }
    if (e.event === 'session_end' && e.dwellTime) {
      totalDwell += e.dwellTime;
      dwellCount++;
    }
  }

  const topPages = Object.entries(pageViews)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([page, views]) => ({ page: Number(page), views }));

  return {
    sessions:    sessions.size,
    events:      events.length,
    eventCounts,
    topPages,
    avgDwellSec: dwellCount ? Math.round(totalDwell / dwellCount / 1000) : 0,
  };
}

// ─── routes ───────────────────────────────────────────────────────────────────

// POST /api/analytics/event
router.post('/event', async (req, res) => {
  const event = req.body;
  if (!event?.event) return res.status(400).json({ error: 'event name required' });

  const line = JSON.stringify({
    ...event,
    ip:         req.ip,
    receivedAt: new Date().toISOString(),
  }) + '\n';

  const date = new Date().toISOString().slice(0, 10);
  const path = `events-${date}.jsonl`;

  // Best-effort: download existing content, append new line, re-upload
  try {
    let existing = '';
    const buf = await storage.download('analytics', path);
    if (buf) existing = buf.toString('utf8');
    await storage.upload('analytics', path, Buffer.from(existing + line), 'text/plain');
  } catch { /* best effort — never block the response */ }

  res.json({ ok: true });
});

// GET /api/analytics/summary?brochureId=...&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/summary', async (req, res) => {
  const { brochureId, from, to } = req.query;
  try {
    let events = await loadEvents(from, to);
    if (brochureId) events = events.filter(e => e.brochureId === brochureId);
    res.json(buildSummary(events));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/events?brochureId=...&from=...&to=...
router.get('/events', async (req, res) => {
  const { brochureId, from, to } = req.query;
  try {
    let events = await loadEvents(from, to);
    if (brochureId) events = events.filter(e => e.brochureId === brochureId);
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
