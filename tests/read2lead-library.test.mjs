import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildStoryProgressForProfile,
  listCompletedStories,
  topicEmoji,
} from '../functions/api/_read2lead-library.js';

function makeReviewHistory(count) {
  return Array.from({ length: count }, (_, index) => ({
    pack_id: `pack-${count - index}`,
    status: 'reviewed_pass_web_v2',
    title: `Story ${count - index}`,
    topic: index % 2 === 0 ? 'School' : 'Animals',
    level: 'L1',
    reviewed_at: `2026-06-0${(index % 7) + 1}T10:00:00.000Z`,
  }));
}

test('topicEmoji maps known topics and falls back safely', () => {
  assert.equal(topicEmoji('School Day'), '🏫');
  assert.equal(topicEmoji('Animals and pets'), '🐾');
  assert.match(topicEmoji('Unknown topic'), /[\u{1F300}-\u{1FAFF}]/u);
});

test('listCompletedStories keeps newest reviewed packs first', () => {
  const stories = listCompletedStories([
    { pack_id: 'new', status: 'reviewed_pass_web_v2', title: 'Newest', topic: 'School' },
    { pack_id: 'skip', status: 'generation_in_progress', title: 'Skip' },
    { pack_id: 'old', status: 'reviewed_pass_web_v2', title: 'Older', topic: 'Animals' },
  ]);
  assert.deepEqual(stories.map((story) => story.pack_id), ['new', 'old']);
});

test('buildStoryProgressForProfile uses parent-friendly copy', () => {
  const progress = buildStoryProgressForProfile({
    studentName: 'Hoàng',
    reviewHistory: makeReviewHistory(2),
    currentLevel: 'L1',
    packsCompletedInLevel: 2,
    packsNeededForLevelUp: 5,
    accessCode: 'R2L-TEST-1234',
  });

  assert.equal(progress.total_completed, 2);
  assert.match(progress.headline, /Hoàng đã học xong 2 truyện/);
  assert.match(progress.parent_hint, /Cho con làm lại/);
  assert.match(progress.level_hint, /Còn 3 truyện nữa/);
  assert.equal(progress.stories.length, 2);
  assert.match(progress.stories[0].lesson_path, /R2L-TEST-1234/);
});

test('buildStoryProgressForProfile handles empty state for parents', () => {
  const progress = buildStoryProgressForProfile({ studentName: 'Bin' });
  assert.equal(progress.total_completed, 0);
  assert.match(progress.headline, /Bin chưa có truyện nào hoàn thành/);
  assert.match(progress.empty_hint, /bố mẹ cho con đọc lại/);
  assert.equal(progress.stories.length, 0);
});

test('student profile page renders story progress section', () => {
  const reviewPage = readFileSync('src/pages/read2lead/review.astro', 'utf-8');
  assert.match(reviewPage, /Các truyện con đã học/);
  assert.match(reviewPage, /renderStoryProgress/);
  assert.match(reviewPage, /Cho con làm lại/);
  assert.doesNotMatch(reviewPage, /Rừng kỳ diệu/);
});

test('legacy library route redirects to student profile', () => {
  const libraryPage = readFileSync('src/pages/read2lead/library.astro', 'utf-8');
  assert.match(libraryPage, /read2lead\/review/);
});

test('landing page no longer exposes separate library entry', () => {
  const landingPage = readFileSync('src/pages/read2lead.astro', 'utf-8');
  assert.doesNotMatch(landingPage, /Thư viện truyện/);
  assert.match(landingPage, /các truyện con đã học/);
});

test('progress API includes story_progress payload', () => {
  const source = readFileSync('functions/api/read2lead-progress.js', 'utf-8');
  assert.match(source, /story_progress: buildStoryProgressForProfile/);
});

test('legacy library API redirects browsers to profile', async () => {
  const api = await import('../functions/api/read2lead-library.js');
  assert.equal(typeof api.onRequestGet, 'function');
});
