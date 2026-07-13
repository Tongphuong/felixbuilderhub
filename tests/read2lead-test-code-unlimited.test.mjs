// Test codes exist so the team can exercise the product without spending a real
// student's lesson credits. They already bypassed the "review your previous pack"
// gate, but nobody had exempted them from the CREDIT gate — so a test code burned
// uses_remaining like a real student and eventually hit code_exhausted.
// (This is exactly what happened to the live test code R2L-ONG-U5M6 on 2026-07-13.)
//
// The regression guards below are the important half of this file: real students
// must still be metered, and is_shared codes must still be metered.
import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/generate-read2lead-pack.js';
import { onRequestGet as checkStatus } from '../functions/api/check-generation-status.js';
import { onRequestGet as progressGet } from '../functions/api/read2lead-progress.js';
import { isUnlimitedCode, spendUse } from '../functions/api/_read2lead-v2-state.js';

const ACCESS_CODE = 'R2L-TEST-0001';
const PROGRESS_KEY = `progress:${ACCESS_CODE}`;

function storedBook(slug, title) {
  return {
    schema_version: 2,
    student_name: 'Student',
    level: 'L1',
    topic: title,
    book_slug: slug,
    book_images: ['https://audio.example/1.jpg', 'https://audio.example/2.jpg', 'https://audio.example/3.jpg'],
    book_page_audio: ['https://audio.example/1.mp3', 'https://audio.example/2.mp3', 'https://audio.example/3.mp3'],
    story: { title, paragraphs_en: ['One.', 'Two.', 'Three.'], sentences: [] },
    activities: [{ type: 'read_aloud', items: [] }],
  };
}

function progressAtL1() {
  return {
    schema_version: 2,
    level_reset_version: 20260606,
    current_level: 'L1',
    initial_level: 'L0',
    unlocked_levels: ['L0', 'L1'],
    xp_in_level: 0,
    total_xp: 100,
    level_progress: { L0: 5, L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 },
    completed_packs: 5,
    completed_pack_ids: [],
    coins: 0,
    streak_days: 0,
  };
}

function codeData({ isTest = false, isShared = false, uses = 3, expiresAt = null } = {}) {
  return {
    uses_remaining: uses,
    is_test: isTest,
    is_shared: isShared,
    ...(expiresAt ? { expires_at: expiresAt } : {}),
    completed_books: [],
    student_profile: { student_name: 'Minh', age: 9, level: 'L1', child_gender: 'boy' },
    progress: { current_level: 'L1', packs_created: 2, current_pack: null },
  };
}

function makeKv(initial) {
  const store = new Map(
    Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]),
  );
  return {
    store,
    kv: {
      async get(key) {
        const value = store.get(key);
        return value == null ? null : structuredClone(value);
      },
      async put(key, value) {
        store.set(key, typeof value === 'string' ? JSON.parse(value) : structuredClone(value));
      },
    },
  };
}

function fixtureFor(code) {
  return makeKv({
    [ACCESS_CODE]: code,
    [PROGRESS_KEY]: progressAtL1(),
    'book_index:L1': ['book_1'],
    'book:book_1': storedBook('book_1', 'Fresh Book'),
  });
}

async function generate(fixture) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('backend fetch must not run for book assignment');
  };
  try {
    const response = await onRequestPost({
      request: new Request('https://example.com/api/generate-read2lead-pack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' },
        body: JSON.stringify({ access_code: ACCESS_CODE }),
      }),
      env: { READ2LEAD_CODES: fixture.kv, READ2LEAD_BOOK_LEVELS: 'L1', RNG: () => 0 },
    });
    return { response, payload: await response.json() };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ---- the flag itself --------------------------------------------------------------

test('isUnlimitedCode is true only for is_test — never for is_shared or a plain code', () => {
  assert.equal(isUnlimitedCode({ is_test: true }), true);
  assert.equal(isUnlimitedCode({ is_test: false }), false);
  assert.equal(isUnlimitedCode({ is_shared: true }), false, 'shared codes go to several people — they stay metered');
  assert.equal(isUnlimitedCode({ is_test: true, is_shared: true }), true);
  assert.equal(isUnlimitedCode({}), false);
  assert.equal(isUnlimitedCode(undefined), false);
  assert.equal(isUnlimitedCode({ is_test: 'true' }), false, 'must be a real boolean, not a truthy string');
});

// ---- the fix ----------------------------------------------------------------------

