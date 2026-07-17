// Read-only Azure voice-quota meter, for the external Cloudflare-bindings
// monitor (rule R1 in ~/.claude/rules/mcp-recipes.md): the bindings MCP
// server cannot read a KV value directly, so this is the HTTPS read surface.
// Secret-gated: GET /api/voice-quota?key=<DEBUG_SPEAKING_KEY env>
// Reuses the same secret and 404-on-miss pattern as debug-speaking.js /
// debug-convo-flags.js (same threat model — a Phuong-only diagnostic
// surface, not worth provisioning a second secret for).
import { azureUsageKey, AZURE_PA_MONTHLY_FREE_SECONDS } from './_azure-pronunciation.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.READ2LEAD_CODES) {
    return json({ error: 'config_error' }, 500);
  }

  const url = new URL(request.url);
  const provided = url.searchParams.get('key') || '';
  const secret = env.DEBUG_SPEAKING_KEY || '';

  // 404 (not 401) so the endpoint is invisible without the secret.
  if (!secret || provided !== secret) {
    return new Response('Not found', { status: 404 });
  }

  const now = new Date();
  const usageKey = azureUsageKey(now);
  const used = Number(await env.READ2LEAD_CODES.get(usageKey, { type: 'json' })) || 0;

  return json({
    ok: true,
    month: usageKey.slice('azure-pa-secs:'.length),
    used_seconds: used,
    cap_seconds: AZURE_PA_MONTHLY_FREE_SECONDS,
    pct: Math.round((used / AZURE_PA_MONTHLY_FREE_SECONDS) * 100),
    alert: used / AZURE_PA_MONTHLY_FREE_SECONDS >= 0.8,
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
