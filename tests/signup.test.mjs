// R2L-OPEN-ACCESS bite tests (rule 28) — every fence must FAIL CLOSED.
// The endpoint ships dark: config:signup_enabled off (or unreadable) is a 503,
// a missing Turnstile secret is a 503, a bad/missing token is refused, the
// per-IP and global daily caps refuse once hit, and age outside 5-14 refuses.
// A known-GOOD path must also succeed end-to-end: unique code minted, magic
// link minted via the real admin mint handler, and the r2l-link resolver
// (functions/api/r2l-link.js) accepts the minted link/code untouched.

import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as signup } from '../functions/api/signup.js';
import { onRequestGet as resolveLink } from '../functions/api/r2l-link.js';
import { isAccessCodeKey } from '../functions/api/_read2lead-v2-state.js';

function makeKv(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    store,
    async get(key, options) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return options?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

const GOOD_TOKEN = 'good-turnstile-token';

function passingFetch() {
  return async () => new Response(JSON.stringify({ success: true }), { status: 200 });
}

function failingFetch() {
  return async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 });
}

function requestBody(overrides = {}) {
  return {
    student_name: 'Minh',
    student_age: 9,
    child_gender: 'boy',
    turnstile_token: GOOD_TOKEN,
    ...overrides,
  };
}

function makeRequest(body, { ip = '1.2.3.4' } = {}) {
  return new Request('https://felixbuilderhub.com/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify(body),
  });
}

async function callSignup({ kv, body, env: envOverrides = {}, ip, fetchImpl } = {}) {
  const store = kv || makeKv({ 'config:signup_enabled': true });
  const env = { READ2LEAD_CODES: store, TURNSTILE_SECRET_KEY: 'test-secret', ...envOverrides };
  const request = makeRequest(body ?? requestBody(), { ip });
  const res = await signup({ request, env, fetchImpl });
  return { res, body: await res.json(), kv: store };
}

// ---------------------------------------------------------------------------
// Bite test: flag off → 503
// ---------------------------------------------------------------------------

test('BITE: config:signup_enabled absent → 503, never mints a code', async () => {
  const kv = makeKv(); // no flag key at all
  const { res, body } = await callSignup({ kv });
  assert.equal(res.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'signup_disabled');
});

test('BITE: config:signup_enabled explicitly false → 503', async () => {
  const kv = makeKv({ 'config:signup_enabled': false });
  const { res, body } = await callSignup({ kv });
  assert.equal(res.status, 503);
  assert.equal(body.error, 'signup_disabled');
});

// ---------------------------------------------------------------------------
// Bite test: flag on + no Turnstile secret → refused (fail closed)
// ---------------------------------------------------------------------------

test('BITE: flag on but TURNSTILE_SECRET_KEY missing → refused, never opens', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const env = { READ2LEAD_CODES: kv }; // no TURNSTILE_SECRET_KEY
  const res = await signup({ request: makeRequest(requestBody()), env });
  const body = await res.json();
  assert.equal(res.status, 503);
  assert.equal(body.error, 'turnstile_not_configured');
});

// ---------------------------------------------------------------------------
// Bite test: bad/missing Turnstile token → refused
// ---------------------------------------------------------------------------

test('BITE: missing turnstile_token → 400, refused before minting', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const { res, body } = await callSignup({ kv, body: requestBody({ turnstile_token: undefined }) });
  assert.equal(res.status, 400);
  assert.equal(body.error, 'turnstile_required');
});

test('accepts the cf-turnstile-response field (the literal Cloudflare widget form field name), not just turnstile_token (Buffet low-sev)', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const body = requestBody({ turnstile_token: undefined, 'cf-turnstile-response': GOOD_TOKEN });
  const { res, body: respBody } = await callSignup({ kv, body, fetchImpl: passingFetch() });
  assert.equal(res.status, 200);
  assert.equal(respBody.ok, true);
  assert.match(respBody.code, /^R2L-/);
});

test('BITE: siteverify returns success:false → 403, refused, no code minted', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const { res, body, kv: usedKv } = await callSignup({ kv, fetchImpl: failingFetch() });
  assert.equal(res.status, 403);
  assert.equal(body.error, 'turnstile_failed');
  const codeKeys = [...usedKv.store.keys()].filter(isAccessCodeKey);
  assert.equal(codeKeys.length, 0, 'a failed Turnstile check must never mint a code');
});

