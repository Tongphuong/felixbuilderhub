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
