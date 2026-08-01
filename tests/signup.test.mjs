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
