import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { onRequestGet as getClasses, onRequestPost as createClass } from '../functions/api/admin/classes.js';
import { onRequestPatch as patchClass } from '../functions/api/admin/classes/[id].js';
import { onRequestPost as rewardClassStudent } from '../functions/api/admin/classes/[id]/reward.js';

const adminCodesPage = readFileSync('src/pages/admin/codes.astro', 'utf-8');
const adminClassesPage = readFileSync('src/pages/admin/classes.astro', 'utf-8');
const adminLayout = readFileSync('src/layouts/AdminLayout.astro', 'utf-8');

function makeKv(records = new Map()) {
  return {
    records,
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
    async delete(key) {
      records.delete(key);
    },
  };
}

async function jsonResponse(handler, { method = 'GET', path = '/api/admin/classes', body = undefined, env, params = {} }) {
  const response = await handler({
    request: new Request(`https://example.com${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
    params,
  });
  return { response, body: await response.json() };
}

test('admin navigation exposes the coaching class hub without removing code management', () => {
  assert.match(adminLayout, /href: '\/admin\/classes'/);
  assert.match(adminClassesPage, /Lớp coaching Read2Lead/);
  assert.match(adminClassesPage, /Bảng lớp live/);
  assert.match(adminClassesPage, /id="create-class"/);
  assert.match(adminCodesPage, /id="create-form"/);
  assert.match(adminCodesPage, /id="codes-list"/);
  assert.match(adminClassesPage, /\/api\/admin\/classes/);
});

test('class APIs manage membership, attendance, and shared Read2Lead rewards', async () => {
  const code = 'R2L-ANA-1111';
  const records = new Map([
    [code, {
      parent_name: 'Chị An',
      student_profile: { student_name: 'Ana', age: 8, level: 'L1', child_gender: 'girl' },
      progress: { student_name: 'Ana', age: 8, current_level: 'L1' },
    }],
    [`progress:${code}`, {
      schema_version: 2,
      level_reset_version: 20260606,
      access_code: code,
      student_name: 'Ana',
      current_level: 'L1',
      initial_level: 'L1',
      unlocked_levels: ['L1'],
      coins: 12,
      total_xp: 20,
      xp_in_level: 20,
      rank_points: 42,
      streak_days: 3,
    }],
  ]);
  const env = { READ2LEAD_CODES: makeKv(records) };

  const created = await jsonResponse(createClass, {
    method: 'POST',
    body: {},
    env,
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.class.name, 'Felix coaching group');
  const classId = created.body.class.id;

  const add = await jsonResponse(patchClass, {
    method: 'PATCH',
    path: `/api/admin/classes/${classId}`,
    params: { id: classId },
    body: { add_code: code },
    env,
  });
  assert.equal(add.response.status, 200);
  assert.deepEqual(add.body.class.student_codes, [code]);

  const second = await jsonResponse(createClass, {
    method: 'POST',
    body: { name: 'Felix coaching group 2' },
    env,
  });
  const duplicate = await jsonResponse(patchClass, {
    method: 'PATCH',
    path: `/api/admin/classes/${second.body.class.id}`,
    params: { id: second.body.class.id },
    body: { add_code: code },
    env,
  });
  assert.equal(duplicate.response.status, 409);
  assert.equal(duplicate.body.error, 'student_already_in_class');

  const attended = await jsonResponse(patchClass, {
    method: 'PATCH',
    path: `/api/admin/classes/${classId}`,
    params: { id: classId },
    body: { attendance: { code, date: '2026-06-30', status: 'present' } },
    env,
  });
  assert.equal(attended.response.status, 200);
  assert.equal(attended.body.class.attendance_by_date['2026-06-30'][code], 'present');

  const listed = await jsonResponse(getClasses, { env });
  const firstClass = listed.body.classes.find((klass) => klass.id === classId);
  assert.equal(firstClass.students[0].student_name, 'Ana');
  assert.equal(firstClass.students[0].age, 8);
  assert.equal(firstClass.students[0].read2lead_state.coins, 12);
  assert.equal(firstClass.students[0].read2lead_state.xp_in_level, 20);
  assert.equal(firstClass.students[0].read2lead_state.streak_days, 3);
  assert.ok(firstClass.students[0].read2lead_state.avatar);

  const rewarded = await jsonResponse(rewardClassStudent, {
    method: 'POST',
    path: `/api/admin/classes/${classId}/reward`,
    params: { id: classId },
    body: { code, xp_delta: 10, coins_delta: 5, reason: 'Can đảm nói', kind: 'positive' },
    env,
  });
  assert.equal(rewarded.response.status, 200);
  assert.equal(rewarded.body.read2lead_state.coins, 17);
  assert.equal(rewarded.body.read2lead_state.xp_in_level, 30);
  assert.equal(records.get(`progress:${code}`).rank_points, 42);

  const clamped = await jsonResponse(rewardClassStudent, {
    method: 'POST',
    path: `/api/admin/classes/${classId}/reward`,
    params: { id: classId },
    body: { code, xp_delta: -999, coins_delta: -999, reason: 'Cần luyện thêm', kind: 'needs_work' },
    env,
  });
  assert.equal(clamped.response.status, 200);
  assert.equal(clamped.body.read2lead_state.coins, 0);
  assert.equal(clamped.body.read2lead_state.xp_in_level, 0);
  assert.equal(records.get(`progress:${code}`).rank_points, 42);
});
