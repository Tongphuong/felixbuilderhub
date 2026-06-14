import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost as claimQuest } from '../functions/api/read2lead-quest-claim.js';
import { onRequestPost as openChest } from '../functions/api/read2lead-chest-open.js';
import { onRequestPost as claimDailyChest } from '../functions/api/read2lead-daily-chest-claim.js';
import {
  normalizeProgressState,
  vietnamDateKey,
} from '../functions/api/_read2lead-v2-state.js';

const CODE = 'R2L-W2-ENDPOINT';
const DATE_KEY = vietnamDateKey();

function createKv(records = {}) {
  const store = new Map(
    Object.entries(records).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  return {
    store,
    async get(key) {
      const value = store.get(key);
      return value === undefined ? null : JSON.parse(value);
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function request(body) {
  return new Request('https://example.com/api/read2lead-w2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function invalidJsonRequest() {
  return new Request('https://example.com/api/read2lead-w2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
}

function stateWithQuests(ids, progress = {}, claimed = {}) {
  const state = normalizeProgressState(null, { accessCode: CODE });
  return {
    ...state,
    daily_quests: {
      date: DATE_KEY,
      ids,
      progress: Object.fromEntries(ids.map((id) => [id, progress[id] || 0])),
      claimed: Object.fromEntries(ids.map((id) => [id, Boolean(claimed[id])])),
    },
  };
}

async function payload(response) {
  return response.json();
}

test('POST /read2lead-quest-claim claims complete quest and adds coins', async () => {
  const state = stateWithQuests(['q1', 'q3', 'q5'], { q1: 1 });
  const kv = createKv({ [`progress:${CODE}`]: state });
  const response = await claimQuest({
    request: request({ code: CODE.toLowerCase(), quest_id: 'q1' }),
    env: { READ2LEAD_PROGRESS: kv },
  });
  const body = await payload(response);
  const saved = JSON.parse(kv.store.get(`progress:${CODE}`));

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reward.coins, 10);
  assert.equal(body.coins, state.coins + 10);
  assert.equal(saved.daily_quests.claimed.q1, true);
});

test('POST /read2lead-quest-claim invalid quest_id returns 400', async () => {
  const kv = createKv({ [`progress:${CODE}`]: stateWithQuests(['q1', 'q3', 'q5']) });
  const response = await claimQuest({
    request: request({ code: CODE, quest_id: 'q99' }),
    env: { READ2LEAD_PROGRESS: kv },
  });
  const body = await payload(response);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'quest_not_active_today');
});

test('POST /read2lead-quest-claim incomplete quest returns not_complete', async () => {
  const kv = createKv({ [`progress:${CODE}`]: stateWithQuests(['q1', 'q3', 'q5']) });
  const response = await claimQuest({
    request: request({ code: CODE, quest_id: 'q1' }),
    env: { READ2LEAD_PROGRESS: kv },
  });
  const body = await payload(response);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'not_complete');
});

test('POST /read2lead-quest-claim already claimed quest returns already_claimed', async () => {
  const state = stateWithQuests(['q1', 'q3', 'q5'], { q1: 1 }, { q1: true });
  const kv = createKv({ [`progress:${CODE}`]: state });
  const response = await claimQuest({
    request: request({ code: CODE, quest_id: 'q1' }),
    env: { READ2LEAD_PROGRESS: kv },
  });
  const body = await payload(response);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'already_claimed');
});

test('POST /read2lead-chest-open opens pending chest and adds coins plus part', async () => {
  const state = {
    ...stateWithQuests(['q1', 'q3', 'q5']),
    coins: 4,
    pending_chest: {
      rarity: 'rare',
      reward: { coins: 30, part_id: 'part-rare' },
      duplicate: false,
      awarded_at: new Date().toISOString(),
    },
  };
  const kv = createKv({ [`progress:${CODE}`]: state });
  const response = await openChest({
    request: request({ code: CODE }),
    env: { READ2LEAD_PROGRESS: kv },
  });
  const body = await payload(response);
  const saved = JSON.parse(kv.store.get(`progress:${CODE}`));

  assert.equal(response.status, 200);
  assert.equal(body.coins, 34);
  assert.deepEqual(body.unlocked_parts, ['part-rare']);
  assert.equal(saved.pending_chest, null);
  assert.equal(saved.daily_quests.progress.q5, 1);
});

test('POST /read2lead-chest-open with no pending chest returns 400', async () => {
  const kv = createKv({ [`progress:${CODE}`]: stateWithQuests(['q1', 'q3', 'q5']) });
  const response = await openChest({
    request: request({ code: CODE }),
    env: { READ2LEAD_PROGRESS: kv },
  });
  const body = await payload(response);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'no_pending_chest');
});

test('POST /read2lead-daily-chest-claim adds streak-scaled coins', async () => {
  const state = {
    ...stateWithQuests(['q1', 'q3', 'q5']),
    coins: 2,
    streak_days: 4,
  };
  const kv = createKv({ [`progress:${CODE}`]: state });
  const response = await claimDailyChest({
    request: request({ code: CODE }),
    env: { READ2LEAD_PROGRESS: kv },
  });
  const body = await payload(response);
  const saved = JSON.parse(kv.store.get(`progress:${CODE}`));

  assert.equal(response.status, 200);
  assert.equal(body.reward.coins, 13);
  assert.equal(body.coins, 15);
  assert.equal(body.preview.available, false);
  assert.equal(saved.daily_login_chest.last_claim_date, DATE_KEY);
});

test('POST /read2lead-daily-chest-claim same day returns already_claimed_today', async () => {
  const state = {
    ...stateWithQuests(['q1', 'q3', 'q5']),
    daily_login_chest: { last_claim_date: DATE_KEY },
  };
  const kv = createKv({ [`progress:${CODE}`]: state });
  const response = await claimDailyChest({
    request: request({ code: CODE }),
    env: { READ2LEAD_PROGRESS: kv },
  });
  const body = await payload(response);

  assert.equal(response.status, 400);
  assert.equal(body.error, 'already_claimed_today');
});

test('quest claim endpoint rejects missing code with 400', async () => {
  const response = await claimQuest({
    request: request({ quest_id: 'q1' }),
    env: { READ2LEAD_PROGRESS: createKv() },
  });
  assert.equal(response.status, 400);
  assert.equal((await payload(response)).error, 'missing_params');
});

test('chest endpoints reject missing code with 400', async () => {
  const env = { READ2LEAD_PROGRESS: createKv() };
  const [openResponse, dailyResponse] = await Promise.all([
    openChest({ request: request({}), env }),
    claimDailyChest({ request: request({}), env }),
  ]);

  assert.equal(openResponse.status, 400);
  assert.equal((await payload(openResponse)).error, 'missing_code');
  assert.equal(dailyResponse.status, 400);
  assert.equal((await payload(dailyResponse)).error, 'missing_code');
});

test('all endpoints return 404 when progress KV key is missing', async () => {
  const env = { READ2LEAD_PROGRESS: createKv() };
  const responses = await Promise.all([
    claimQuest({ request: request({ code: CODE, quest_id: 'q1' }), env }),
    openChest({ request: request({ code: CODE }), env }),
    claimDailyChest({ request: request({ code: CODE }), env }),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 404);
    assert.equal((await payload(response)).error, 'code_not_found');
  }
});

test('all endpoints reject invalid JSON with 400', async () => {
  const env = { READ2LEAD_PROGRESS: createKv() };
  const responses = await Promise.all([
    claimQuest({ request: invalidJsonRequest(), env }),
    openChest({ request: invalidJsonRequest(), env }),
    claimDailyChest({ request: invalidJsonRequest(), env }),
  ]);

  for (const response of responses) {
    assert.equal(response.status, 400);
    assert.equal((await payload(response)).error, 'invalid_json');
  }
});
