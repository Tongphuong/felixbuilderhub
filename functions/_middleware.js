// Basic Auth gate for /admin/* and /api/admin/* paths.
// Requires ADMIN_PASSWORD env var set in Cloudflare Pages dashboard.
// Username field is ignored — only the password is checked.

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
  const needsAuth = path.startsWith('/admin') || path.startsWith('/api/admin');

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

  return next();
}
