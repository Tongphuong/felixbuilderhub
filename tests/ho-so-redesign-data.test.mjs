import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activityScore,
  buildSkillQuality,
  compactActivityScores,
} from '../functions/api/_read2lead-profile-quality.js';
import {
  onRequestGet as getWeeklyTasks,
  onRequestPost as updateWeeklyTask,
  weeklyTaskKey,
} from '../functions/api/parent/weekly-tasks.js';

test('profile activity scores use explicit percentages or derive from counts', () => {
  assert.deepEqual(activityScore({ type: 'read_aloud', score_percent: 84.6 }), {
    type: 'read_aloud',
    score_percent: 85,
  });
  assert.deepEqual(activityScore({ type: 'reading_comprehension', correct_count: 4, total_count: 5 }), {
    type: 'reading_comprehension',
    score_percent: 80,
  });
  assert.equal(activityScore({ type: 'listen_and_order' }), null);
  assert.equal(compactActivityScores([null, { type: '' }]).length, 0);
});

test('skill quality returns five truthful rows and ignores data older than 30 days', () => {
  const result = buildSkillQuality({
    nowIso: '2026-06-27T00:00:00.000Z',
    packHistory: [
      {
        pack_id: 'new',
        completed_at: '2026-06-20T00:00:00.000Z',
        activity_scores: [
          { type: 'reading_comprehension', score_percent: 80 },
          { type: 'listen_and_speak', score_percent: 60 },
          { type: 'listening_fill_blank', score_percent: 100 },
        ],
      },
      {
        pack_id: 'old',
        completed_at: '2026-04-01T00:00:00.000Z',
        activity_scores: [{ type: 'reading_comprehension', score_percent: 0 }],
      },
    ],
  });
  assert.equal(result.skills.length, 5);
  assert.equal(result.skills.find((skill) => skill.key === 'reading').score_percent, 80);
  assert.equal(result.skills.find((skill) => skill.key === 'listening').score_percent, 100);
  assert.equal(result.skills.find((skill) => skill.key === 'pronunciation').score_percent, 60);
  assert.equal(result.skills.find((skill) => skill.key === 'grammar').score_percent, null);
});

test('legacy history falls back to current reviewed pack activity results', () => {
  const result = buildSkillQuality({
    nowIso: '2026-06-27T00:00:00.000Z',
    packHistory: [{ pack_id: 'same', completed_at: '2026-06-25T00:00:00.000Z' }],
    currentPack: {
      pack_id: 'same',
      reviewed_at: '2026-06-25T00:00:00.000Z',
      review_summary: {
        activity_results: [{ type: 'listen_and_order', correct_count: 3, total_count: 4 }],
      },
    },
  });
  assert.equal(result.skills.find((skill) => skill.key === 'grammar').score_percent, 75);
});

function memoryKv(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key) {
      return values.has(key) ? structuredClone(values.get(key)) : null;
    },
    async put(key, value) {
      values.set(key, JSON.parse(value));
    },
  };
}

function context(kv, request) {
  return { env: { READ2LEAD_CODES: kv }, request };
}

test('parent weekly tasks persist and toggle within the current week', async () => {
  const code = 'R2L-LINH-1234';
  const kv = memoryKv({ [code]: { student_profile: { student_name: 'Linh' } } });
  const getRequest = new Request(`https://example.com/api/parent/weekly-tasks?code=${code}`);
  const initial = await (await getWeeklyTasks(context(kv, getRequest))).json();
  assert.deepEqual(initial.completed_task_ids, []);

  const post = (completed) => updateWeeklyTask(context(kv, new Request('https://example.com/api/parent/weekly-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, task_id: 'weekly_goal', completed }),
  })));
  const completed = await (await post(true)).json();
  assert.deepEqual(completed.completed_task_ids, ['weekly_goal']);
  assert.ok(kv.values.has(weeklyTaskKey(code, completed.week_key)));
  const reopened = await (await post(false)).json();
  assert.deepEqual(reopened.completed_task_ids, []);
});

test('parent weekly tasks reject unknown task ids', async () => {
  const code = 'R2L-LINH-1234';
  const kv = memoryKv({ [code]: {} });
  const response = await updateWeeklyTask(context(kv, new Request('https://example.com/api/parent/weekly-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, task_id: 'arbitrary', completed: true }),
  })));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'invalid_task');
});
