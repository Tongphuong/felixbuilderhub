// R2L-OPEN-ACCESS: _code-factory.js is the single source of truth for the
// code-record shape, shared by admin/codes.js (unchanged behavior) and the
// new public signup.js (adds `origin: 'self_serve'`). These tests pin both:
// admin's record stays byte-identical after the extraction, and the factory
// produces a record shape downstream endpoints (admin list, magic link) can
// read untouched.

import test from 'node:test';
import assert from 'node:assert/strict';

import { generateUniqueCodeForName, buildCodeRecord, boolFromFormValue, todayISO, addDaysISO } from '../functions/api/_code-factory.js';
import { onRequestPost as adminCreateCode } from '../functions/api/admin/codes.js';

function makeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key, options) {
      const value = store.get(key);
      if (value === undefined) return null;
      return options?.type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

test('generateUniqueCodeForName produces an R2L-<NAME>-<4chars> code not already in KV', async () => {
  const kv = makeKv();
  const code = await generateUniqueCodeForName(kv, 'Hoang');
  assert.match(code, /^R2L-HOANG-[A-Z0-9]{4}$/);
});

test('generateUniqueCodeForName retries on collision and eventually succeeds', async () => {
  // First 5 attempts collide, 6th must be accepted.
  let calls = 0;
  const kv = {
    async get() {
      calls += 1;
      return calls <= 5 ? { taken: true } : null;
    },
  };
  const code = await generateUniqueCodeForName(kv, 'Kid');
  assert.match(code, /^R2L-KID-[A-Z0-9]{4}$/);
});

test('generateUniqueCodeForName throws after 6 collisions (matches original admin behavior)', async () => {
  const kv = { async get() { return { taken: true }; } };
  await assert.rejects(() => generateUniqueCodeForName(kv, 'X'), /Could not generate unique code/);
});

test('boolFromFormValue accepts the same truthy forms admin relied on', () => {
  assert.equal(boolFromFormValue(true), true);
  assert.equal(boolFromFormValue('true'), true);
  assert.equal(boolFromFormValue('on'), true);
  assert.equal(boolFromFormValue('1'), true);
  assert.equal(boolFromFormValue(false), false);
  assert.equal(boolFromFormValue('0'), false);
  assert.equal(boolFromFormValue(undefined), false);
});

test('buildCodeRecord: admin call (no origin) never emits an origin key — byte-identical to pre-extraction shape', () => {
  const record = buildCodeRecord({
    parent_name: 'Mẹ Huy',
    parent_zalo: '0901234567',
    notes: 'trial',
    student_name: 'Huy',
    student_age: 8,
    child_gender: 'boy',
    uses_total: 3,
    expiry_days: 30,
    is_test: false,
    is_shared: false,
  });

  assert.equal('origin' in record, false, 'admin records must not carry an origin field');
  assert.deepEqual(Object.keys(record).sort(), [
    'expires_at', 'is_shared', 'is_test', 'issued_at', 'last_used_at',
    'notes', 'parent_name', 'parent_zalo', 'progress', 'student_profile',
    'uses_remaining', 'uses_total',
  ].sort());
  assert.equal(record.student_profile.student_name, 'Huy');
  assert.equal(record.student_profile.level, 'L1');
  assert.equal(record.progress.current_level, 'L1');
  assert.equal(record.progress.rank_title, 'Đồng');
  assert.equal(record.progress.packs_created, 0);
  assert.equal(record.progress.current_pack, null);
  assert.deepEqual(record.progress.badges, []);
  assert.deepEqual(record.progress.review_history, []);
  assert.equal(record.uses_total, 3);
  assert.equal(record.uses_remaining, 3);
  assert.equal(record.last_used_at, null);

  // Serialized round-trip must not introduce an `origin: undefined` key either.
  const roundTripped = JSON.parse(JSON.stringify(record));
  assert.equal('origin' in roundTripped, false);
});

test('buildCodeRecord: self-serve call carries origin:"self_serve", modulo that one field the shape matches admin', () => {
  const adminRecord = buildCodeRecord({
    student_name: 'Kid',
    student_age: 9,
    child_gender: 'girl',
    uses_total: 3,
    expiry_days: 90,
  });
  const selfServeRecord = buildCodeRecord({
    student_name: 'Kid',
    student_age: 9,
    child_gender: 'girl',
    uses_total: 3,
    expiry_days: 90,
    origin: 'self_serve',
  });

  assert.equal(selfServeRecord.origin, 'self_serve');
  const { origin, ...selfServeWithoutOrigin } = selfServeRecord;
  assert.deepEqual(selfServeWithoutOrigin, adminRecord, 'record shape must be identical modulo the origin field');
});

test('todayISO / addDaysISO round-trip sanity (used by both admin and signup)', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
  const future = addDaysISO(90);
  assert.ok(future > todayISO());
});

// ---------------------------------------------------------------------------
// Admin regression: onRequestPost must behave EXACTLY as before the extraction.
// ---------------------------------------------------------------------------

test('admin regression: POST /api/admin/codes still creates a code with the full legacy record shape', async () => {
  const kv = makeKv();
  const request = new Request('https://example.com/api/admin/codes', {
    method: 'POST',
    body: JSON.stringify({
      parent_name: 'Chị Lan',
      parent_zalo: '0987654321',
      notes: 'referred by a friend',
      student_name: 'Lan Anh',
      student_age: 7,
      child_gender: 'girl',
      uses: 10,
      expiry_days: 60,
      is_test: 'on',
      is_shared: false,
    }),
  });

  const response = await adminCreateCode({ request, env: { READ2LEAD_CODES: kv } });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.match(body.code, /^R2L-LANANH-[A-Z0-9]{4}$/);
  assert.equal(body.record.parent_name, 'Chị Lan');
  assert.equal(body.record.is_test, true, 'boolFromFormValue("on") must still coerce to true');
  assert.equal(body.record.is_shared, false);
  assert.equal(body.record.uses_total, 10);
  assert.equal(body.record.uses_remaining, 10);
  assert.equal('origin' in body.record, false, 'admin-created codes must never carry an origin field');

  // The record actually persisted to KV must match what was returned.
  const stored = JSON.parse(kv.store.get(body.code));
  assert.deepEqual(stored, body.record);
});

test('admin regression: still rejects student_age outside 5-14', async () => {
  const kv = makeKv();
  const request = new Request('https://example.com/api/admin/codes', {
    method: 'POST',
    body: JSON.stringify({
      parent_name: 'Anh Tuan', student_name: 'Kid', student_age: 15,
      child_gender: 'boy', uses: 3, expiry_days: 30,
    }),
  });
  const response = await adminCreateCode({ request, env: { READ2LEAD_CODES: kv } });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'student_age_invalid');
});

test('admin regression: still requires parent_name', async () => {
  const kv = makeKv();
  const request = new Request('https://example.com/api/admin/codes', {
    method: 'POST',
    body: JSON.stringify({ student_name: 'Kid', student_age: 8, child_gender: 'boy', uses: 3, expiry_days: 30 }),
  });
  const response = await adminCreateCode({ request, env: { READ2LEAD_CODES: kv } });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.error, 'parent_name_required');
});
