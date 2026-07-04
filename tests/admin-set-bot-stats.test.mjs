import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/admin/codes/[code]/set-bot-stats.js';

function makeKv(records) {
  return {
    async get(key, options) {
      const value = records.get(key);
      if (!value) return null;
      return options?.type === 'json' ? value : JSON.stringify(value);
    },
    async put(key, value) {
      records.set(key, typeof value === 'string' ? JSON.parse(value) : value);
    },
    async delete(key) {
      records.delete(key);
    },
  };
}

function postRequest(body) {
  return new Request('https://example.com/api/admin/codes/R2L-TEST-BOT1/set-bot-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('set-bot-stats rejects a code that is not test/bot', async () => {
  const records = new Map([
    ['R2L-TEST-BOT1', {
      parent_name: 'Chi Mai',
      student_profile: { student_name: 'Linh', age: 8, level: 'L1' },
      progress: { student_name: 'Linh', current_level: 'L1' },
    }],
  ]);
  const response = await onRequestPost({
    request: postRequest({ rank_label_vi: 'Bạc II', completed_packs: 5 }),
    params: { code: 'R2L-TEST-BOT1' },
    env: { READ2LEAD_CODES: makeKv(records) },
  });
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(body.error, 'bot_only');
});

test('set-bot-stats rejects missing rank_label_vi', async () => {
  const records = new Map([
    ['R2L-TEST-BOT1', { is_test: true, student_profile: {}, progress: {} }],
  ]);
  const response = await onRequestPost({
    request: postRequest({ completed_packs: 5 }),
    params: { code: 'R2L-TEST-BOT1' },
    env: { READ2LEAD_CODES: makeKv(records) },
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'rank_label_vi_required');
});

test('set-bot-stats rejects invalid completed_packs', async () => {
  const records = new Map([
    ['R2L-TEST-BOT1', { is_test: true, student_profile: {}, progress: {} }],
  ]);
  const response = await onRequestPost({
    request: postRequest({ rank_label_vi: 'Bạc II', completed_packs: -1 }),
    params: { code: 'R2L-TEST-BOT1' },
    env: { READ2LEAD_CODES: makeKv(records) },
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'completed_packs_invalid');
});

test('set-bot-stats returns not_found for an unknown code', async () => {
  const response = await onRequestPost({
    request: postRequest({ rank_label_vi: 'Bạc II', completed_packs: 5 }),
    params: { code: 'R2L-MISSING-CODE' },
    env: { READ2LEAD_CODES: makeKv(new Map()) },
  });
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error, 'not_found');
});

test('set-bot-stats snaps rank/packs/coins for a test code and marks it a bot', async () => {
  const records = new Map([
    ['R2L-TEST-BOT1', {
      parent_name: 'Chi Mai',
      is_test: true,
      student_profile: { student_name: 'Linh', age: 8, level: 'L1' },
      progress: { student_name: 'Linh', current_level: 'L1' },
    }],
  ]);
  const response = await onRequestPost({
    request: postRequest({ rank_label_vi: 'Bạc II', completed_packs: 6, coins: 150, student_name: 'RivalBot' }),
    params: { code: 'r2l-test-bot1' },
    env: { READ2LEAD_CODES: makeKv(records) },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.completed_packs, 6);
  assert.equal(body.rank_label_vi, 'Bạc II');
  assert.equal(records.get('R2L-TEST-BOT1').is_bot, true);
  assert.equal(records.get('progress:R2L-TEST-BOT1').completed_packs, 6);
  assert.equal(records.get('progress:R2L-TEST-BOT1').coins, 150);
});
