// Read the captured speaking-check error ring for diagnosis.
// Secret-gated: GET /api/debug-speaking?key=<DEBUG_SPEAKING_KEY env>
// Returns the recent speaking failures (audio type/size, Groq status, UA) so the
// root cause can be confirmed after a fix without DevTools or live log tailing.
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

  const errors = await env.READ2LEAD_CODES.get('debug:speaking-errors', { type: 'json' });
  return json({
    ok: true,
    count: Array.isArray(errors) ? errors.length : 0,
    errors: Array.isArray(errors) ? errors : [],
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
