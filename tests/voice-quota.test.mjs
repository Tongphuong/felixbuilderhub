import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet as voiceQuota } from '../functions/api/voice-quota.js';
import { AZURE_PA_MONTHLY_FREE_SECONDS, azureUsageKey } from '../functions/api/_azure-pronunciation.js';

function makeFakeKv(records = {}) {
  const store = new Map();
  for (const [key, value] of Object.entries(records)) {
    store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return {
    store,
    async get(key, opts = {}) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return opts.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

const SECRET = 'test-secret';
// voice-quota.js calls `new Date()` internally (no injection seam, per the
// packet spec). Reuse the real azureUsageKey() so these tests key off
// whatever the actual current UTC year-month is, same as the endpoint does.
const USAGE_KEY = azureUsageKey(new Date());

function makeEnv(usedSeconds, { secret = SECRET, kv = true } = {}) {
  return {
    DEBUG_SPEAKING_KEY: secret,
    READ2LEAD_CODES: kv ? makeFakeKv({ [USAGE_KEY]: usedSeconds }) : undefined,
  };
}

function makeRequest(key) {
  const url = key === undefined
    ? 'https://x/api/voice-quota'
    : `https://x/api/voice-quota?key=${encodeURIComponent(key)}`;
  return new Request(url);
}

test('voice-quota: 95% usage (17100/18000) fires alert and pct >= 80', async () => {
  const res = await voiceQuota({ request: makeRequest(SECRET), env: makeEnv(17100) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.month, USAGE_KEY.slice('azure-pa-secs:'.length));
  assert.equal(body.used_seconds, 17100);
  assert.equal(body.cap_seconds, AZURE_PA_MONTHLY_FREE_SECONDS);
  assert.equal(body.pct, 95);
  assert.ok(body.pct >= 80, 'pct must be >= 80 at 95% usage');
  assert.equal(body.alert, true, '95% usage must fire the alert');
});

test('voice-quota: 20% usage (3600/18000) does not fire alert', async () => {
  const res = await voiceQuota({ request: makeRequest(SECRET), env: makeEnv(3600) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.used_seconds, 3600);
  assert.equal(body.pct, 20);
  assert.equal(body.alert, false, '20% usage must not fire the alert');
});

test('voice-quota: wrong key returns 404', async () => {
  const res = await voiceQuota({ request: makeRequest('wrong-key'), env: makeEnv(0) });
  assert.equal(res.status, 404);
});

test('voice-quota: missing key returns 404', async () => {
  const res = await voiceQuota({ request: makeRequest(undefined), env: makeEnv(0) });
  assert.equal(res.status, 404);
});

test('voice-quota: unset DEBUG_SPEAKING_KEY returns 404 even with a key param', async () => {
  const res = await voiceQuota({ request: makeRequest(SECRET), env: makeEnv(0, { secret: '' }) });
  assert.equal(res.status, 404);
});

test('voice-quota: missing READ2LEAD_CODES binding returns 500 config_error', async () => {
  const res = await voiceQuota({ request: makeRequest(SECRET), env: makeEnv(0, { kv: false }) });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, 'config_error');
});

test('voice-quota: no usage recorded yet defaults to 0', async () => {
  const env = { DEBUG_SPEAKING_KEY: SECRET, READ2LEAD_CODES: makeFakeKv({}) };
  const res = await voiceQuota({ request: makeRequest(SECRET), env });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.used_seconds, 0);
  assert.equal(body.pct, 0);
  assert.equal(body.alert, false);
});
