import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/submit-read2lead-lesson.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

// Regression for the 1502dd6 mismatch: the standard-lesson client renders 4
// parts (FRONTEND_ACTIVITY_ORDER) and never submits a read_aloud result, but
// the submit endpoint appended a read_aloud activity to the lesson context and
// expected it — so every real standard-pack submit failed from 2026-06-27 on.
// These fixtures send exactly what the real client sends: 4 results, no
// read_aloud.

const ACCESS_CODE = 'R2L-LEGACY-4TYPE';
const PACK_ID = 'pack-legacy-4type';

function packActivities() {
  return [
    {
      type: 'listening_fill_blank',
      items: [{ blank_word: 'kitchen' }, { blank_word: 'pancakes' }],
    },
    { type: 'listen_and_order', items: [{ tokens: ['Pilot', 'is', 'here'] }] },
    { type: 'reading_comprehension', questions: [{ correct_index: 0 }, { correct_index: 1 }] },
    { type: 'listen_and_speak', items: [{ text_en: 'Pilot is here.' }] },
  ];
}

function realClientResults({ skipSpeak = false, speakScore = 80 } = {}) {
  return [
    { type: 'listening_fill_blank', attempted: true, correct_count: 2, total_count: 2, wrong_count: 0 },
    { type: 'listen_and_order', attempted: true, correct_count: 1, total_count: 1, wrong_count: 0 },
    { type: 'reading_comprehension', attempted: true, correct_count: 2, total_count: 2, wrong_count: 0 },
    {
      type: 'listen_and_speak',
      attempted: true,
      correct_count: skipSpeak ? 0 : 1,
      total_count: 1,
      wrong_count: skipSpeak ? 1 : 0,
      score_percent: skipSpeak ? 0 : speakScore,
      ...(skipSpeak ? { skipped_due_to_mic: true } : {}),
    },
  ];
}

function makeEnv() {
  const codeData = {
    student_profile: { student_name: 'Pilot', level: 'L1' },
    progress: {
      current_pack: {
        pack_id: PACK_ID,
        schema_version: 2,
        status: 'awaiting_review',
        story: {
          title: 'Test Story',
          paragraphs_en: ['Pilot is here.'],
          sentences: [
            { text_en: 'Pilot is here.', text_vi: 'Pilot o day.', audio_url: '' },
            { text_en: 'He is happy.', text_vi: 'Con vui.', audio_url: '' },
          ],
        },
        activities: packActivities(),
      },
    },
  };
  const store = new Map([[ACCESS_CODE, structuredClone(codeData)]]);
  const kv = {
    async get(key) {
      const value = store.get(key);
      if (value == null) return null;
      return typeof value === 'string' ? JSON.parse(value) : structuredClone(value);
    },
    async put(key, value) {
      store.set(key, typeof value === 'string' ? JSON.parse(value) : structuredClone(value));
    },
  };
  return { env: { READ2LEAD_CODES: kv }, store };
}

async function submit(results, fixture) {
  return onRequestPost({
    request: new Request('https://example.com/api/submit-read2lead-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_code: ACCESS_CODE,
        pack_id: PACK_ID,
        answers: { schema_version: 2, activity_results: results },
      }),
    }),
    env: fixture.env,
  });
}

test('a real 4-type client submit with a passing spoken score passes', async () => {
  const fixture = makeEnv();
  const response = await submit(realClientResults(), fixture);
  const payload = await response.json();

  assert.equal(payload.ok, true);
  assert.equal(payload.passed, true, `expected pass, got: ${payload.message}`);
  assert.equal(payload.score_percent, 100, 'score must cover only the 4 activities the client presents');
  assert.equal(payload.current_pack.status, 'reviewed_pass_web_v2');
  assert.equal(payload.next_pack_unlocked, true);
});

test('a real 4-type client submit with mic-skip completes without reward', async () => {
  const fixture = makeEnv();
  const response = await submit(realClientResults({ skipSpeak: true }), fixture);
  const payload = await response.json();

  assert.equal(payload.ok, true);
  assert.equal(payload.passed, false);
  assert.equal(payload.completed_without_reward, true);
  assert.equal(payload.next_pack_unlocked, true);
  assert.equal(payload.current_pack.status, 'reviewed_pass_web_v2');
  assert.deepEqual(payload.rewards_earned, { coins: 0, xp: 0 });
  assert.equal(fixture.store.has(progressKey(ACCESS_CODE)), false, 'no reward state may be created');
});

test('book lessons keep expecting read_aloud via the book flow path', async () => {
  const fixture = makeEnv();
  const codeData = fixture.store.get(ACCESS_CODE);
  codeData.progress.current_pack.book_slug = 'book_12345';
  codeData.progress.current_pack.book_images = ['a.png', 'b.png', 'c.png'];
  codeData.progress.current_pack.activities = [{ type: 'read_aloud', items: [{ text_en: 'Hi.' }] }];
  fixture.store.set(ACCESS_CODE, codeData);

  // A book submit without book_flow_version must be rejected, proving the
  // book path (not the legacy 4-type path) still governs book packs.
  const response = await submit(realClientResults(), fixture);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'invalid_book_flow');
});