test('a test code with ZERO uses left can still generate (this is the R2L-ONG-U5M6 bug)', async () => {
  const fixture = fixtureFor(codeData({ isTest: true, uses: 0 }));
  const { response, payload } = await generate(fixture);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.status, 'done');
  assert.equal(payload.story_title, 'Fresh Book');
  assert.notEqual(payload.error, 'code_exhausted');
});

test('a test code never burns a credit on a successful generate', async () => {
  const fixture = fixtureFor(codeData({ isTest: true, uses: 3 }));
  const { payload } = await generate(fixture);

  assert.equal(payload.ok, true);
  assert.equal(fixture.store.get(ACCESS_CODE).uses_remaining, 3, 'test code must still have all 3 uses');
});

test('a test code that has already hit zero stays at zero (no negative drift)', async () => {
  const fixture = fixtureFor(codeData({ isTest: true, uses: 0 }));
  const { payload } = await generate(fixture);

  assert.equal(payload.ok, true);
  assert.equal(fixture.store.get(ACCESS_CODE).uses_remaining, 0);
});

// Scope call (Buffet, 2026-07-13): expiry is still ENFORCED for test codes. It is the
// only time-based kill switch on a code that now has no credit ceiling — without it a
// leaked test code (pasted in a doc, screenshotted into Zalo) would be a permanently
// live, review-gate-free generator that costs real money on every call. An admin bumps
// the date to keep a test code alive. The reported bug was exhausted USES, not expiry.
test('an expired test code is still refused — unlimited uses, but expiry stays a kill switch', async () => {
  const fixture = fixtureFor(codeData({ isTest: true, uses: 5, expiresAt: '2020-01-01' }));
  const { response, payload } = await generate(fixture);

  assert.equal(response.status, 403);
  assert.equal(payload.error, 'code_expired');
});

test('a test code with NO expiry date set generates freely regardless of uses', async () => {
  const fixture = fixtureFor(codeData({ isTest: true, uses: 0 }));
  const { response, payload } = await generate(fixture);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
});

// ---- REGRESSION GUARDS: real students must still be metered -----------------------

test('REGRESSION: a real student code with zero uses is still refused', async () => {
  const fixture = fixtureFor(codeData({ isTest: false, uses: 0 }));
  const { response, payload } = await generate(fixture);

  assert.equal(response.status, 403);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'code_exhausted');
});

test('REGRESSION: a real student code still burns exactly one credit per generate', async () => {
  const fixture = fixtureFor(codeData({ isTest: false, uses: 3 }));
  const { payload } = await generate(fixture);

  assert.equal(payload.ok, true);
  assert.equal(fixture.store.get(ACCESS_CODE).uses_remaining, 2);
});

test('REGRESSION: an EXPIRED real student code is still refused', async () => {
  const fixture = fixtureFor(codeData({ isTest: false, uses: 5, expiresAt: '2020-01-01' }));
  const { response, payload } = await generate(fixture);

  assert.equal(response.status, 403);
  assert.equal(payload.error, 'code_expired');
});

test('REGRESSION: an is_shared code is NOT unlimited — it is metered and can exhaust', async () => {
  const exhausted = fixtureFor(codeData({ isTest: false, isShared: true, uses: 0 }));
  const { response, payload } = await generate(exhausted);
  assert.equal(response.status, 403);
  assert.equal(payload.error, 'code_exhausted', 'a shared code goes to several people — unlimited would be a cost hole');

  const spending = fixtureFor(codeData({ isTest: false, isShared: true, uses: 3 }));
  const second = await generate(spending);
  assert.equal(second.payload.ok, true);
  assert.equal(spending.store.get(ACCESS_CODE).uses_remaining, 2, 'shared codes still burn credits');
});

// ---- the ASYNC / legacy completion path ------------------------------------------
//
// A pack is finalised — and a credit spent — from THREE places, not one: the generate
// endpoint (above), check-generation-status.js (the client polling an async job) and
// read2lead-progress.js (the dashboard self-healing a stranded job). The first version
// of this fix only guarded the generate endpoint, and every test above forces the
// synchronous book-pool path, so the other two went unnoticed until review.
// These tests drive the async path directly.

const TASK_ID = 'task-abc';

function asyncPendingCode({ isTest, uses }) {
  const code = codeData({ isTest, uses });
  code.progress.current_pack = {
    task_id: TASK_ID,
    status: 'generation_in_progress',
    created_at: new Date().toISOString(),
    level: 'L1',
  };
  return code;
}

function doneTask() {
  return {
    status: 'done',
    result: {
      topic: 'Legacy Topic',
      story_title: 'Legacy Story',
      review_context: { schema_version: 2 },
    },
  };
}

