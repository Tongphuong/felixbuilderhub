// Public self-serve signup — mints a Read2Lead access code without a human
// in the loop, replacing the Zalo-to-Phương manual bottleneck.
// POST /api/signup → { ok, code, link, record }
//
// See _ops/specs/SPEC_R2L_OPEN_ACCESS.md (R2L-OPEN-ACCESS), "Accepted risk 2".
//
// SHIPS DARK: gated on `config:signup_enabled` (KV, default absent/off) → 503
// until Phương flips it on. Reuses the code-record factory (byte-compatible
// with admin-created codes) and the existing magic-link mint handler wholesale,
// so a kid never has to retype the code.
//
// Rate-limit fences (Turnstile secret, per-IP, global daily cap) fail CLOSED
// on a missing binding or a KV read/write ERROR. They do NOT claim to be
// atomic against a concurrent BURST — KV has no compare-and-swap, so the
// per-IP and global counters are plain read-modify-write and CAN overshoot
// under concurrency (Buffet review round 2, repro'd with a latencied-KV
// harness). The mitigation below (reserve immediately before minting, then
// re-read both counters after the code+link are written and roll the mint
// back if either landed over its limit) SHRINKS that race window to the
// in-flight duration of one mint — it does not close it. See
// SPEC_R2L_OPEN_ACCESS.md's "Accepted risk 2" for the full bound analysis and
// why a Cloudflare edge Rate Limiting rule is a hard precondition for launch.

import { generateUniqueCodeForName, buildCodeRecord } from './_code-factory.js';
import { onRequestPost as mintLinkForCode, linkKey } from './admin/codes/[code]/links.js';
import { getClientIp, reserveSignupIp, readSignupIpCount, SIGNUP_IP_LIMIT } from './_rate-limit.js';

const SIGNUP_USES_TOTAL = 3;
const SIGNUP_EXPIRY_DAYS = 90;
const DEFAULT_DAILY_CAP = 50;
const GLOBAL_COUNTER_TTL_SECONDS = 60 * 60 * 48; // mirrors minny-conversation.js's daily/global counter TTL

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// --- Name rules (R2L-FINAL addendum 2026-10-19): the name is shown on public
// rankings as typed, so it is length/charset checked and run past a small
// built-in rude-word blocklist. English entries follow the LDNOOBW list (most
// severe terms); Vietnamese entries are hand-picked. Matching is
// accent-insensitive. Ambiguous short words that are also real names or common
// words (Du, Di, Diễm, Cho, Ngư...) are deliberately NOT listed alone.
const NAME_MAX_LENGTH = 20;
// Letters and single spaces only, NO digits: every accepted name must also pass
// the pack generator's BACKEND_CHILD_NAME_RE (generate-read2lead-pack.js), or a
// child could sign up but never start a lesson. A strict subset of that regex
// (it also allows - and '); tests cross-check the two so they cannot drift.
const NAME_PATTERN = /^\p{L}[\p{L}\p{M}]*(?: \p{L}[\p{L}\p{M}]*)*$/u;

// Long, unambiguous English stems: matched inside any single word of the name
// (never across words, so "Võ Học" cannot join into something else). Short stems
// such as "shit" are whole-word only because they sit inside real names (Kshitij).
const BLOCKED_SUBSTRINGS = [
  'fuck', 'cunt', 'bitch', 'nigger', 'nigga', 'pussy', 'asshole',
  'whore', 'faggot', 'dildo', 'rapist', 'hitler', 'bastard',
];
// Whole words / exact phrases on the ACCENT-FOLDED form. Nothing here may fold to
// a common real name (so no lon/deo/buoi/vo hoc/du ma/thang ngu ...).
const BLOCKED_WORDS_FOLDED = [
  'dick', 'cock', 'slut', 'twat', 'wank', 'piss', 'cum', 'ass', 'arse', 'anus', 'shit', 'shitty',
  'fag', 'retard', 'rape', 'porn', 'sex', 'sexy', 'nude', 'tits', 'boob', 'nazi',
  'dm', 'dmm', 'vcl', 'vkl', 'cl', 'cc', 'ml',
  'dit me', 'khon nan', 'mat day', 'suc vat', 'con cho', 'thang cho', 'oc cho',
];
// Vietnamese terms whose ACCENT-FREE spelling is a real name (lồn/Lôn/Lớn, đụ/Dư, ngu/Ngư):
// matched on the exact typed form (lower-cased, NFC) as whole words or phrases only.
const BLOCKED_WORDS_EXACT = [
  'lồn', 'cặc', 'buồi', 'địt', 'địt mẹ', 'đụ má', 'đụ mẹ', 'đéo', 'đĩ', 'con đĩ', 'cứt',
  'thằng ngu', 'con ngu', 'đồ ngu', 'thang ngu', 'con ngu', 'do ngu', 'dit', 'cac',
];

