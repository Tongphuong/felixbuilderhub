import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  evaluateSpeakingGate,
  onRequestPost,
  SPEAKING_PASS_PERCENT,
} from '../functions/api/submit-read2lead-lesson.js';
import { progressKey } from '../functions/api/_read2lead-v2-state.js';

const ACCESS_CODE = 'R2L-SPEAK-5050';
const PACK_ID = 'pack-speaking';
const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf8');
const read2LeadPage = readFileSync('src/pages/read2lead.astro', 'utf8');
const submitSource = readFileSync('functions/api/submit-read2lead-lesson.js', 'utf8');

function activities() {
  return [
    { type: 'listening_fill_blank', items: [{ blank_word: 'time' }] },
    { type: 'listen_and_order', items: [{ tokens: ['Once', 'upon'] }] },
    { type: 'reading_comprehension', questions: [{ correct_index: 0 }] },
    { type: 'written_response', questions: [{ question_en: 'What happened?' }] },
    { type: 'listen_and_speak', items: [{ text_en: 'Once upon a time.' }] },
    { type: 'retell_summary', retell_template: { lines: [{ text: 'Once ___.' }] } },
  ];
}

function activityResults({ speakScore = 50, skipSpeak = false } = {}) {
  return [
    { type: 'listening_fill_blank', attempted: true, correct_count: 1, total_count: 1 },
    { type: 'listen_and_order', attempted: true, correct_count: 1, total_count: 1 },
    { type: 'reading_comprehension', attempted: true, correct_count: 1, total_count: 1 },
    { type: 'written_response', attempted: true, correct_count: 1, total_count: 1 },
    {
      type: 'listen_and_speak',
      attempted: true,
      correct_count: skipSpeak ? 0 : 1,
      total_count: 1,
      wrong_count: skipSpeak ? 1 : 0,
      score_percent: skipSpeak ? 0 : speakScore,
      ...(skipSpeak ? { skipped_due_to_mic: true } : {}),
    },
    {
      type: 'retell_summary',
      attempted: true,
      correct_count: 1,
      total_count: 1,
      score_percent: 60,
    },
  ];
}

function makeEnv() {
  const codeData = {
    student_profile: { student_name: 'Minh', level: 'L1' },
    progress: {
      current_pack: {
        pack_id: PACK_ID,
        schema_version: 2,
        status: 'ready',
        story: { title: 'Test Story', paragraphs_en: ['Once upon a time.'] },
        activities: activities(),
      },
    },
  };
  const rewardState = {
    schema_version: 2,
    coins: 123,
    total_xp: 77,
    rank_points: 19,
    streak_days: 4,
    completed_packs: 3,
    pending_chest: { rarity: 'rare' },
    daily_quests: { date: '2026-06-15', ids: [], progress: {}, claimed: {} },
  };
  const store = new Map([
    [ACCESS_CODE, structuredClone(codeData)],
    [progressKey(ACCESS_CODE), structuredClone(rewardState)],
  ]);
  const puts = [];
  const kv = {
    async get(key) {
      const value = store.get(key);
      if (value == null) return null;
      return typeof value === 'string' ? JSON.parse(value) : structuredClone(value);
    },
    async put(key, value) {
      puts.push(key);
      store.set(key, typeof value === 'string' ? JSON.parse(value) : structuredClone(value));
    },
  };
  return { env: { READ2LEAD_CODES: kv }, store, puts, rewardState };
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

test('speaking gate passes exactly 50%', () => {
  assert.equal(SPEAKING_PASS_PERCENT, 50);
  assert.deepEqual(
    evaluateSpeakingGate(activityResults({ speakScore: 50 }), activities().map((item) => item.type)),
    { passed: true, skipped: false },
  );
});

test('speaking gate rejects 49.9%', () => {
  assert.deepEqual(
    evaluateSpeakingGate(activityResults({ speakScore: 49.9 }), activities().map((item) => item.type)),
    { passed: false, skipped: false },
  );
});

test('mic skip is completion without a speaking pass', () => {
  assert.deepEqual(
    evaluateSpeakingGate(activityResults({ skipSpeak: true }), activities().map((item) => item.type)),
    { passed: false, skipped: true },
  );
});

test('mic skip unlocks a new pack while preserving every reward state', async () => {
  const fixture = makeEnv();
  const rewardBefore = structuredClone(fixture.store.get(progressKey(ACCESS_CODE)));
  const response = await submit(activityResults({ skipSpeak: true }), fixture);
  const payload = await response.json();

  assert.equal(payload.ok, true);
  assert.equal(payload.completed, true);
  assert.equal(payload.completed_without_reward, true);
  assert.equal(payload.passed, false);
  assert.equal(payload.next_pack_unlocked, true);
  assert.deepEqual(payload.rewards_earned, { coins: 0, xp: 0 });
  assert.equal(payload.current_pack.status, 'reviewed_pass_web_v2');
  assert.deepEqual(fixture.store.get(progressKey(ACCESS_CODE)), rewardBefore);
  assert.equal(fixture.puts.includes(progressKey(ACCESS_CODE)), false);
});

test('sub-50 speaking without skip remains retryable and does not unlock next pack', async () => {
  const fixture = makeEnv();
  const response = await submit(activityResults({ speakScore: 49.9 }), fixture);
  const payload = await response.json();

  assert.equal(payload.passed, false);
  assert.equal(payload.completed_without_reward, undefined);
  assert.equal(payload.next_pack_unlocked, false);
  assert.notEqual(payload.current_pack.status, 'reviewed_pass_web_v2');
});

test('mic and ASR errors retry before the explicit no-reward escape hatch', () => {
  assert.match(lessonPage, /Minny chưa chấm điểm được\. Con bấm Thu lại nhé!/);
  assert.match(lessonPage, /_R2L_SKIP_AFTER_FAILURES = 2/);
  assert.match(lessonPage, /skipped_due_to_mic: true/);
  assert.doesNotMatch(lessonPage, /_r2lCompleteSpeakActivityOnEffort/);
  assert.doesNotMatch(lessonPage, /_r2lCompleteRetellOnEffort/);
  assert.doesNotMatch(read2LeadPage, /tự đánh giá/);
});

test('no-reward finalizer bypasses all gamification award hooks', () => {
  const start = submitSource.indexOf('async function finalizeWithoutReward');
  const end = submitSource.indexOf('async function respondFromCachedAttempt', start);
  const body = submitSource.slice(start, end);
  for (const forbidden of [
    'applyPackCompletion',
    'awardRankPoints',
    'applyQuestProgress',
    'awardPendingChest',
    'recordComboBonus',
    'saveProgressState',
  ]) {
    assert.doesNotMatch(body, new RegExp(forbidden));
  }
});

test('legacy reviewed packs without a summary remain safely completed', async () => {
  const fixture = makeEnv();
  const codeData = fixture.store.get(ACCESS_CODE);
  codeData.progress.current_pack.status = 'reviewed_pass_web_v2';
  const response = await submit(activityResults(), fixture);
  const payload = await response.json();

  assert.equal(payload.ok, true);
  assert.equal(payload.already_completed, true);
  assert.equal(payload.completed, true);
  assert.equal(payload.passed, true);
  assert.equal(payload.next_pack_unlocked, true);
});
