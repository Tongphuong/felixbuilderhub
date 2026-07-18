import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { reconcileStrandedPack } from '../functions/api/_read2lead-reconcile-stranded.js';
import { onRequestGet as progressGet } from '../functions/api/read2lead-progress.js';

// Remediation for the 1502dd6 outage (2026-06-27 → 2026-07-08): packs whose
// kids finished every activity but stayed awaiting_review must complete
// server-side from the kid's own recorded work when their record is read.

const ACCESS_CODE = 'R2L-STRAND-TEST';
const PACK_ID = 'pack-stranded-1';

function packActivities() {
  return [
    { type: 'listening_fill_blank', items: [{ blank_word: 'kitchen' }, { blank_word: 'eggs' }] },
    { type: 'listen_and_order', items: [{ tokens: ['Pilot', 'is', 'here'] }] },
    { type: 'reading_comprehension', questions: [{ correct_index: 0 }, { correct_index: 1 }] },
    { type: 'listen_and_speak', items: [{ text_en: 'Pilot is here.' }] },
  ];
}

function finishedResults({ skipSpeak = false, speakScore = 80, wrongEverything = false } = {}) {
  const good = (total) => (wrongEverything
    ? { correct_count: 0, total_count: total, wrong_count: total }
    : { correct_count: total, total_count: total, wrong_count: 0 });
  return [
    { type: 'listening_fill_blank', attempted: true, ...good(2) },
    { type: 'listen_and_order', attempted: true, ...good(1) },
    { type: 'reading_comprehension', attempted: true, ...good(2) },
    {
      type: 'listen_and_speak',
      attempted: true,
      correct_count: skipSpeak || wrongEverything ? 0 : 1,
      total_count: 1,
      wrong_count: skipSpeak || wrongEverything ? 1 : 0,
      score_percent: skipSpeak || wrongEverything ? 0 : speakScore,
      ...(skipSpeak ? { skipped_due_to_mic: true } : {}),
    },
  ];
}

function strandedCodeData({ source = 'attempt', resultOptions = {} } = {}) {
  const results = finishedResults(resultOptions);
  const currentPack = {
    pack_id: PACK_ID,
    schema_version: 2,
    status: 'awaiting_review',
    created_at: '2026-07-01T08:00:00.000Z',
    topic: 'Food and cooking',
    story_title: 'Test Story',
    story: {
      title: 'Test Story',
      paragraphs_en: ['Pilot is here.'],
      sentences: [{ text_en: 'Pilot is here.', text_vi: 'Pilot o day.', audio_url: '' }],
    },
    activities: packActivities(),
  };
  if (source === 'attempt') {
    // The exact payload a kid clicked "Lưu chiến công" with during the bug
    // window — the failed submit stripped the checkpoint, this is all that
    // remains.
    currentPack.web_attempts = [{
      schema_version: 2,
      submitted_at: '2026-07-01T08:30:00.000Z',
      passed: false,
      score_percent: 37,
      activity_results: results,
    }];
    currentPack.web_lesson_summary = {
      submitted_at: '2026-07-01T08:30:00.000Z',
      passed: false,
    };
  } else if (source === 'checkpoint') {
    // The client stores activity_results as an object keyed by type.
    currentPack.web_session_checkpoint = {
      saved_at: '2026-07-01T08:30:00.000Z',
      snapshot: {
        schema_version: 2,
        completed_types: results.map((result) => result.type),
        activity_results: Object.fromEntries(results.map((result) => [result.type, result])),
      },
    };
  }
  return {
    student_profile: { student_name: 'Pilot', age: 8, level: 'L1', child_gender: 'boy' },
    uses_remaining: 5,
    progress: {
      packs_created: 1,
      completed_packs: 0,
      current_pack: currentPack,
      review_history: [],
    },
  };
}

function makeEnv(codeData) {
  const store = new Map([[ACCESS_CODE, structuredClone(codeData)]]);
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
  return { env: { READ2LEAD_CODES: kv }, store, puts };
}

async function runReconcile(fixture) {
  const codeData = await fixture.env.READ2LEAD_CODES.get(ACCESS_CODE, { type: 'json' });
  return reconcileStrandedPack({ env: fixture.env, accessCode: ACCESS_CODE, codeData });
}

test('stranded pack with a bug-window failed attempt completes with rewards', async () => {
  const fixture = makeEnv(strandedCodeData({ source: 'attempt' }));
  const { reconciled, codeData } = await runReconcile(fixture);

  assert.equal(reconciled, true);
  const pack = codeData.progress.current_pack;
  assert.equal(pack.status, 'reviewed_pass_web_v2');
  const lastAttempt = pack.web_attempts.at(-1);
  assert.equal(lastAttempt.passed, true);
  assert.ok(lastAttempt.rewards_earned.xp > 0, 'passing rescue must award XP');
});