function foldName(name) {
  return name
    .replace(/[đĐ]/g, 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
}

const hasSubstring = (word) => BLOCKED_SUBSTRINGS.some((w) => word.includes(w));

// Exported for tests.
export function isBlockedName(name) {
  const folded = foldName(name);
  const tokens = folded.split(' ');
  if (tokens.some(hasSubstring)) return true;
  // Spaced-out single letters ("f u c k"): join each run of 3+ one-letter words.
  const runs = folded.match(/(?:^| )(?:\S(?: |$)){3,}/g) || [];
  for (const run of runs) {
    const joined = run.replace(/ /g, '');
    if (hasSubstring(joined) || BLOCKED_WORDS_FOLDED.includes(joined)) return true;
  }
  const paddedFolded = ` ${folded} `;
  if (BLOCKED_WORDS_FOLDED.some((w) => paddedFolded.includes(` ${w} `))) return true;
  const paddedExact = ` ${name.toLowerCase().normalize('NFC')} `;
  return BLOCKED_WORDS_EXACT.some((w) => paddedExact.includes(` ${w} `));
}

// Exported for tests. Returns null when OK, else { error, message }.
export function checkStudentName(name) {
  // After NFC at most ONE combining mark per letter (no stacked "Zalgo" names).
  if (!name || name.length > NAME_MAX_LENGTH || !NAME_PATTERN.test(name) || /\p{M}{2,}/u.test(name)) {
    return {
      error: 'student_name_invalid',
      message: 'Tên của bạn nên dài 1–20 ký tự, chỉ gồm chữ cái và dấu cách (không dùng số) nhé. Bạn thử nhập lại tên nhé!',
    };
  }
  if (isBlockedName(name)) {
    return {
      error: 'student_name_blocked',
      message: 'Tên này chưa phù hợp để hiển thị. Bạn hãy chọn một tên thân thiện khác nhé!',
    };
  }
  return null;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function globalCounterKey() {
  return `signup-global:${todayKey()}`;
}

// Exported for tests — real Turnstile verification is a single POST to
// Cloudflare's siteverify endpoint (no client library, no new dependency).
export async function verifyTurnstile(secret, token, ip, fetchImpl = fetch) {
  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  // Hard 3s ceiling: a hung siteverify must never hold a request (or a lane) open.
  const res = await fetchImpl(TURNSTILE_VERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS) });
  const data = await res.json();
  return data?.success === true;
}

// The unified gateway verifies Turnstile OUTSIDE the serialized account lane, then marks the
// forwarded request with this header. The gateway deletes any incoming copy of it on EVERY
// request, and signup.js only honours it in the account host (R2L_ACCOUNT_MODE set), so a
// client can never forge it. Tokens are single-use, so a verified request is not re-verified.
export const TURNSTILE_VERIFIED_HEADER = 'x-r2l-turnstile-verified';
const TURNSTILE_TIMEOUT_MS = 3000;
const TURNSTILE_TOKEN_MAX = 2048;

// One source of truth for the refusal bodies (signup.js and the gateway answer identically).
const TURNSTILE_REFUSALS = {
  turnstile_not_configured: [503, 'Đăng ký chưa sẵn sàng. Nhắn Zalo Felix nhé.'],
  turnstile_required: [400, 'Bạn hãy hoàn thành bước xác minh trước khi đăng ký nhé.'],
  turnstile_failed: [403, 'Xác minh không thành công. Vui lòng thử lại.'],
  invalid_json: [400, 'Mình chưa đọc được thông tin bạn gửi. Bạn thử lại nhé.'],
};
export function turnstileRefusal(error) {
  const [status, message] = TURNSTILE_REFUSALS[error];
  return json({ ok: false, error, message }, status);
}
// Cheap shape check before any network call. Returns a refusal code or null.
export function turnstileTokenProblem(token) {
  if (!token || typeof token !== 'string') return 'turnstile_required';
  if (token.length > TURNSTILE_TOKEN_MAX) return 'turnstile_failed';
  return null;
}

