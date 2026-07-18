// R2L-PAGE-LOOP (book flow v3): the submit endpoint must accept
// book_flow_version 2 OR 3 and pass the payload's actual version through to
// validateBookFlowSubmission, while everything else (synthetic read_aloud
// activity, speaking gate, rewards, standard-pack path) stays byte-identical.
// See specs/SPEC_R2L_PAGE_LOOP.md and functions/api/submit-read2lead-lesson.js.
//
// This mirrors the fixture pattern already established in
// tests/read2lead-book-payload-completion.test.mjs for the v2-only path, built
// with the version-aware makeBookReaderState (tests/helpers/book-pack-fixture.mjs)
// so both versions run through the SAME real fixture and production functions.
import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/submit-read2lead-lesson.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';
import { makeStoredBookPack, makeBookReaderState } from './helpers/book-pack-fixture.mjs';

const ACCESS_CODE = 'R2L-BOOK-V3-SUBMIT';
const PACK_ID = 'book-pack-v3';

function makeFixture() {
  const pack = makeStoredBookPack('book_42', { pages: 2, sentencesPerPage: 2, questionsPerPage: 2 });
  const codeData = {
    completed_books: [],
    student_profile: { student_name: 'Minh', level: 'L1' },
    progress: {
      current_pack: {
        pack_id: PACK_ID,
        status: 'ready',
        schema_version: 2,
        review_context: pack,
      },
    },
  };
  const progressState = {
    schema_version: 2,
    access_code: ACCESS_CODE,
    student_name: 'Minh',
    current_level: 'L1',
    initial_level: 'L1',
    unlocked_levels: ['L1'],
    coins: 0,
    total_xp: 0,
    xp_in_level: 0,
    completed_packs: 0,
    level_progress: { L1: 0, L2: 0, L3: 0, L4: 0, L5: 0 },
    streak_days: 0,
  };
  const store = new Map([
    [ACCESS_CODE, structuredClone(codeData)],
    [progressKey(ACCESS_CODE), structuredClone(progressState)],
  ]);
  return {
    pack,
    store,
    env: {
      RNG: () => 0,
      READ2LEAD_CODES: {
        async get(key) {
          const value = store.get(key);
          return value == null ? null : structuredClone(value);
        },
        async put(key, value) {
          store.set(key, typeof value === 'string' ? JSON.parse(value) : structuredClone(value));
        },
      },
    },
  };
}

async function submit(bookFlowVersion, bookReaderState, fixture) {
  return onRequestPost({
    request: new Request('https://example.com/api/submit-read2lead-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' },
      body: JSON.stringify({
        access_code: ACCESS_CODE,
        pack_id: PACK_ID,
        answers: {
          book_flow_version: bookFlowVersion,
          book_reader: bookReaderState,
          activity_results: [],
        },
      }),
    }),
    env: fixture.env,
  });
}

test('a v2 (shadow chunks) book payload still validates end-to-end through the submit endpoint', async () => {
  const fixture = makeFixture();
  const reader = makeBookReaderState(fixture.pack, { version: 2 });
  const response = await submit(2, reader, fixture);
  const payload = await response.json();
  assert.equal(payload.ok, true, JSON.stringify(payload));
  assert.equal(payload.passed, true);
  assert.deepEqual(fixture.store.get(ACCESS_CODE).completed_books, ['book_42']);
});

test('a v3 (page reads) book payload is accepted end-to-end through the submit endpoint', async () => {
  const fixture = makeFixture();
  const reader = makeBookReaderState(fixture.pack, { version: 3 });
  const response = await submit(3, reader, fixture);
  const payload = await response.json();
  assert.equal(payload.ok, true, JSON.stringify(payload));
  assert.equal(payload.passed, true);
  assert.deepEqual(fixture.store.get(ACCESS_CODE).completed_books, ['book_42']);
  // R2L-REWARDS-REDESIGN (Buffet fix round, spec §11.7): 2 pages, each with a
  // single passed page_read (short sentences, well under the 60-word split
  // cap) -> 2 pages * 5💎 = 10 page-diamonds, plus the grade-S bonus (10💎)
  // for the 90% score makeBookReaderState uses -> 20💎 total, wired
  // end-to-end through countPagesWithPassedReadUnit, not a per-unit count.
  assert.equal(payload.rewards_earned.diamonds, 20);
});

test('a v3 payload validated as v2 (or vice versa) is rejected as invalid, not silently accepted', async () => {
  const fixture = makeFixture();
  const v3Reader = makeBookReaderState(fixture.pack, { version: 3 });
  // A v3-shaped reader submitted with book_flow_version: 2 must fail
  // validation (v2 rules expect shadow_chunks, not page_reads) rather than
  // pass under the wrong rules.
  const response = await submit(2, v3Reader, fixture);
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.error, 'invalid_book_flow');
});

test('a book_flow_version outside {2, 3} is rejected before validation runs', async () => {
  const fixture = makeFixture();
  const reader = makeBookReaderState(fixture.pack, { version: 3 });
  const response = await submit(4, reader, fixture);
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'invalid_book_flow');
});
