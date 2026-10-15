import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLearningReceipts, recordLearningReceipt, vietnamWeek, learningStarTotals } from '../functions/lib/read2lead/learning-stars.mjs';
import { normalizeProgressState, applyPackCompletion, applyPackPenalty } from '../functions/api/_read2lead-v2-state.js';

const at = '2026-10-14T03:00:00.000Z';
const options = { now: '2026-10-18T16:59:59.999Z', startsAt: '2026-10-11T17:00:00.000Z' };
const receipt = (source, kind, diamonds, time = at) => ({ source, kind, diamonds, at: time });

test('Vietnam week changes exactly at Monday midnight, including year boundaries', () => {
  assert.deepEqual(vietnamWeek('2026-10-11T16:59:59.999Z'), { start: '2026-10-04T17:00:00.000Z', end: '2026-10-11T17:00:00.000Z', timezone: 'Asia/Ho_Chi_Minh' });
  assert.equal(vietnamWeek('2026-10-11T17:00:00Z').start, options.startsAt);
  assert.equal(vietnamWeek('2027-01-01T00:00:00Z').start, '2026-12-27T17:00:00.000Z');
});

test('12-question completion and picture retelling count one story and 250 earned diamonds', () => {
  let rows = recordLearningReceipt([], receipt('story:sky', 'story_questions', 50));
  rows = recordLearningReceipt(rows, receipt('story:sky', 'story_retell', 200));
  const before = structuredClone(rows);
  rows = recordLearningReceipt(rows, receipt('story:sky', 'story_questions', 50, '2026-10-15T03:00:00Z'));
  rows = recordLearningReceipt(rows, receipt('story:sky', 'story_retell', 200, '2026-10-15T03:00:00Z'));
  assert.deepEqual(rows, before);
  assert.deepEqual(learningStarTotals(rows, options), { reading: 1, diamonds: 250 });
});

test('window is start-inclusive/end-exclusive, starts at release, and ignores future records', () => {
  const rows = [receipt('old', 'original_complete', 10, '2026-10-11T16:59:59.999Z'), receipt('start', 'original_complete', 20, options.startsAt), receipt('end', 'original_complete', 30, '2026-10-18T17:00:00Z')];
  assert.deepEqual(learningStarTotals(rows, options), { reading: 1, diamonds: 20 });
  assert.deepEqual(learningStarTotals(rows, { ...options, startsAt: at }), { reading: 0, diamonds: 0 });
  assert.deepEqual(learningStarTotals(rows, { now: options.now }), { reading: 0, diamonds: 0 });
  assert.deepEqual(learningStarTotals([receipt('future', 'original_complete', 40)], { ...options, now: '2026-10-13T03:00:00Z' }), { reading: 0, diamonds: 0 });
});

test('only learning receipts count; wallet, admin grants, gifts, refunds and prizes cannot enter totals', () => {
  const rows = ['wallet', 'admin_grant', 'gift_refund', 'leaderboard_prize', 'opened'].map(kind => receipt('fake', kind, 100000));
  rows.push(receipt('bad', 'original_complete', -10), receipt('fraction', 'original_complete', 0.5), receipt('invalid-date', 'original_complete', 10, 'bad'));
  assert.deepEqual(normalizeLearningReceipts(rows), []);
  assert.throws(() => recordLearningReceipt([], rows[0]), /invalid_learning_receipt/);
  assert.deepEqual(learningStarTotals(rows, options), { reading: 0, diamonds: 0 });
});

test('original retry credits only the remaining pages and grade, preserving the actual wallet', () => {
  const initial = normalizeProgressState({ diamonds: 700 }, { accessCode: 'R2L-SYNTHETIC-STARS', nowIso: at });
  const partial = applyPackPenalty(initial, { packId: 'p1', learningSource: 'book:bird', completedAt: at, diamondsEarned: 5 }).state;
  assert.deepEqual(learningStarTotals(partial.learning_receipts, options), { reading: 0, diamonds: 5 });
  const completed = applyPackCompletion(partial, { packId: 'p1', learningSource: 'book:bird', completedAt: at, rewardsEarned: { diamonds: 50, xp: 20 }, pageDiamonds: 15 }).state;
  assert.equal(completed.diamonds, 765);
  assert.deepEqual(learningStarTotals(completed.learning_receipts, options), { reading: 1, diamonds: 65 });
  const again = applyPackCompletion(completed, { packId: 'p1', learningSource: 'book:bird', completedAt: at, rewardsEarned: { diamonds: 50 } });
  assert.equal(again.already_counted, true); assert.equal(again.state.diamonds, 765);
  assert.deepEqual(again.state.learning_receipts, completed.learning_receipts);
});

test('normalization and gift spending preserve receipts without reconstructing earnings from balance', () => {
  const rows = [receipt('book:bird', 'original_complete', 60)];
  const state = normalizeProgressState({ diamonds: 5, learning_receipts: rows }, { accessCode: 'R2L-SYNTHETIC-STARS', nowIso: at });
  assert.deepEqual(state.learning_receipts, rows);
  assert.deepEqual(learningStarTotals(state.learning_receipts, options), { reading: 1, diamonds: 60 });
  assert.equal(state.diamonds, 5);
  assert.deepEqual(learningStarTotals(normalizeProgressState({ diamonds: 999999 }, { nowIso: at }).learning_receipts, options), { reading: 0, diamonds: 0 });
});

test('source deduplication survives many lessons and does not reset at the week boundary', () => {
  let rows = Array.from({ length: 150 }, (_, i) => receipt('book:' + i, 'original_complete', 10));
  rows = recordLearningReceipt(rows, receipt('book:0', 'original_complete', 10, '2026-10-20T03:00:00Z'));
  assert.equal(rows.length, 150);
  assert.deepEqual(learningStarTotals(rows, { ...options, now: '2026-10-21T03:00:00Z' }), { reading: 0, diamonds: 0 });
});