async function pollStatus(fixture) {
  const response = await checkStatus({
    request: new Request(
      `https://example.com/api/check-generation-status?access_code=${ACCESS_CODE}&task_id=${TASK_ID}`,
      { headers: { 'CF-Connecting-IP': '127.0.0.1' } },
    ),
    env: { READ2LEAD_CODES: fixture.kv },
  });
  return { response, payload: await response.json() };
}

test('a test code does NOT burn a credit when an async generation completes via polling', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: asyncPendingCode({ isTest: true, uses: 2 }),
    [`task:${TASK_ID}`]: doneTask(),
  });

  const { payload } = await pollStatus(fixture);

  assert.equal(payload.ok, true);
  assert.equal(payload.status, 'done');
  assert.equal(
    fixture.store.get(ACCESS_CODE).uses_remaining,
    2,
    'the async completion path must respect the test-code exemption too',
  );
});

test('REGRESSION: a real student code still burns a credit on async completion', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: asyncPendingCode({ isTest: false, uses: 2 }),
    [`task:${TASK_ID}`]: doneTask(),
  });

  const { payload } = await pollStatus(fixture);

  assert.equal(payload.ok, true);
  assert.equal(payload.status, 'done');
  assert.equal(fixture.store.get(ACCESS_CODE).uses_remaining, 1, 'real students must still be metered here');
});

// ---- the dashboard SELF-HEAL path (read2lead-progress.js reconcileGenerationState) ----
//
// The fourth and last place a credit is spent. It is a HAND-DUPLICATED copy of the
// promote logic in check-generation-status.js ("Mirrors the promote logic…" says its own
// comment), not a shared call — so a regression test on the polling path gives it zero
// protection. Without these two tests, someone could revert line 277 to a raw decrement
// and the whole 1268-test suite would still pass. Real trigger: a kid closes the browser
// mid-generation and reopens their dashboard later; the pack is promoted here.

async function loadProgress(fixture) {
  const response = await progressGet({
    request: new Request(`https://example.com/api/read2lead-progress?code=${ACCESS_CODE}`, {
      headers: { 'CF-Connecting-IP': '127.0.0.1' },
    }),
    env: { READ2LEAD_CODES: fixture.kv },
  });
  return { response, payload: await response.json() };
}

test('a test code does NOT burn a credit when the dashboard self-heals a finished generation', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: asyncPendingCode({ isTest: true, uses: 2 }),
    [PROGRESS_KEY]: progressAtL1(),
    [`task:${TASK_ID}`]: doneTask(),
  });

  const { payload } = await loadProgress(fixture);

  assert.equal(payload.ok, true);
  assert.equal(
    payload.progress.current_pack.status,
    'awaiting_review',
    'the pack must actually have been promoted — otherwise this test proves nothing',
  );
  assert.equal(
    fixture.store.get(ACCESS_CODE).uses_remaining,
    2,
    'the dashboard self-heal path must respect the test-code exemption too',
  );
});

test('REGRESSION: a real student code still burns a credit on dashboard self-heal', async () => {
  const fixture = makeKv({
    [ACCESS_CODE]: asyncPendingCode({ isTest: false, uses: 2 }),
    [PROGRESS_KEY]: progressAtL1(),
    [`task:${TASK_ID}`]: doneTask(),
  });

  const { payload } = await loadProgress(fixture);

  assert.equal(payload.ok, true);
  assert.equal(payload.progress.current_pack.status, 'awaiting_review', 'pack must have been promoted');
  assert.equal(fixture.store.get(ACCESS_CODE).uses_remaining, 1, 'real students must still be metered here');
});

// ---- the shared rule itself -------------------------------------------------------

test('spendUse is the single rule every completion path shares', () => {
  assert.equal(spendUse({ is_test: true, uses_remaining: 5 }), 5, 'test code: unchanged');
  assert.equal(spendUse({ is_test: true, uses_remaining: 0 }), 0, 'test code at zero: no negative drift');
  assert.equal(spendUse({ is_test: false, uses_remaining: 5 }), 4, 'real code: spends one');
  assert.equal(spendUse({ is_test: false, uses_remaining: 0 }), 0, 'real code at zero: clamped, never negative');
  assert.equal(spendUse({ is_shared: true, uses_remaining: 5 }), 4, 'shared code: still spends');
  assert.equal(spendUse({}), 0);
  assert.equal(spendUse(undefined), 0);
});
