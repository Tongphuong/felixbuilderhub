import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildWeeklyGrowthForProfile,
  GROWTH_WEEKS_SHOWN,
  vietnamWeekKey,
} from '../functions/api/_read2lead-growth.js';

const progressApi = readFileSync('functions/api/read2lead-progress.js', 'utf-8');
const reviewPage = readFileSync('src/pages/ho-so/index.astro', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so.ts', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so-parent-view.ts', 'utf-8');

test('vietnamWeekKey buckets by Monday week in Vietnam calendar', () => {
  assert.equal(vietnamWeekKey('2026-06-07T10:00:00.000Z'), '2026-06-01');
  assert.equal(vietnamWeekKey('2026-06-09T10:00:00.000Z'), '2026-06-08');
});

test('buildWeeklyGrowthForProfile returns six week bars with parent copy', () => {
  const growth = buildWeeklyGrowthForProfile({
    studentName: 'Linh',
    nowIso: '2026-06-09T12:00:00.000Z',
    packHistory: [
      { pack_id: 'a', completed_at: '2026-06-09T02:00:00.000Z', xp: 20 },
      { pack_id: 'b', completed_at: '2026-06-08T02:00:00.000Z', xp: 20 },
      { pack_id: 'c', completed_at: '2026-06-01T02:00:00.000Z', xp: 20 },
    ],
  });

  assert.equal(growth.weeks.length, GROWTH_WEEKS_SHOWN);
  assert.equal(growth.this_week_packs, 2);
  assert.match(growth.headline, /Tuần này Linh đã học 2 truyện/);
  assert.equal(growth.weeks.filter((week) => week.is_current).length, 1);
  assert.ok(growth.weeks.every((week) => typeof week.bar_percent === 'number'));
});

test('buildWeeklyGrowthForProfile dedupes pack history and review history', () => {
  const growth = buildWeeklyGrowthForProfile({
    nowIso: '2026-06-09T12:00:00.000Z',
    packHistory: [{ pack_id: 'same', completed_at: '2026-06-09T02:00:00.000Z', xp: 20 }],
    reviewHistory: [
      {
        pack_id: 'same',
        status: 'reviewed_pass_web_v2',
        title: 'Story',
        reviewed_at: '2026-06-09T03:00:00.000Z',
      },
    ],
  });

  assert.equal(growth.this_week_packs, 1);
});

test('progress API includes weekly_growth payload', () => {
  assert.match(progressApi, /weekly_growth:/);
  assert.match(progressApi, /buildWeeklyGrowthForProfile/);
});

test('student profile renders weekly growth section', () => {
  assert.match(reviewPage, /renderGrowth/);
  assert.match(reviewPage, /Tăng trưởng 6 tuần/);
  assert.match(reviewPage, /weekly_growth/);
});