test('BITE: siteverify network failure fails CLOSED, not open', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const throwingFetch = async () => { throw new Error('network down'); };
  const { res, body } = await callSignup({ kv, fetchImpl: throwingFetch });
  assert.equal(res.status, 403);
  assert.equal(body.error, 'turnstile_failed');
});

// ---------------------------------------------------------------------------
// Bite test: 4th signup same IP same day → refused
// ---------------------------------------------------------------------------

test('BITE: a 4th signup from the same IP on the same day is refused; the first 3 succeed', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const env = { READ2LEAD_CODES: kv, TURNSTILE_SECRET_KEY: 'test-secret' };
  const ip = '9.9.9.9';

  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await signup({
      request: makeRequest(requestBody({ student_name: `Kid${i}` }), { ip }),
      env,
      fetchImpl: passingFetch(),
    });
    // eslint-disable-next-line no-await-in-loop
    const body = await res.json();
    assert.equal(res.status, 200, `signup #${i + 1} from the same IP must succeed`);
    assert.equal(body.ok, true);
  }

  const fourth = await signup({
    request: makeRequest(requestBody({ student_name: 'Kid3' }), { ip }),
    env,
    fetchImpl: passingFetch(),
  });
  const fourthBody = await fourth.json();
  assert.equal(fourth.status, 429);
  assert.equal(fourthBody.error, 'rate_limited');

  // A different IP is unaffected.
  const otherIp = await signup({
    request: makeRequest(requestBody({ student_name: 'KidOther' }), { ip: '8.8.8.8' }),
    env,
    fetchImpl: passingFetch(),
  });
  assert.equal(otherIp.status, 200, 'the per-IP cap must not leak across IPs');
});

// ---------------------------------------------------------------------------
// Bite test: global daily cap → refused
// ---------------------------------------------------------------------------

test('BITE: global counter already at the configured cap → refused', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const kv = makeKv({
    'config:signup_enabled': true,
    'config:signup_daily_cap': 2,
    [`signup-global:${today}`]: 2,
  });
  const { res, body } = await callSignup({ kv, fetchImpl: passingFetch() });
  assert.equal(res.status, 429);
  assert.equal(body.error, 'global_cap');
});

test('global cap defaults to 50 when config:signup_daily_cap is absent', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const kv = makeKv({
    'config:signup_enabled': true,
    [`signup-global:${today}`]: 50,
  });
  const { res, body } = await callSignup({ kv, fetchImpl: passingFetch() });
  assert.equal(res.status, 429);
  assert.equal(body.error, 'global_cap');
});

test('global counter below cap allows the signup through and increments by exactly 1', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const kv = makeKv({
    'config:signup_enabled': true,
    'config:signup_daily_cap': 50,
    [`signup-global:${today}`]: 10,
  });
  const { res } = await callSignup({ kv, fetchImpl: passingFetch() });
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(kv.store.get(`signup-global:${today}`)), 11);
});

// ---------------------------------------------------------------------------
// Bite test: age 4 or 15 → refused (same bound admin already enforces)
// ---------------------------------------------------------------------------

test('BITE: student_age 4 (below 5) → refused', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const { res, body } = await callSignup({ kv, body: requestBody({ student_age: 4 }), fetchImpl: passingFetch() });
  assert.equal(res.status, 400);
  assert.equal(body.error, 'student_age_invalid');
});

test('BITE: student_age 15 (above 14) → refused', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const { res, body } = await callSignup({ kv, body: requestBody({ student_age: 15 }), fetchImpl: passingFetch() });
  assert.equal(res.status, 400);
  assert.equal(body.error, 'student_age_invalid');
});

test('missing student_name → refused', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const { res, body } = await callSignup({ kv, body: requestBody({ student_name: '' }), fetchImpl: passingFetch() });
  assert.equal(res.status, 400);
  assert.equal(body.error, 'student_name_required');
});

test('missing/invalid child_gender → refused', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const { res, body } = await callSignup({ kv, body: requestBody({ child_gender: 'x' }), fetchImpl: passingFetch() });
  assert.equal(res.status, 400);
  assert.equal(body.error, 'child_gender_required');
});

