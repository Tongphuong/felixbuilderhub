// Read the captured conversation-guardrail flag ring for Phuong's review.
// Secret-gated: GET /api/debug-convo-flags?key=<DEBUG_SPEAKING_KEY env>
// Reuses the same secret as debug-speaking.js (same threat model: a
// Phuong-only diagnostic surface, not worth provisioning a second secret
// for) -- see functions/api/debug-speaking.js for the twin pattern.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const provided = url.searchParams.get('key') || '';
  const secret = env.DEBUG_SPEAKING_KEY || '';

  // 404 (not 401) so the endpoint is invisible without the secret.
  if (!secret || provided !== secret) {
    return new Response('Not found', { status: 404 });
  }
  if (!env.READ2LEAD_CODES) {
    return json({ ok: false, error: 'no_kv' }, 500);
  }

  const flags = await env.READ2LEAD_CODES.get('debug:convo-flags', { type: 'json' });
  const timing = await env.READ2LEAD_CODES.get('debug:convo-timing', { type: 'json' });
  return json({
    ok: true,
    count: Array.isArray(flags) ? flags.length : 0,
    flags: Array.isArray(flags) ? flags : [],
    timing_count: Array.isArray(timing) ? timing.length : 0,
    timing: Array.isArray(timing) ? timing : [],
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
