/**
 * storage.js — Supabase Storage abstraction layer.
 *
 * All backend code that previously used fs.readFileSync / writeFileSync / etc.
 * on backend/storage/ directories now calls these functions instead.
 *
 * Bucket mapping (must exist in Supabase project):
 *   pdfs          (public)  — PDF uploads
 *   metadata      (public)  — per-brochure JSON files
 *   qr-overrides  (public)  — generated QR override PNGs
 *   backgrounds   (public)  — per-brochure background images
 *   analytics     (private) — daily JSONL event files
 *
 * Required env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing Supabase env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.'
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── Helpers ────────────────────────────────────────────────────────────────

function isNotFound(error) {
  if (!error) return false;
  return (
    error.statusCode === '404' ||
    error.statusCode === 404 ||
    (typeof error.message === 'string' &&
      error.message.toLowerCase().includes('not found'))
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Upload a Buffer / Uint8Array to a Supabase Storage bucket.
 * Always upserts (overwrites if the file already exists).
 */
export async function upload(bucket, path, buffer, contentType = 'application/octet-stream') {
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, { contentType, upsert: true });
  if (error) {
    throw new Error(`[storage] upload ${bucket}/${path}: ${error.message}`);
  }
}

/**
 * Download a file and return it as a Node.js Buffer.
 * Returns null if the file does not exist (404).
 * Throws for any other error.
 */
export async function download(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) {
    if (isNotFound(error)) return null;
    throw new Error(`[storage] download ${bucket}/${path}: ${error.message}`);
  }
  if (!data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * List files in a bucket under a given prefix.
 * Returns an array of file objects: [{ name, id, ... }].
 */
export async function list(bucket, prefix = '') {
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (error) {
    throw new Error(`[storage] list ${bucket}/${prefix}: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Remove one or more files from a bucket.
 * @param {string}          bucket
 * @param {string|string[]} paths  — single path or array of paths
 */
export async function remove(bucket, paths) {
  const arr = Array.isArray(paths) ? paths : [paths];
  const { error } = await supabase.storage.from(bucket).remove(arr);
  if (error) {
    throw new Error(`[storage] remove ${bucket} [${arr.join(', ')}]: ${error.message}`);
  }
}

/**
 * Return the public URL for a file (synchronous — no network call).
 * Only works for public buckets.
 */
export function getPublicUrl(bucket, path) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