// Global-cap reserve (mirrors reserveSignupIp in _rate-limit.js, but keyed by
// day rather than by IP — same read-modify-write, same non-atomicity, same
// "reserve before minting" shape). Kept local to signup.js, like
// minny-conversation.js keeps its own convo-global counter inline rather than
// in the shared rate-limit helper.
async function reserveGlobalCount(kv, key, cap) {
  let current;
  try {
    const raw = await kv.get(key, { type: 'json' });
    current = Number.isFinite(raw) ? raw : 0;
  } catch {
    current = cap; // read error => treat as at-cap (fail closed on the ERROR, not a race claim)
  }
  if (current >= cap) return { blocked: true, count: current };
  const next = current + 1;
  try {
    await kv.put(key, JSON.stringify(next), { expirationTtl: GLOBAL_COUNTER_TTL_SECONDS });
  } catch {
    // best-effort — a missed reservation write is the same lack of atomicity
    // this whole mitigation already accepts, not a new failure mode
  }
  return { blocked: false, count: next };
}

// Post-mint recheck for the global counter (companion to readSignupIpCount).
async function readGlobalCount(kv, key) {
  try {
    const raw = await kv.get(key, { type: 'json' });
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    return null;
  }
}

// Best-effort rollback when the post-mint recheck shows either counter landed
// over its limit. Deletes the code record and its magic-link token. Does NOT
// attempt to decrement the reserved counters back down — decrementing under
// concurrent writes has the exact same race this mitigation exists to shrink,
// so the reservation is left in place deliberately (it only overcounts,
// never undercounts, which is the safe direction for a cap). Leaves the
// `r2l_links:<code>` reverse-index entry orphaned too — harmless, since
// nothing resolves through it once both the code and the link token are gone.
async function rollbackMint(kv, code, token) {
  try {
    await kv.delete(code);
  } catch {
    // best-effort
  }
  if (token) {
    try {
      await kv.delete(linkKey(token));
    } catch {
      // best-effort
    }
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.READ2LEAD_CODES;
  if (!kv) return json({ ok: false, error: 'kv_missing', message: 'Hệ thống đang bận. Bạn thử lại sau ít phút nhé.' }, 500);

  // --- Ships dark until Phương flips config:signup_enabled ---
  let enabled = false;
  try {
    enabled = (await kv.get('config:signup_enabled', { type: 'json' })) === true;
  } catch {
    enabled = false; // fail closed
  }
  if (!enabled) {
    return json({
      ok: false,
      error: 'signup_disabled',
      message: 'Đăng ký chưa mở. Nhắn Zalo Felix để được cấp mã nhé.',
    }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return turnstileRefusal('invalid_json');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return turnstileRefusal('invalid_json');

  // --- Turnstile. Already verified by the gateway (outside the account lane)? Trust only the
  // gateway-set marker, and only inside the account host. Otherwise verify here (Pages path/tests).
  const gatewayVerified = env.R2L_ACCOUNT_MODE === 'unified-v1' && request.headers.get(TURNSTILE_VERIFIED_HEADER) === '1';
  if (!gatewayVerified) {
    // Fail closed: flag on + no secret configured = refuse.
    const secret = env.TURNSTILE_SECRET_KEY;
    if (!secret) return turnstileRefusal('turnstile_not_configured');

    const turnstileToken = body.turnstile_token || body['cf-turnstile-response'];
    const tokenProblem = turnstileTokenProblem(turnstileToken);
    if (tokenProblem) return turnstileRefusal(tokenProblem);

    const ip = getClientIp(request);
    let turnstileOk = false;
    try {
      turnstileOk = await verifyTurnstile(secret, turnstileToken, ip, context.fetchImpl || fetch);
    } catch {
      turnstileOk = false; // network/API failure/timeout => fail closed, never treat as pass
    }
    if (!turnstileOk) return turnstileRefusal('turnstile_failed');
  }
  const ip = getClientIp(request);

  // --- Field validation (same fields/bounds admin already requires) — before
  // the rate-limit reservations, so an invalid/malformed request never burns
  // a legitimate parent's daily allowance. ---
  const student_name = (typeof body.student_name === 'string' ? body.student_name : '').normalize('NFC').trim();
  const student_age = parseInt(body.student_age, 10);
  const child_gender = ['boy', 'girl'].includes(body.child_gender) ? body.child_gender : '';
  const parent_zalo = (body.parent_zalo || '').trim().slice(0, 30);

  if (!student_name) {
    return json({ ok: false, error: 'student_name_required', message: 'Bạn nhớ nhập tên của con nhé.' }, 400);
  }
  const nameProblem = checkStudentName(student_name);
  if (nameProblem) {
    return json({ ok: false, error: nameProblem.error, message: nameProblem.message }, 400);
  }
  if (!Number.isFinite(student_age) || student_age < 5 || student_age > 14) {
    return json({ ok: false, error: 'student_age_invalid', message: 'Tuổi của con cần từ 5 đến 14 nhé.' }, 400);
  }
  if (!child_gender) {
    return json({ ok: false, error: 'child_gender_required', message: 'Bạn chọn bạn nam hoặc bạn nữ giúp mình nhé.' }, 400);
  }

  // --- Abuse fences: RESERVE immediately (write before minting), not just
  // check. See _rate-limit.js and SPEC_R2L_OPEN_ACCESS.md "Accepted risk 2" —
  // this shrinks, does not close, the race window. ---
  const ipReserve = await reserveSignupIp(kv, ip);
  if (ipReserve.blocked) {
    return json({
      ok: false,
      error: 'rate_limited',
      message: 'Bạn đã đăng ký quá số lần cho phép hôm nay. Vui lòng thử lại vào ngày mai.',
    }, 429);
  }

  let dailyCap = DEFAULT_DAILY_CAP;
  try {
    const configuredCap = await kv.get('config:signup_daily_cap', { type: 'json' });
    if (Number.isFinite(configuredCap) && configuredCap > 0) dailyCap = configuredCap;
  } catch {
    // best-effort read of the cap override — default stays in effect
  }

  const gKey = globalCounterKey();
  const globalReserve = await reserveGlobalCount(kv, gKey, dailyCap);
  if (globalReserve.blocked) {
    // The IP reservation above already landed — accepted: a request refused
    // by the (separate) global fence still consumes one of that IP's daily
    // slots. This is a minor over-conservative side effect of reserving
    // early, in the safe direction (stricter, never more permissive).
    return json({
      ok: false,
      error: 'global_cap',
      message: 'Hôm nay đã đủ số lượng đăng ký mới. Vui lòng quay lại vào ngày mai.',
    }, 429);
  }

  // --- Mint the code (factory-built, byte-compatible with admin-created records) ---
  const code = await generateUniqueCodeForName(kv, student_name);
  const record = buildCodeRecord({
    parent_zalo,
    student_name,
    student_age,
    child_gender,
    uses_total: SIGNUP_USES_TOTAL,
    expiry_days: SIGNUP_EXPIRY_DAYS,
    is_test: false,
    is_shared: false,
    origin: 'self_serve',
  });
  await kv.put(code, JSON.stringify(record));

  // --- Mint the magic link by reusing the existing admin mint handler wholesale
  // (same token generation, KV record shape, and reverse index the resolver
  // in r2l-link.js already knows how to read). Its expiry_days is passed to
  // match the code's own 90-day expiry, since the handler already accepts
  // that field in its POST body. ---
  const linkRequest = new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiry_days: SIGNUP_EXPIRY_DAYS }),
  });
  const linkResponse = await mintLinkForCode({ request: linkRequest, env, params: { code } });
  const linkBody = await linkResponse.json();
  if (!linkBody.ok) {
    // Should be unreachable (the code we just wrote must exist), but never
    // hand back a code with no working link.
    await rollbackMint(kv, code, null);
    return json({ ok: false, error: 'link_mint_failed', message: 'Hệ thống đang bận. Bạn thử lại sau ít phút nhé.' }, 500);
  }

  // --- Post-mint recheck (Accepted risk 2, bound (b)): re-read BOTH counters
  // now that the slower mint work has completed. If either landed over its
  // limit — because concurrent siblings also reserved during this request's
  // in-flight window — undo this mint and refuse. This still cannot claim
  // atomicity: in rare timing, concurrent requests can each observe a
  // recheck value at or under the limit and all pass. It bounds the overshoot
  // to roughly this request's own mint duration, it does not eliminate it. ---
  const ipCountAfter = await readSignupIpCount(kv, ip);
  const globalCountAfter = await readGlobalCount(kv, gKey);

  const ipOverCap = ipCountAfter === null || ipCountAfter > SIGNUP_IP_LIMIT;
  const globalOverCap = globalCountAfter === null || globalCountAfter > dailyCap;

  if (ipOverCap || globalOverCap) {
    await rollbackMint(kv, code, linkBody.token);
    return json({
      ok: false,
      error: ipOverCap ? 'rate_limited' : 'global_cap',
      message: 'Hệ thống đang bận, vui lòng thử lại sau ít phút.',
    }, 429);
  }

  return json({ ok: true, code, link: linkBody.link, record });
}