// ---------------------------------------------------------------------------
// Acceptance criterion 1: a fully valid signup mints a unique, correctly
// shaped code and a working magic link.
// ---------------------------------------------------------------------------

test('valid signup (flag on, Turnstile pass) mints a self_serve code with the spec-mandated fields', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const { res, body } = await callSignup({ kv, fetchImpl: passingFetch() });

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.code, /^R2L-MINH-[A-Z0-9]{4}$/);
  assert.ok(body.link.includes('/r2l/start?t='));

  assert.equal(body.record.origin, 'self_serve');
  assert.equal(body.record.uses_total, 3);
  assert.equal(body.record.uses_remaining, 3);
  assert.equal(body.record.is_test, false);
  assert.equal(body.record.is_shared, false);
  assert.equal(body.record.student_profile.student_name, 'Minh');
  assert.equal(body.record.student_profile.age, 9);
  assert.equal(body.record.progress.packs_created, 0);

  const expiresAt = body.record.expires_at;
  const issuedAt = body.record.issued_at;
  const daysBetween = (Date.parse(expiresAt) - Date.parse(issuedAt)) / (24 * 60 * 60 * 1000);
  assert.ok(Math.abs(daysBetween - 90) <= 1, `expiry_days must be ~90, got ${daysBetween}`);
});

test('optional parent_zalo is stored when provided, blank when omitted', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const withZalo = await callSignup({ kv: makeKv({ 'config:signup_enabled': true }), body: requestBody({ parent_zalo: '0909123456' }), fetchImpl: passingFetch() });
  assert.equal(withZalo.body.record.parent_zalo, '0909123456');

  const withoutZalo = await callSignup({ kv, body: requestBody(), fetchImpl: passingFetch() });
  assert.equal(withoutZalo.body.record.parent_zalo, '');
});

// ---------------------------------------------------------------------------
// Acceptance criterion 4: the magic link resolves via the REAL r2l-link.js
// resolver without burning anything.
// ---------------------------------------------------------------------------

test('the resolver (functions/api/r2l-link.js) accepts a signup-minted magic link untouched', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const { body } = await callSignup({ kv, fetchImpl: passingFetch() });

  const token = new URL(body.link).searchParams.get('t');
  const resolveRequest = new Request(`https://felixbuilderhub.com/api/r2l-link?token=${token}`, {
    headers: { 'CF-Connecting-IP': '5.5.5.5' },
  });
  const resolveRes = await resolveLink({ request: resolveRequest, env: { READ2LEAD_CODES: kv } });
  const resolveBody = await resolveRes.json();

  assert.equal(resolveRes.status, 200);
  assert.equal(resolveBody.ok, true);
  assert.equal(resolveBody.access_code, body.code);
  assert.equal(resolveBody.student_name, 'Minh');
  assert.equal(resolveBody.level, 'L1');
});

test('resolving the signup magic link does not spend uses_remaining on the code', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const { body } = await callSignup({ kv, fetchImpl: passingFetch() });

  const token = new URL(body.link).searchParams.get('t');
  const resolveRequest = () => new Request(`https://felixbuilderhub.com/api/r2l-link?token=${token}`, {
    headers: { 'CF-Connecting-IP': '5.5.5.5' },
  });
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await resolveLink({ request: resolveRequest(), env: { READ2LEAD_CODES: kv } });
  }

  const stored = JSON.parse(kv.store.get(body.code));
  assert.equal(stored.uses_remaining, 3, 'opening the magic link must never spend a use');
});

test('the magic link expiry matches the code\'s 90-day expiry (links.js already accepts expiry_days in its POST body, judgment call 2 follow-up)', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const { body } = await callSignup({ kv, fetchImpl: passingFetch() });

  const token = new URL(body.link).searchParams.get('t');
  const linkRecord = JSON.parse(kv.store.get(`r2l_link:${token}`));
  const linkDays = (Date.parse(linkRecord.expires_at) - Date.parse(linkRecord.created_at)) / (24 * 60 * 60 * 1000);
  assert.ok(Math.abs(linkDays - 90) <= 1, `link expiry must match the code's 90-day expiry, got ${linkDays} days`);
});

test('kv_missing binding → 500, never proceeds', async () => {
  const res = await signup({ request: makeRequest(requestBody()), env: {} });
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.error, 'kv_missing');
});