test('stranded pack with only a finished checkpoint snapshot completes', async () => {
  const fixture = makeEnv(strandedCodeData({ source: 'checkpoint' }));
  const { reconciled, codeData } = await runReconcile(fixture);

  assert.equal(reconciled, true);
  assert.equal(codeData.progress.current_pack.status, 'reviewed_pass_web_v2');
});

test('mic-skip source completes without reward', async () => {
  const fixture = makeEnv(strandedCodeData({ source: 'checkpoint', resultOptions: { skipSpeak: true } }));
  const { reconciled, codeData } = await runReconcile(fixture);

  assert.equal(reconciled, true);
  const pack = codeData.progress.current_pack;
  assert.equal(pack.status, 'reviewed_pass_web_v2');
  const lastAttempt = pack.web_attempts.at(-1);
  assert.equal(lastAttempt.passed, false);
  assert.equal(lastAttempt.completed_without_reward, true);
  assert.deepEqual(lastAttempt.rewards_earned, { diamonds: 0, xp: 0 });
});

test('genuinely failing work is left byte-identical — a passive read never penalizes', async () => {
  const before = strandedCodeData({ source: 'attempt', resultOptions: { wrongEverything: true } });
  const fixture = makeEnv(before);
  const { reconciled, codeData } = await runReconcile(fixture);

  assert.equal(reconciled, false);
  assert.equal(fixture.puts.length, 0, 'no KV writes allowed');
  assert.deepEqual(codeData, before);
});

test('genuinely unfinished work (missing activity) is left untouched', async () => {
  const data = strandedCodeData({ source: 'checkpoint' });
  const snapshot = data.progress.current_pack.web_session_checkpoint.snapshot;
  delete snapshot.activity_results.reading_comprehension;
  const fixture = makeEnv(data);
  const { reconciled } = await runReconcile(fixture);

  assert.equal(reconciled, false);
  assert.equal(fixture.puts.length, 0);
});

test('book packs are never reconciled', async () => {
  const data = strandedCodeData({ source: 'checkpoint' });
  data.progress.current_pack.book_slug = 'book_12345';
  data.progress.current_pack.activities = [
    { type: 'read_aloud', items: [{ text_en: 'Hi.' }] },
  ];
  const fixture = makeEnv(data);
  const { reconciled } = await runReconcile(fixture);

  assert.equal(reconciled, false);
  assert.equal(fixture.puts.length, 0);
});

test('reconciliation is idempotent — the second read changes nothing', async () => {
  const fixture = makeEnv(strandedCodeData({ source: 'attempt' }));
  const first = await runReconcile(fixture);
  assert.equal(first.reconciled, true);
  const putsAfterFirst = fixture.puts.length;
  const completedPacksAfterFirst = first.codeData.progress.completed_packs;

  const second = await runReconcile(fixture);
  assert.equal(second.reconciled, false, 'status is no longer awaiting_review');
  assert.equal(fixture.puts.length, putsAfterFirst);
  assert.equal(second.codeData.progress.completed_packs, completedPacksAfterFirst);
});

test('progress dashboard GET rescues a stranded pack end-to-end', async () => {
  const fixture = makeEnv(strandedCodeData({ source: 'attempt' }));
  const response = await progressGet({
    request: new Request(`https://example.com/api/read2lead-progress?code=${ACCESS_CODE}`),
    env: fixture.env,
  });
  const payload = await response.json();

  assert.equal(payload.ok, true);
  assert.equal(payload.state, 'reviewed');
  assert.equal(payload.progress.current_pack.status, 'reviewed_pass_web_v2');
  assert.equal(payload.next_pack_locked, false);
});

test('generate endpoint reconciles before evaluating the previous-pack gate', () => {
  const generateSource = readFileSync('functions/api/generate-read2lead-pack.js', 'utf8');
  const reconcileIdx = generateSource.indexOf('reconcileStrandedPack({ env, accessCode, codeData })');
  const gateIdx = generateSource.indexOf('currentPackBlocksGeneration(progress.current_pack');
  assert.ok(reconcileIdx > -1, 'generate endpoint must call reconcileStrandedPack');
  assert.ok(gateIdx > -1, 'gate must still exist');
  assert.ok(reconcileIdx < gateIdx, 'reconcile must run before the gate');
});
