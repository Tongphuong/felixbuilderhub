import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as shopBuy } from '../functions/api/read2lead-shop-buy.js';
import { onRequestPost as ceremonyAck } from '../functions/api/read2lead-ceremony-ack.js';
import { onRequestPost as shopList } from '../functions/api/read2lead-shop-list.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

const ACCESS_CODE = 'R2L-SHOP-W4';
const RARE_PART = 'png-default-detail-blue-horn-small';

function makeEnv({ codeExists = true, progress = null } = {}) {
  const store = new Map();
  if (progress) {
    store.set(progressKey(ACCESS_CODE), JSON.stringify(progress));
  }

  return {
    READ2LEAD_CODES: {
      async get(key, opts) {
        if (!codeExists) return null;
        if (key === ACCESS_CODE) {
          return opts?.type === 'json'
            ? { student_profile: { student_name: 'Linh' } }
            : JSON.stringify({ student_profile: { student_name: 'Linh' } });
        }
        return null;
      },
      async put(key, value) {
        store.set(key, value);
      },
    },
    READ2LEAD_PROGRESS: {
      async get(key, opts) {
        const raw = store.get(key);
        if (!raw) return null;
        return opts?.type === 'json' ? JSON.parse(raw) : raw;
      },
      async put(key, value) {
        store.set(key, value);
      },
    },
    __store: store,
  };
}

test('POST /shop-list returns items + coins', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, coins: 120, unlocked_parts: [] },
  });
  const response = await shopList({
    request: new Request('https://example.com/api/read2lead-shop-list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ACCESS_CODE }),
    }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.coins, 120);
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length > 0);
});

test('POST /shop-buy success returns ok + reward + new coin balance', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, coins: 200, unlocked_parts: [] },
  });
  const response = await shopBuy({
    request: new Request('https://example.com/api/read2lead-shop-buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ACCESS_CODE, part_id: RARE_PART }),
    }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.coins, 120);
  assert.deepEqual(payload.reward, { part_id: RARE_PART, price: 80 });
  assert.deepEqual(payload.unlocked_parts, [RARE_PART]);
  assert.equal(payload.avatar_stage, 'custom');
  assert.equal(payload.avatar.monster.detail, RARE_PART);
  assert.equal(payload.pending_ceremony.part_id, RARE_PART);
  assert.equal(payload.pending_ceremony.rarity, 'rare');
  assert.ok(payload.pending_ceremony.ts);
});

test('POST /shop-buy 400 already_owned', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, coins: 200, unlocked_parts: [] },
  });
  const request = () => new Request('https://example.com/api/read2lead-shop-buy', {
    method: 'POST',
    body: JSON.stringify({ code: ACCESS_CODE, part_id: RARE_PART }),
  });
  const first = await shopBuy({ request: request(), env });
  assert.equal(first.status, 200);
  const response = await shopBuy({ request: request(), env });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'already_owned');
});

test('POST /shop-buy 400 insufficient_coins', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, coins: 5, unlocked_parts: [] },
  });
  const response = await shopBuy({
    request: new Request('https://example.com/api/read2lead-shop-buy', {
      method: 'POST',
      body: JSON.stringify({ code: ACCESS_CODE, part_id: RARE_PART }),
    }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'insufficient_coins');
});

test('POST /shop-buy 400 missing code', async () => {
  const env = makeEnv();
  const response = await shopBuy({
    request: new Request('https://example.com/api/read2lead-shop-buy', {
      method: 'POST',
      body: JSON.stringify({ part_id: RARE_PART }),
    }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 400);
  assert.equal(payload.error, 'missing_code');
});

test('POST /shop-buy 404 code not found', async () => {
  const env = makeEnv({ codeExists: false });
  const response = await shopBuy({
    request: new Request('https://example.com/api/read2lead-shop-buy', {
      method: 'POST',
      body: JSON.stringify({ code: ACCESS_CODE, part_id: RARE_PART }),
    }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 404);
  assert.equal(payload.error, 'code_not_found');
});

test('POST /shop-buy persists to KV (mock)', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, coins: 200, unlocked_parts: [] },
  });
  await shopBuy({
    request: new Request('https://example.com/api/read2lead-shop-buy', {
      method: 'POST',
      body: JSON.stringify({ code: ACCESS_CODE, part_id: RARE_PART }),
    }),
    env,
  });
  const saved = JSON.parse(env.__store.get(progressKey(ACCESS_CODE)));
  assert.equal(saved.coins, 120);
  assert.deepEqual(saved.unlocked_parts, [RARE_PART]);
  assert.equal(saved.avatar_stage, 'custom');
  assert.equal(saved.avatar.monster.detail, RARE_PART);
  assert.equal(saved.pending_ceremony.part_id, RARE_PART);
});

test('POST /ceremony-ack clears the matching pending ceremony', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, coins: 200, unlocked_parts: [] },
  });
  await shopBuy({
    request: new Request('https://example.com/api/read2lead-shop-buy', {
      method: 'POST',
      body: JSON.stringify({ code: ACCESS_CODE, part_id: RARE_PART }),
    }),
    env,
  });
  const pending = JSON.parse(env.__store.get(progressKey(ACCESS_CODE))).pending_ceremony;
  const response = await ceremonyAck({
    request: new Request('https://example.com/api/read2lead-ceremony-ack', {
      method: 'POST',
      body: JSON.stringify({
        code: ACCESS_CODE,
        part_id: pending.part_id,
        ts: pending.ts,
      }),
    }),
    env,
  });
  const payload = await response.json();
  const saved = JSON.parse(env.__store.get(progressKey(ACCESS_CODE)));
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true, cleared: true });
  assert.equal(saved.pending_ceremony, null);
});

test('POST /ceremony-ack does not clear a newer ceremony', async () => {
  const pending = {
    part_id: RARE_PART,
    rarity: 'rare',
    ts: '2026-06-14T10:00:00.000Z',
  };
  const env = makeEnv({
    progress: {
      schema_version: 2,
      level_reset_version: 20260606,
      avatar_stage: 'custom',
      unlocked_parts: [RARE_PART],
      pending_ceremony: pending,
    },
  });
  const response = await ceremonyAck({
    request: new Request('https://example.com/api/read2lead-ceremony-ack', {
      method: 'POST',
      body: JSON.stringify({
        code: ACCESS_CODE,
        part_id: RARE_PART,
        ts: 'older-event',
      }),
    }),
    env,
  });
  const payload = await response.json();
  assert.deepEqual(payload, { ok: true, cleared: false });
  assert.deepEqual(
    JSON.parse(env.__store.get(progressKey(ACCESS_CODE))).pending_ceremony,
    pending,
  );
});
