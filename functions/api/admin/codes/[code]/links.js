// Admin endpoint to generate a magic link token for a specific access code.
// POST /api/admin/codes/:code/links → create a new magic link token
// GET  /api/admin/codes/:code/links → list all magic link tokens for a code
//
// The token is stored in KV under `r2l_link:{token}` and maps to the access code.
// The access code is NEVER exposed in the URL — only the un-guessable token.

import { isAccessCodeKey } from '../../../_read2lead-v2-state.js';

const TOKEN_BYTES = 16; // 16 bytes → 32 hex chars = 128 bits of entropy
const DEFAULT_EXPIRY_DAYS = 60;
const MAX_EXPIRY_DAYS = 3650;
const DEFAULT_MAX_USES = 50;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function generateToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function linkKey(token) {
  return `r2l_link:${token}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/**
 * Validate a magic link record and return an error string or null.
 * Exported for unit tests.
 */
export function validateLinkRecord(record, nowISO = new Date().toISOString().slice(0, 10)) {
  if (!record || typeof record !== 'object') return 'invalid_record';
  if (!record.access_code) return 'missing_access_code';
  if (record.expires_at && record.expires_at < nowISO) return 'link_expired';
  if (record.uses_remaining != null && record.uses_remaining <= 0) return 'link_exhausted';
  return null;
}

export async function onRequestPost(context) {
  const { request, env, params } = context;
  const code = params.code;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  // Verify the access code exists
  const codeData = await env.READ2LEAD_CODES.get(code, { type: 'json' });
  if (!codeData) return json({ ok: false, error: 'code_not_found' }, 404);

  let body = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — use defaults
  }

  const expiryDays = Number(body.expiry_days) || DEFAULT_EXPIRY_DAYS;
  if (!Number.isFinite(expiryDays) || expiryDays < 1 || expiryDays > MAX_EXPIRY_DAYS) {
    return json({ ok: false, error: 'expiry_days_invalid', message: `expiry_days must be 1-${MAX_EXPIRY_DAYS}` }, 400);
  }

  const maxUses = Number(body.max_uses) || DEFAULT_MAX_USES;
  if (!Number.isFinite(maxUses) || maxUses < 1 || maxUses > 10000) {
    return json({ ok: false, error: 'max_uses_invalid', message: 'max_uses must be 1-10000' }, 400);
  }

  const token = generateToken();
  const record = {
    access_code: code,
    created_at: todayISO(),
    expires_at: addDaysISO(expiryDays),
    max_uses: maxUses,
    uses_remaining: maxUses,
    last_used_at: null,
  };

  // TTL = expiry days + 1 day buffer for KV auto-cleanup
  const ttlSeconds = (expiryDays + 1) * 24 * 60 * 60;
  await env.READ2LEAD_CODES.put(linkKey(token), JSON.stringify(record), {
    expirationTtl: ttlSeconds,
  });

  // Also store a reverse index so we can list all links for a code
  const linksIndexKey = `r2l_links:${code}`;
  let linksIndex = [];
  try {
    linksIndex = await env.READ2LEAD_CODES.get(linksIndexKey, { type: 'json' }) || [];
  } catch {
    linksIndex = [];
  }
  linksIndex.push({ token, created_at: record.created_at, expires_at: record.expires_at });
  // Keep only last 20 links per code
  if (linksIndex.length > 20) linksIndex = linksIndex.slice(-20);
  await env.READ2LEAD_CODES.put(linksIndexKey, JSON.stringify(linksIndex));

  const origin = new URL(request.url).origin;
  const link = `${origin}/r2l/start?t=${token}`;

  return json({ ok: true, token, link, record });
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const code = params.code;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  const linksIndex = await env.READ2LEAD_CODES.get(`r2l_links:${code}`, { type: 'json' }) || [];
  const today = todayISO();

  // Enrich with current status
  const items = [];
  for (const entry of linksIndex) {
    const record = await env.READ2LEAD_CODES.get(linkKey(entry.token), { type: 'json' });
    if (!record) {
      // Token was deleted (revoked) or expired from KV — skip
      continue;
    }
    items.push({
      token: entry.token,
      created_at: record.created_at,
      expires_at: record.expires_at,
      uses_remaining: record.uses_remaining,
      max_uses: record.max_uses,
      last_used_at: record.last_used_at,
      is_expired: record.expires_at < today,
      is_exhausted: record.uses_remaining <= 0,
    });
  }

  return json({ ok: true, items });
}

// DELETE /api/admin/codes/:code/links?token=xxx → revoke a specific link
export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const code = params.code;
  if (!env.READ2LEAD_CODES) return json({ ok: false, error: 'KV binding missing' }, 500);

  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ ok: false, error: 'token_required' }, 400);

  // Verify the link belongs to this code
  const record = await env.READ2LEAD_CODES.get(linkKey(token), { type: 'json' });
  if (!record) return json({ ok: false, error: 'link_not_found' }, 404);
  if (record.access_code !== code) return json({ ok: false, error: 'link_code_mismatch' }, 403);

  await env.READ2LEAD_CODES.delete(linkKey(token));

  // Remove from index
  const linksIndexKey = `r2l_links:${code}`;
  let linksIndex = [];
  try {
    linksIndex = await env.READ2LEAD_CODES.get(linksIndexKey, { type: 'json' }) || [];
  } catch {
    linksIndex = [];
  }
  linksIndex = linksIndex.filter((entry) => entry.token !== token);
  await env.READ2LEAD_CODES.put(linksIndexKey, JSON.stringify(linksIndex));

  return json({ ok: true, token });
}