// Shared IP-based rate limiter for Read2Lead access-code endpoints.
// Goal: stop brute-force enumeration of access codes (code is short, codes
// leak child name + progress on a hit). Reuses the existing READ2LEAD_CODES
// KV binding with an `rl:` key prefix so no new infra needs provisioning.
//
// Strategy: count failed code lookups per client IP inside a rolling window.
// Once FAIL_LIMIT failures accumulate, block that IP for BLOCK_SECONDS.
// Successful lookups are NOT counted, so legitimate parents are unaffected.

const FAIL_LIMIT = 8; // failed code attempts allowed inside the window
const WINDOW_SECONDS = 10 * 60; // rolling window for counting failures
const BLOCK_SECONDS = 10 * 60; // how long an IP stays blocked after hitting the limit

export function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0].trim() ||
    'unknown'
  );
}

// Returns { blocked: boolean, retryAfter?: number }.
// Call BEFORE doing the KV code lookup. Fail-open: any KV error -> not blocked,
// so a rate-limit storage hiccup never breaks legitimate code lookups.
export async function checkCodeRateLimit(kv, ip) {
  if (!kv) return { blocked: false };
  try {
    const record = await kv.get(`rl:${ip}`, { type: 'json' });
    if (!record) return { blocked: false };
    const now = Math.floor(Date.now() / 1000);
    if (record.blocked_until && now < record.blocked_until) {
      return { blocked: true, retryAfter: record.blocked_until - now };
    }
    return { blocked: false };
  } catch {
    return { blocked: false };
  }
}

// Call AFTER a failed code lookup (code_not_found). Increments the counter
// and arms a block once the limit is reached. Best-effort; never throws
// (KV write-quota exhaustion must not break the endpoint).
export async function recordCodeFailure(kv, ip) {
  if (!kv) return;
  const key = `rl:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  try {
    let record = await kv.get(key, { type: 'json' });

    // Start a fresh window if none exists or the previous one expired.
    if (!record || now - record.first_at > WINDOW_SECONDS) {
      record = { count: 0, first_at: now, blocked_until: 0 };
    }

    record.count += 1;
    if (record.count >= FAIL_LIMIT) {
      record.blocked_until = now + BLOCK_SECONDS;
    }

    // TTL lets the key self-clean so KV does not accumulate stale IPs.
    await kv.put(key, JSON.stringify(record), {
      expirationTtl: WINDOW_SECONDS + BLOCK_SECONDS,
    });
  } catch {
    // swallow — rate limiting is best-effort, availability comes first
  }
}

// ---------------------------------------------------------------------------
// Signup abuse fence (R2L-OPEN-ACCESS) — a SEPARATE limiter from the one
// above. checkCodeRateLimit/recordCodeFailure guard code LOOKUPS and are
// deliberately fail-OPEN (a storage hiccup must never lock out a legitimate
// parent typing a code). This one guards code MINTING: every signup fence
// must fail CLOSED (spec: "every fence fails closed"), because an open
// failure mode here means unmetered self-serve code creation, not just a
// slower lookup. Reuses the READ2LEAD_CODES KV binding with its own `rl-signup:`
// key prefix — no new infra.

const SIGNUP_IP_LIMIT = 3; // max self-serve signups per IP per rolling day
const SIGNUP_IP_WINDOW_SECONDS = 24 * 60 * 60;

export function signupIpKey(ip) {
  return `rl-signup:${ip}`;
}

// Returns { blocked: boolean, reason?: string }. Call BEFORE minting a code.
// Fail-closed: a missing binding or a KV read error blocks the signup.
export async function checkSignupIpLimit(kv, ip) {
  if (!kv) return { blocked: true, reason: 'kv_missing' };
  try {
    const record = await kv.get(signupIpKey(ip), { type: 'json' });
    if (!record) return { blocked: false };
    const now = Math.floor(Date.now() / 1000);
    if (now - record.first_at < SIGNUP_IP_WINDOW_SECONDS && record.count >= SIGNUP_IP_LIMIT) {
      return { blocked: true, reason: 'ip_daily_limit' };
    }
    return { blocked: false };
  } catch {
    return { blocked: true, reason: 'kv_error' };
  }
}

// Call AFTER a successful signup (never on a refused/failed attempt, so a
// bad request never burns a legitimate parent's daily allowance). Best-effort;
// never throws — a write hiccup here just means the window doesn't advance.
export async function recordSignupIp(kv, ip) {
  if (!kv) return;
  const key = signupIpKey(ip);
  const now = Math.floor(Date.now() / 1000);
  try {
    let record = await kv.get(key, { type: 'json' });
    if (!record || now - record.first_at >= SIGNUP_IP_WINDOW_SECONDS) {
      record = { count: 0, first_at: now };
    }
    record.count += 1;
    await kv.put(key, JSON.stringify(record), { expirationTtl: SIGNUP_IP_WINDOW_SECONDS });
  } catch {
    // swallow — best-effort bookkeeping, never blocks the response
  }
}

export function rateLimitedResponse(retryAfter) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: 'rate_limited',
      message: 'Bạn đã thử mã sai quá nhiều lần. Vui lòng đợi ít phút rồi thử lại, hoặc nhắn Zalo Felix.',
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Retry-After': String(retryAfter || BLOCK_SECONDS),
      },
    },
  );
}
