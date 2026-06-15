import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLearningMetricEntry,
  calculateAttentionScore,
  normalizeLearningMetrics,
  summarizeLearningMetrics,
} from '../src/lib/learning-metrics.ts';

test('attention score merges active event windows', () => {
  const score = calculateAttentionScore({
    startedAt: '2026-06-16T00:00:00.000Z',
    endedAt: '2026-06-16T00:01:00.000Z',
    events: [
      { type: 'audio', ts: '2026-06-16T00:00:00.000Z' },
      { type: 'speak', ts: '2026-06-16T00:00:05.000Z' },
      { type: 'audio', ts: '2026-06-16T00:00:40.000Z' },
    ],
  });
  assert.equal(score, 42);
});

test('attention score is zero for missing or invalid timing', () => {
  assert.equal(calculateAttentionScore({ startedAt: '', endedAt: '', events: [] }), 0);
  assert.equal(calculateAttentionScore({ startedAt: '2026-06-16T00:01:00.000Z', endedAt: '2026-06-16T00:00:00.000Z', events: [] }), 0);
});

test('buildLearningMetricEntry stores additive pack metric shape', () => {
  const entry = buildLearningMetricEntry({
    packId: 'pack-1',
    startedAt: '2026-06-16T00:00:00.000Z',
    passedAt: '2026-06-16T00:02:04.000Z',
    scorePercent: 78,
    retryCount: 2,
    attentionScore: 87,
  });
  assert.equal(entry.pack_id, 'pack-1');
  assert.equal(entry.score, 0.78);
  assert.equal(entry.retry_count, 2);
  assert.equal(entry.time_to_pass_ms, 124000);
  assert.equal(entry.suspect, false);
});

test('summary uses only the rolling 7-day window', () => {
  const summary = summarizeLearningMetrics([
    buildLearningMetricEntry({ packId: 'old', startedAt: '2026-06-01T00:00:00.000Z', passedAt: '2026-06-01T00:02:00.000Z', scorePercent: 90, retryCount: 0, attentionScore: 100 }),
    buildLearningMetricEntry({ packId: 'a', startedAt: '2026-06-15T00:00:00.000Z', passedAt: '2026-06-15T00:02:00.000Z', scorePercent: 90, retryCount: 0, attentionScore: 80 }),
    buildLearningMetricEntry({ packId: 'b', startedAt: '2026-06-16T00:00:00.000Z', passedAt: '2026-06-16T00:02:00.000Z', scorePercent: 70, retryCount: 2, attentionScore: 60 }),
  ], '2026-06-16T12:00:00.000Z');
  assert.equal(summary.first_try_pass_rate, 0.5);
  assert.equal(summary.avg_retry_count, 1);
  assert.equal(summary.avg_attention_score, 70);
});

test('normalizeLearningMetrics defaults old records safely', () => {
  const metrics = normalizeLearningMetrics(null, '2026-06-16T00:00:00.000Z');
  assert.deepEqual(metrics.packs_history, []);
  assert.equal(metrics['7day_summary'].first_try_pass_rate, 0);
  assert.equal(metrics['7day_summary'].avg_attention_score, 0);
});

test('normalizeLearningMetrics drops malformed entries and caps history', () => {
  const metrics = normalizeLearningMetrics({
    packs_history: [
      { pack_id: '', attention_score: 90 },
      ...Array.from({ length: 55 }, (_, index) => ({ pack_id: `p${index}`, attention_score: index })),
    ],
  });
  assert.equal(metrics.packs_history.length, 50);
  assert.equal(metrics.packs_history[0].pack_id, 'p0');
});
