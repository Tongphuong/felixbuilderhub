import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestGet as listCodes } from '../functions/api/admin/codes.js';
import { isAccessCodeKey } from '../functions/api/_read2lead-v2-state.js';

test('isAccessCodeKey excludes system KV keys', () => {
  assert.equal(isAccessCodeKey('R2L-HOANG-CDMA'), true);
  assert.equal(isAccessCodeKey('progress:R2L-HOANG-CDMA'), false);
  assert.equal(isAccessCodeKey('task:abc'), false);
  assert.equal(isAccessCodeKey('rl:1.2.3.4'), false);
  assert.equal(isAccessCodeKey('leaderboard-cache'), false);
});

test('admin codes list enriches student_name from v2 progress state', async () => {
  const code = 'R2L-ADMIN-V2';
  const records = new Map([
    [code, {
      progress: { completed_packs: 2 },
      student_profile: {},
    }],
    [
      `progress:${code}`,
      {
        schema_version: 2,
        level_reset_version: 20260606,
        access_code: code,
        student_name: 'Huy',
        current_level: 'L2',
        completed_packs: 2,
        coins: 10,
        total_xp: 50,
      },
    ],
    ['leaderboard-cache', { leaders: [], updated_at: '2026-01-01' }],
    ['rl:127.0.0.1', { count: 1 }],
  ]);
  const kv = {
    async list() {
      return {
        keys: Array.from(records.keys()).map((name) => ({ name })),
        cursor: undefined,
        list_complete: true,
      };
    },
    async get(key, options) {
      const value = records.get(key);
      if (!value) return null;
      return options?.type === 'json' ? value : JSON.stringify(value);
    },
    async put(key, value) {
      records.set(key, JSON.parse(value));
    },
  };

  const response = await listCodes({
    request: new Request('https://example.com/api/admin/codes'),
    env: { READ2LEAD_CODES: kv },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].code, code);
  assert.equal(body.items[0].student_profile.student_name, 'Huy');
  assert.equal(body.items[0].progress.current_level, 'L2');
});
