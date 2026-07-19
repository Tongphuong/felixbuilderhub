import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as shopBuy } from '../functions/api/read2lead-shop-buy.js';
import { onRequestPost as ceremonyAck } from '../functions/api/read2lead-ceremony-ack.js';
import { onRequestPost as shopList } from '../functions/api/read2lead-shop-list.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

const ACCESS_CODE = 'R2L-SHOP-W4';
const RARE_PART = 'png-default-detail-blue-horn-small';
const EPIC_PART = 'png-default-detail-blue-horn-large';

function makeEnv({ codeExists = true, progress = null } = {}) {
  const store = new Map();
  if (progress) {
    store.set(progressKey(ACCESS_CODE), JSON.stringify({
      // Below Silver by default so pre-existing tests exercise the PRICED
      // path; Silver+ free-shop behavior gets its own explicit tests below.
      current_level: 'L1',
      ...progress,
      rank_points: progress.rank_points ?? 9,
    }));
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

test('POST /shop-list returns items + diamonds', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, diamonds: 120, unlocked_parts: [] },
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
  assert.equal(payload.diamonds, 120);
  assert.ok(Array.isArray(payload.items));
  assert.ok(payload.items.length > 0);
  const epicItem = payload.items.find((item) => item.id === EPIC_PART);
  assert.equal(epicItem?.price, 100);
  assert.equal(epicItem?.can_afford, true, 'below-Silver kid with 120 diamonds can afford epic (price 100)');
});

test('POST /shop-buy success returns ok + reward + new diamond balance', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, diamonds: 200, unlocked_parts: [] },
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
  assert.equal(payload.diamonds, 160);
  assert.deepEqual(payload.reward, { part_id: RARE_PART, price: 40 });
  assert.deepEqual(payload.unlocked_parts, [RARE_PART]);
  assert.equal(payload.avatar_stage, 'custom');
  assert.equal(payload.avatar.monster.detail, RARE_PART);
  assert.equal(payload.pending_ceremony.part_id, RARE_PART);
  assert.equal(payload.pending_ceremony.rarity, 'rare');
  assert.ok(payload.pending_ceremony.ts);
});

test('POST /shop-buy 400 already_owned', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, diamonds: 200, unlocked_parts: [] },
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

test('POST /shop-buy 400 insufficient_diamonds', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, diamonds: 5, unlocked_parts: [] },
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
  assert.equal(payload.error, 'insufficient_diamonds');
  assert.equal(payload.message, 'Chua du 💎. Con hoc them de tich luy nhe!');
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

// R2L-REWARDS-REDESIGN (2026-07-18): the tier_index < 1 rank gate is REMOVED.
// Below Silver the shop is now reachable at normal diamond prices (replaces
// the old "blocks Bronze" 403 test).
test('POST /shop-buy below Silver (L0) succeeds at the full diamond price — no rank gate', async () => {
  const initial = {
    schema_version: 2,
    level_reset_version: 20260606,
    current_level: 'L0',
    diamonds: 200,
    rank_points: 0,
    unlocked_parts: [],
  };
  const env = makeEnv({ progress: initial });
  const response = await shopBuy({
    request: new Request('https://example.com/api/read2lead-shop-buy', {
      method: 'POST',
      body: JSON.stringify({ code: ACCESS_CODE, part_id: RARE_PART }),
    }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.reward, { part_id: RARE_PART, price: 40 });
  assert.equal(payload.diamonds, 160);
});

test('POST /shop-buy at Silver (L2) is free — price 0, no diamonds deducted', async () => {
  const initial = {
    schema_version: 2,
    level_reset_version: 20260606,
    current_level: 'L2',
    diamonds: 0,
    unlocked_parts: [],
  };
  const env = makeEnv({ progress: initial });
  const response = await shopBuy({
    request: new Request('https://example.com/api/read2lead-shop-buy', {
      method: 'POST',
      body: JSON.stringify({ code: ACCESS_CODE, part_id: EPIC_PART }),
    }),
    env,
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.reward, { part_id: EPIC_PART, price: 0 });
  assert.equal(payload.diamonds, 0, 'a Silver+ kid with 0 diamonds still gets the item free');
  assert.deepEqual(payload.unlocked_parts, [EPIC_PART]);
});

test('POST /shop-buy persists to KV (mock)', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, diamonds: 200, unlocked_parts: [] },
  });
  await shopBuy({
    request: new Request('https://example.com/api/read2lead-shop-buy', {
      method: 'POST',
      body: JSON.stringify({ code: ACCESS_CODE, part_id: RARE_PART }),
    }),
    env,
  });
  const saved = JSON.parse(env.__store.get(progressKey(ACCESS_CODE)));
  assert.equal(saved.diamonds, 160);
  assert.deepEqual(saved.unlocked_parts, [RARE_PART]);
  assert.equal(saved.avatar_stage, 'custom');
  assert.equal(saved.avatar.monster.detail, RARE_PART);
  assert.equal(saved.pending_ceremony.part_id, RARE_PART);
});

test('POST /ceremony-ack clears the matching pending ceremony', async () => {
  const env = makeEnv({
    progress: { schema_version: 2, level_reset_version: 20260606, diamonds: 200, unlocked_parts: [] },
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
