// Magic-link resolution had ZERO test coverage, which is how the use-counter bug reached a
// parent: /r2l/start is the child's home page, and the endpoint spent one "use" per page view
// until the link died (link_exhausted) and locked the child out. These tests pin the fix.

import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet as resolveLink, ttlSecondsFor } from '../functions/api/r2l-link.js';
import { validateLinkRecord, linkKey, todayISO, addDaysISO } from '../functions/api/admin/codes/[code]/links.js';

const TOKEN = '0a53b677eec8483834262b600b6301b6'; // the token from the parent's dead link
const CODE = 'R2L-PHUPERCY-X567';

function createKv(records = {}) {
  const store = new Map();
  for (const [key, value] of Object.entries(records)) store.set(key, JSON.stringify(value));
  const writes = [];
  return {
    store,
    writes,
    async get(key, opts = {}) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return opts.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value, opts = {}) {
      writes.push({ key, value, opts });
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function linkRecord(overrides = {}) {
  return {
    access_code: CODE,
    created_at: '2026-05-01',
    expires_at: addDaysISO(200),
    max_uses: 50,
    uses_remaining: 50,
    last_used_at: null,
    ...overrides,
  };
}

function codeRecord() {
  return {
    student_profile: { student_name: 'Phu Percy', level: 'L0' },
    progress: { current_level: 'L0' },
  };
}

function request(token = TOKEN) {
  return new Request(`https://felixbuilderhub.com/api/r2l-link?token=${token}`, {
    headers: { 'CF-Connecting-IP': '1.2.3.4' },
  });
}

async function resolve(kv, token = TOKEN) {
  const res = await resolveLink({ request: request(token), env: { READ2LEAD_CODES: kv } });
  return { res, body: await res.json() };
}

// ---------------------------------------------------------------------------------------
// The bug the parent hit.
// ---------------------------------------------------------------------------------------

test('a link already at zero uses RESOLVES — the dead links revive with no migration', async () => {
  const kv = createKv({
    [linkKey(TOKEN)]: linkRecord({ uses_remaining: 0, max_uses: 50 }),
    [CODE]: codeRecord(),
  });

  const { res, body } = await resolve(kv);

  assert.equal(res.status, 200, 'an exhausted link used to 410 — it must now open');
  assert.equal(body.ok, true);
  assert.equal(body.access_code, CODE);
  assert.equal(body.student_name, 'Phu Percy');
});

test('opening the home page does not spend a use', async () => {
  const kv = createKv({
    [linkKey(TOKEN)]: linkRecord({ uses_remaining: 50 }),
    [CODE]: codeRecord(),
  });

  for (let i = 0; i < 5; i += 1) await resolve(kv);

  const after = JSON.parse(kv.store.get(linkKey(TOKEN)));
  assert.equal(after.uses_remaining, 50, 'the counter must never be decremented again');
});

test('validateLinkRecord no longer reports link_exhausted', () => {
  assert.equal(validateLinkRecord(linkRecord({ uses_remaining: 0 })), null);
  assert.equal(validateLinkRecord(linkRecord({ uses_remaining: -12 })), null);
});

// ---------------------------------------------------------------------------------------
// The controls that DO still gate a link.
// ---------------------------------------------------------------------------------------

test('an expired link is still refused', async () => {
  const kv = createKv({
    [linkKey(TOKEN)]: linkRecord({ expires_at: '2020-01-01' }),
    [CODE]: codeRecord(),
  });

  const { res, body } = await resolve(kv);

  assert.equal(res.status, 410);
  assert.equal(body.error, 'link_expired');
});

test('a revoked (deleted) link is still refused', async () => {
  const kv = createKv({ [CODE]: codeRecord() });

  const { res, body } = await resolve(kv);

  assert.equal(res.status, 404);
  assert.equal(body.error, 'link_not_found');
});

test('a malformed token is still refused', async () => {
  const kv = createKv({ [CODE]: codeRecord() });

  const { res, body } = await resolve(kv, 'not-a-real-token');

  assert.equal(res.status, 400);
  assert.equal(body.error, 'invalid_token');
});

test('a record with no access_code is refused', () => {
  assert.equal(validateLinkRecord({ expires_at: addDaysISO(10) }), 'missing_access_code');
});

// ---------------------------------------------------------------------------------------
// Sliding expiry + write budget.
// ---------------------------------------------------------------------------------------

test('a link nearing expiry slides forward, so an active child never ages out', async () => {
  const soon = addDaysISO(5);
  const kv = createKv({
    [linkKey(TOKEN)]: linkRecord({ expires_at: soon }),
    [CODE]: codeRecord(),
  });

  const { res } = await resolve(kv);
  assert.equal(res.status, 200);

  const after = JSON.parse(kv.store.get(linkKey(TOKEN)));
  assert.ok(after.expires_at > soon, 'expiry should have been pushed out');
  assert.equal(after.expires_at, addDaysISO(365));
  assert.ok(kv.writes[0].opts.expirationTtl > 0, 'a put must always re-assert a TTL');
});

test('a link far from expiry is left alone', async () => {
  const far = addDaysISO(200);
  const kv = createKv({
    [linkKey(TOKEN)]: linkRecord({ expires_at: far }),
    [CODE]: codeRecord(),
  });

  await resolve(kv);

  const after = JSON.parse(kv.store.get(linkKey(TOKEN)));
  assert.equal(after.expires_at, far, 'no renewal needed, so the expiry must not move');
});

test('refreshing the home page costs at most one KV write per day', async () => {
  const kv = createKv({
    [linkKey(TOKEN)]: linkRecord({ expires_at: addDaysISO(200), last_used_at: null }),
    [CODE]: codeRecord(),
  });

  await resolve(kv); // first visit today — records last_used_at
  assert.equal(kv.writes.length, 1);

  for (let i = 0; i < 10; i += 1) await resolve(kv); // ten refreshes

  assert.equal(kv.writes.length, 1, 'the old code wrote on every single request');
  assert.equal(JSON.parse(kv.store.get(linkKey(TOKEN))).last_used_at, todayISO());
});

test('a put never strips the TTL and never goes below the KV minimum', () => {
  assert.ok(ttlSecondsFor(addDaysISO(365)) > 300 * 24 * 60 * 60);
  assert.ok(ttlSecondsFor('2020-01-01') >= 60, 'a past date must clamp, not go negative');
  assert.ok(ttlSecondsFor(undefined) > 0, 'a missing expiry must still carry a TTL');
});
