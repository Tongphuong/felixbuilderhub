const COOKIE = '__Host-r2l_preview';
const LOGIN = '/private-rehearsal/login';
const unavailable = () => new Response('Story testing is temporarily unavailable.', {
  status: 503, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
});

/** Maintenance-only adult lane. The existing backend authenticates every request
 * and owns only fabricated QA records. Never forward an admin request.
 */
export async function maintenanceGateway(request, env) {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/admin') || path.startsWith('/api/admin')) return null;
  const hasCookie = (request.headers.get('cookie') || '').split(';')
    .some(value => value.trim().startsWith(COOKIE + '='));
  if (path !== LOGIN && !hasCookie) return null;
  if (!env.R2L_MAINTENANCE_STATE) return unavailable();
  try {
    const namespace = env.R2L_MAINTENANCE_STATE;
    const response = await namespace.get(namespace.idFromName('private-adult-preview-v1')).fetch(request);
    // Public navigation/static assets absent from the test package still belong
    // to the original site. Never fall through for API or private-package paths.
    if (response.status === 404 && ['GET', 'HEAD'].includes(request.method) &&
        !path.startsWith('/api/') && !path.startsWith('/__private/') && path !== LOGIN) {
      await response.body?.cancel();
      return null;
    }
    return response;
  } catch { return unavailable(); }
}
