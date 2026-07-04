import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { onRequestPost } from '../functions/api/submit-read2lead-lesson.js';

const submitSource = readFileSync('functions/api/submit-read2lead-lesson.js', 'utf-8');

test('submit guards double award when web_attempts already has a passing attempt', () => {
  assert.match(submitSource, /hasPassingWebAttempt/);
  assert.match(submitSource, /already_completed: true/);
});

test('second rapid submit after a passing attempt returns already_completed without re-awarding', async () => {
  let saveCalls = 0;
  const codeData = {
    progress: {
      current_pack: {
        pack_id: 'pack-1',
        schema_version: 2,
        status: 'ready',
        story: { title: 'Test Story', paragraphs_en: ['Once upon a time.'] },
        activities: [
          { type: 'listening_fill_blank', items: [{ blank_word: 'time', sentence: 'Once upon a time.' }] },
          { type: 'listen_and_order', items: [{ tokens: ['Once', 'upon', 'a', 'time'] }] },
          { type: 'reading_comprehension', questions: [{ correct_index: 0, options_en: ['A', 'B', 'C'] }] },
          { type: 'written_response', questions: [{ question_en: 'What happened?' }] },
          { type: 'listen_and_speak', items: [{ text_en: 'Once upon a time.' }] },
          { type: 'retell_summary', retell_template: { lines: [{ text: 'Once ___ a time.' }] } },
        ],
        web_attempts: [
          {
            schema_version: 2,
            submitted_at: '2026-06-01T10:00:00.000Z',
            passed: true,
            score_percent: 100,
            correct_count: 6,
            total_count: 6,
            activity_results: [],
            rewards_earned: { coins: 15, xp: 20 },
          },
        ],
        web_lesson_summary: {
          submitted_at: '2026-06-01T10:00:00.000Z',
          passed: true,
          score_percent: 100,
          correct_count: 6,
          total_count: 6,
          rewards_earned: { coins: 15, xp: 20 },
        },
      },
    },
  };

  const env = {
    READ2LEAD_CODES: {
      async get() {
        return codeData;
      },
      async put() {
        saveCalls += 1;
      },
    },
  };

  const response = await onRequestPost({
    request: new Request('https://example.com/api/submit-read2lead-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_code: 'R2L-TEST-1234',
        pack_id: 'pack-1',
        answers: { activity_results: [] },
      }),
    }),
    env,
  });

  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.already_completed, true);
  assert.equal(saveCalls, 0, 'must not persist a second award');
});

test('passing submission removes web_session_checkpoint from the stored pack', async () => {
  let savedRecord = null;
  const codeData = {
    student_profile: { student_name: 'Bin', age: 8, level: 'L2', child_gender: 'boy' },
    progress: {
      current_level: 'L2',
      packs_created: 2,
      current_pack: {
        pack_id: 'pack-save-2',
        schema_version: 2,
        status: 'awaiting_review',
        story: { title: 'Test Story', paragraphs_en: ['Once upon a time.'] },
        activities: [
          { type: 'listening_fill_blank', items: [{ blank_word: 'time', sentence: 'Once upon a time.' }] },
          { type: 'listen_and_order', items: [{ tokens: ['Once', 'upon', 'a', 'time'] }] },
          { type: 'reading_comprehension', questions: [{ correct_index: 0, options_en: ['A', 'B', 'C'] }] },
          { type: 'listen_and_speak', items: [{ text_en: 'Once upon a time.' }] },
        ],
        web_session_checkpoint: {
          saved_at: '2026-07-01T00:00:00.000Z',
          snapshot: { schema_version: 2, activity_index: 1, completed_types: [] },
        },
        web_attempts: [],
      },
      review_history: [],
    },
    uses_remaining: 5,
  };
  const env = {
    READ2LEAD_CODES: {
      async get() { return codeData; },
      async put(key, value) { savedRecord = JSON.parse(value); },
    },
  };

  const response = await onRequestPost({
    request: new Request('https://example.com/api/submit-read2lead-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_code: 'R2L-TEST-IDM',
        pack_id: 'pack-save-2',
        answers: {
          activity_results: [
            { type: 'listening_fill_blank', attempted: true, correct_count: 2, total_count: 2, wrong_count: 0, score_percent: 100 },
            { type: 'listen_and_order', attempted: true, correct_count: 2, total_count: 2, wrong_count: 0, score_percent: 100 },
            { type: 'reading_comprehension', attempted: true, correct_count: 2, total_count: 2, wrong_count: 0, score_percent: 100 },
            { type: 'listen_and_speak', attempted: true, correct_count: 2, total_count: 2, wrong_count: 0, score_percent: 100 },
            { type: 'read_aloud', attempted: true, correct_count: 2, total_count: 2, wrong_count: 0, score_percent: 100 },
          ],
        },
      }),
    }),
    env,
  });

  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.passed, true);
  assert.ok(savedRecord);
  const finalPack = savedRecord.progress.current_pack;
  assert.equal(Object.hasOwn(finalPack, 'web_session_checkpoint'), false);
  assert.equal(finalPack.status, 'reviewed_pass_web_v2');
});

test('failing submission removes web_session_checkpoint from the stored pack', async () => {
  let savedRecord = null;
  const codeData = {
    student_profile: { student_name: 'Bin', age: 8, level: 'L2', child_gender: 'boy' },
    progress: {
      current_level: 'L2',
      packs_created: 2,
      current_pack: {
        pack_id: 'pack-save-3',
        schema_version: 2,
        status: 'awaiting_review',
        story: { title: 'Test Story', paragraphs_en: ['Once upon a time.'] },
        activities: [
          { type: 'listening_fill_blank', items: [{ blank_word: 'time', sentence: 'Once upon a time.' }] },
          { type: 'listen_and_order', items: [{ tokens: ['Once', 'upon', 'a', 'time'] }] },
          { type: 'reading_comprehension', questions: [{ correct_index: 0, options_en: ['A', 'B', 'C'] }] },
          { type: 'listen_and_speak', items: [{ text_en: 'Once upon a time.' }] },
        ],
        web_session_checkpoint: {
          saved_at: '2026-07-01T00:00:00.000Z',
          snapshot: { schema_version: 2, activity_index: 0, completed_types: [] },
        },
        web_attempts: [],
      },
      review_history: [],
    },
    uses_remaining: 5,
  };
  const env = {
    READ2LEAD_CODES: {
      async get() { return codeData; },
      async put(key, value) { savedRecord = JSON.parse(value); },
    },
  };

  const response = await onRequestPost({
    request: new Request('https://example.com/api/submit-read2lead-lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_code: 'R2L-TEST-IDM',
        pack_id: 'pack-save-3',
        answers: {
          activity_results: [
            { type: 'listening_fill_blank', attempted: true, correct_count: 0, total_count: 2, wrong_count: 2, score_percent: 0 },
            { type: 'listen_and_order', attempted: true, correct_count: 0, total_count: 2, wrong_count: 2, score_percent: 0 },
            { type: 'reading_comprehension', attempted: true, correct_count: 0, total_count: 2, wrong_count: 2, score_percent: 0 },
            { type: 'listen_and_speak', attempted: true, correct_count: 0, total_count: 2, wrong_count: 2, score_percent: 0 },
          ],
        },
      }),
    }),
    env,
  });

  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.passed, false);
  assert.ok(savedRecord);
  const finalPack = savedRecord.progress.current_pack;
  assert.equal(Object.hasOwn(finalPack, 'web_session_checkpoint'), false);
  // status should NOT be 'reviewed_pass_web_v2' (retry path)
  assert.equal(finalPack.status, 'awaiting_review');
});
