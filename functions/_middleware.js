// Basic Auth gate for /admin/* and /api/admin/* paths.
// Requires ADMIN_PASSWORD env var set in Cloudflare Pages dashboard.
// Username field is ignored — only the password is checked.
import { maintenanceGateway } from './lib/read2lead/maintenance-gateway.mjs';
import { existingTestAccountGateway } from './lib/read2lead/account-gateway.mjs';
import { unifiedAccountGateway } from './lib/read2lead/account-unified-gateway.mjs';

function unauthorized() {
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Felix Admin", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=UTF-8',
      'Cache-Control': 'no-store',
    },
  });
}

function checkBasicAuth(header, expectedPassword) {
  if (!header || !header.startsWith('Basic ')) return false;
  try {
    const decoded = atob(header.slice(6).trim());
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) return false;
    return decoded.slice(colonIdx + 1) === expectedPassword;
  } catch {
    return false;
  }
}

export async function onRequest(context) {
  const { request, env, next } = context;
  const path = new URL(request.url).pathname;
  const finish = response => {
    if (!context.data?.clearRead2LeadTestCookie && !context.data?.clearRead2LeadAccountCookies) return response;
    const headers = new Headers(response.headers);
    headers.append('Set-Cookie', '__Host-r2l_student_test=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    if (context.data?.clearRead2LeadAccountCookies) headers.append('Set-Cookie', '__Host-r2l_account=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
    return new Response(response.body, { status: response.status, headers });
  };
  // Browser-only reset: no account lookup, progress write or token revocation.
  if (path === '/api/read2lead-session-reset') {
    const headers = { 'Cache-Control': 'no-store' };
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, Allow: 'POST' } });
    if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') {
      return new Response(null, { status: 403, headers });
    }
    (context.data ??= {}).clearRead2LeadAccountCookies = true;
    return finish(new Response(null, { status: 204, headers }));
  }
  // The Pages router matches paths case-insensitively, so decide on a normalised path
  // (decoded once, lower-cased, repeated slashes collapsed); any variant of /admin or /api/admin needs auth.
  let normalised = path;
  try {
    normalised = decodeURIComponent(path);
  } catch {
    // Malformed escape somewhere: still decode every VALID %XX so an encoded "admin" cannot hide behind it.
    normalised = path.replace(/%[0-9a-f]{2}/gi, (s) => { try { return decodeURIComponent(s); } catch { return s; } });
  }
  normalised = normalised.toLowerCase().replace(/\/{2,}/g, '/');
  // Belt and braces: a stray % that survives decoding next to the word "admin" is treated as admin (fail closed).
  const needsAuth = normalised.startsWith('/admin') || normalised.startsWith('/api/admin') ||
    (normalised.includes('%') && normalised.includes('admin'));

  if (needsAuth) {
    if (!env.ADMIN_PASSWORD) {
      return new Response('Admin disabled: ADMIN_PASSWORD env var not set.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
      });
    }
    if (!checkBasicAuth(request.headers.get('Authorization'), env.ADMIN_PASSWORD)) {
      return unauthorized();
    }
  }

  try {
    const account = env.R2L_ACCOUNT_MODE ? await unifiedAccountGateway(context) : await existingTestAccountGateway(context);
    if (account) return finish(account);
    const maintenance = !env.R2L_ACCOUNT_MODE || path === '/private-rehearsal/login' ? await maintenanceGateway(request, env) : null;
    return finish(maintenance || await next());
  } catch (error) {
    if (error?.message === 'legacy_account_fenced' || error?.message === 'invalid_legacy_account_fence') {
      return finish(Response.json({ code: env.R2L_ACCOUNT_MODE ? 'account_host_unavailable' : 'test_account_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }));
    }
    throw error;
  }
}
