import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLibraryPayload,
  CHAPTER_THEME,
  normalizeReviewEntries,
  PACKS_PER_CHAPTER,
  topicEmoji,
} from '../functions/api/_read2lead-library.js';

function makeReviewHistory(count) {
  return Array.from({ length: count }, (_, index) => ({
    pack_id: `pack-${index + 1}`,
    status: 'reviewed_pass_web_v2',
    title: `Story ${index + 1}`,
    topic: index % 2 === 0 ? 'School' : 'Animals',
    level: 'L1',
    reviewed_at: `2026-06-0${(index % 7) + 1}T10:00:00.000Z`,
  })).reverse();
}

test('topicEmoji maps known topics and falls back safely', () => {
  assert.equal(topicEmoji('School Day'), '🏫');
  assert.equal(topicEmoji('Animals and pets'), '🐾');
  assert.match(topicEmoji('Unknown topic'), /[\u{1F300}-\u{1FAFF}]/u);
});

test('normalizeReviewEntries keeps only reviewed packs in chronological order', () => {
  const entries = normalizeReviewEntries([
    { pack_id: 'b', status: 'reviewed_pass_web_v2', title: 'Second', topic: 'School' },
    { pack_id: 'a', status: 'generation_in_progress', title: 'Skip me' },
    { pack_id: 'a', status: 'reviewed_pass_web_v2', title: 'First', topic: 'Animals' },
  ]);
  assert.deepEqual(entries.map((entry) => entry.pack_id), ['a', 'b']);
  assert.equal(entries[0].emoji, '🐾');
});

test('buildLibraryPayload groups completed packs into chapters of five', () => {
  const payload = buildLibraryPayload({
    studentName: 'Hoàng',
    reviewHistory: makeReviewHistory(7),
  });

  assert.equal(payload.student_name, 'Hoàng');
  assert.equal(payload.total_completed, 7);
  assert.equal(payload.chapters.length, 2);
  assert.equal(payload.chapters[0].completed_count, 5);
  assert.equal(payload.chapters[1].completed_count, 2);
  assert.equal(payload.chapters[0].title, CHAPTER_THEME);
  assert.match(payload.progress_message, /Còn 3 bài để mở chương "Rừng kỳ diệu"/);
});

test('buildLibraryPayload marks next slot and locked silhouettes', () => {
  const payload = buildLibraryPayload({ reviewHistory: makeReviewHistory(3) });
  const chapter = payload.chapters[0];
  const statuses = chapter.slots.map((slot) => slot.status);

  assert.deepEqual(statuses, ['completed', 'completed', 'completed', 'next', 'locked']);
  assert.equal(chapter.slots[3].title, '');
  assert.equal(chapter.slots[0].pack_id, 'pack-1');
});

test('buildLibraryPayload handles empty library with starter message', () => {
  const payload = buildLibraryPayload({ studentName: 'Bin' });
  assert.equal(payload.total_completed, 0);
  assert.equal(payload.chapters.length, 1);
  assert.equal(payload.chapters[0].slots.filter((slot) => slot.status === 'next').length, 1);
  assert.match(payload.progress_message, /Hoàn thành 5 bài đầu tiên/);
});

test('library page includes chapter theme copy', async () => {
  const page = await import('node:fs/promises').then((fs) =>
    fs.readFile('src/pages/read2lead/library.astro', 'utf-8'),
  );
  assert.match(page, /Rừng kỳ diệu/);
  assert.match(page, /read2lead-library/);
  assert.match(page, /Đọc lại/);
});

test('library endpoint file exports GET handler', async () => {
  const api = await import('../functions/api/read2lead-library.js');
  assert.equal(typeof api.onRequestGet, 'function');
});