test('invalid JSON body → 400', async () => {
  const kv = makeKv({ 'config:signup_enabled': true });
  const env = { READ2LEAD_CODES: kv, TURNSTILE_SECRET_KEY: 'test-secret' };
  const request = new Request('https://felixbuilderhub.com/api/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '1.1.1.1' },
    body: '{not-json',
  });
  const res = await signup({ request, env });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'invalid_json');
});

// ---------------------------------------------------------------------------
// Buffet review round 2 (HIGH finding): reserveSignupIp/reserveGlobalCount in
// signup.js are a plain KV get→compare→put, with no compare-and-swap. A
// CONCURRENT burst can race past a cap (repro'd with a latencied-KV harness —
// see /tmp/.../scratchpad/race-check.mjs and race-check-global.mjs). The
// mitigation (reserve BEFORE minting, then RE-READ both counters after the
// code+link are written and roll the mint back if either landed over its
// limit) shrinks the race window to the in-flight duration of one mint — it
// does NOT close it. SPEC_R2L_OPEN_ACCESS.md "Accepted risk 2" records this
// explicitly. The tests below first pin the fully DETERMINISTIC half (once a
// counter is already, visibly over its cap, every request is refused, no
// race required to observe that), then measure the actual racy half across
// repeated concurrent trials with a latencied KV double — a sequential-await
// test can never exercise this, per Elon's instruction.
// ---------------------------------------------------------------------------

test('once the per-IP counter is already visibly OVER its limit, every request is refused deterministically (no code minted)', async () => {
  const ip = '4.4.4.4';
  const kv = makeKv({
    'config:signup_enabled': true,
    [`rl-signup:${ip}`]: { count: 5, first_at: Math.floor(Date.now() / 1000) }, // already past the limit of 3
  });
  const env = { READ2LEAD_CODES: kv, TURNSTILE_SECRET_KEY: 'test-secret' };
  const res = await signup({ request: makeRequest(requestBody(), { ip }), env, fetchImpl: passingFetch() });
  const body = await res.json();
  assert.equal(res.status, 429);
  assert.equal(body.error, 'rate_limited');
  assert.equal([...kv.store.keys()].filter(isAccessCodeKey).length, 0);
});

test('once the global counter is already visibly OVER its cap, every request is refused deterministically (no code minted)', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const kv = makeKv({
    'config:signup_enabled': true,
    'config:signup_daily_cap': 2,
    [`signup-global:${today}`]: 9, // already well past the cap of 2
  });
  const { res, body, kv: usedKv } = await callSignup({ kv, fetchImpl: passingFetch() });
  assert.equal(res.status, 429);
  assert.equal(body.error, 'global_cap');
  assert.equal([...usedKv.store.keys()].filter(isAccessCodeKey).length, 0);
});

// A KV double with real async latency on every op (adapted from Buffet's
// race-check.mjs/race-check-global.mjs harness) — required to force
// concurrent requests to overlap in-flight, unlike the synchronous-resolving
// mocks used everywhere else in this file.
function makeLatencyKv(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  const jitterMs = () => 2 + Math.floor(Math.random() * 8); // ~2-9ms, "~5ms" per the repro harness
  const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
  return {
    store,
    async get(key, options) {
      await delay(jitterMs());
      const raw = store.get(key);
      if (raw === undefined) return null;
      return options?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      await delay(jitterMs());
      store.set(key, value);
    },
    async delete(key) {
      await delay(jitterMs());
      store.delete(key);
    },
  };
}

test('CONCURRENCY (per-IP fence): N requests over the cap never leave an orphaned code, and the recheck measurably catches some (not all) of the race', async () => {
  const TRIALS = 12;
  const N = 3; // Buffet's exact race-check.mjs shape: limit 3, 2 already used, 3 concurrent
  const successCounts = [];

  for (let trial = 0; trial < TRIALS; trial += 1) {
    const ip = `7.7.7.${trial}`; // isolate each trial's counter
    const kv = makeLatencyKv({
      'config:signup_enabled': true,
      [`rl-signup:${ip}`]: { count: 2, first_at: Math.floor(Date.now() / 1000) }, // 1 slot remaining
    });
    const env = { READ2LEAD_CODES: kv, TURNSTILE_SECRET_KEY: 'test-secret' };
    const bodies = Array.from({ length: N }, (_, i) => requestBody({ student_name: `Race${trial}x${i}` }));

    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(bodies.map((b) => signup({
      request: makeRequest(b, { ip }),
      env,
      fetchImpl: passingFetch(),
    })));
    // eslint-disable-next-line no-await-in-loop
    const statuses = await Promise.all(results.map((r) => r.json().then((b) => ({ status: r.status, body: b }))));

    const successes = statuses.filter((s) => s.status === 200).length;
    successCounts.push(successes);

    // HARD invariant, every trial regardless of how the race resolved: a 200
    // response's code must exist; a rolled-back mint must leave nothing behind.
    const survivingCodes = [...kv.store.keys()].filter(isAccessCodeKey);
    assert.equal(
      survivingCodes.length, successes,
      `trial ${trial}: surviving codes (${survivingCodes.length}) must equal 200-responses (${successes}) — no orphans either direction`,
    );
  }

  const max = Math.max(...successCounts);
  const mean = successCounts.reduce((a, b) => a + b, 0) / TRIALS;
  console.log(`[measured] IP-fence concurrency (N=${N}, 1 slot remaining) successes per trial: ${JSON.stringify(successCounts)} — max=${max} mean=${mean.toFixed(2)} (uncontrolled baseline would be ${N} every trial)`);

  assert.ok(max <= N, 'successes can never exceed the number of concurrent requests fired');
  // NOT an atomicity claim (KV races still exist — see the header comment
  // above and SPEC_R2L_OPEN_ACCESS.md Accepted risk 2). This asserts the
  // mitigation is demonstrably not a no-op: across TRIALS repeated bursts,
  // the post-mint recheck must catch the race at least once. Statistically
  // safe at this trial count without the recheck ever being disabled.
  assert.ok(successCounts.some((s) => s < N), `expected the recheck to catch at least one over-cap mint across ${TRIALS} trials; got ${JSON.stringify(successCounts)}`);
});

test('CONCURRENCY (global fence): N requests from N different IPs over the cap never leave an orphaned code, and the recheck measurably catches some (not all) of the race', async () => {
  const TRIALS = 10;
  const N = 5; // Buffet's exact race-check-global.mjs shape: cap 2, 1 already used, 5 concurrent from 5 IPs
  const successCounts = [];

  for (let trial = 0; trial < TRIALS; trial += 1) {
    const today = new Date().toISOString().slice(0, 10);
    const kv = makeLatencyKv({
      'config:signup_enabled': true,
      'config:signup_daily_cap': 2,
      [`signup-global:${today}`]: 1, // 1 slot remaining
    });
    const env = { READ2LEAD_CODES: kv, TURNSTILE_SECRET_KEY: 'test-secret' };
    const bodies = Array.from({ length: N }, (_, i) => requestBody({ student_name: `Global${trial}x${i}` }));

    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(bodies.map((b, i) => signup({
      request: makeRequest(b, { ip: `9.${trial}.0.${i}` }), // different IP per request — isolates the global fence
      env,
      fetchImpl: passingFetch(),
    })));
    // eslint-disable-next-line no-await-in-loop
    const statuses = await Promise.all(results.map((r) => r.json().then((b) => ({ status: r.status, body: b }))));

    const successes = statuses.filter((s) => s.status === 200).length;
    successCounts.push(successes);

    const survivingCodes = [...kv.store.keys()].filter(isAccessCodeKey);
    assert.equal(
      survivingCodes.length, successes,
      `trial ${trial}: surviving codes (${survivingCodes.length}) must equal 200-responses (${successes}) — no orphans either direction`,
    );
  }

  const max = Math.max(...successCounts);
  const mean = successCounts.reduce((a, b) => a + b, 0) / TRIALS;
  console.log(`[measured] Global-fence concurrency (N=${N}, 1 slot remaining) successes per trial: ${JSON.stringify(successCounts)} — max=${max} mean=${mean.toFixed(2)} (uncontrolled baseline would be ${N} every trial)`);

  assert.ok(max <= N, 'successes can never exceed the number of concurrent requests fired');
  assert.ok(successCounts.some((s) => s < N), `expected the recheck to catch at least one over-cap mint across ${TRIALS} trials; got ${JSON.stringify(successCounts)}`);
});
