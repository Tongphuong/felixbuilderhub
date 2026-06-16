import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEVEL_RESET_VERSION,
  appendLearningMetric,
  applyPackCompletion,
  buildLearningMetricEntry,
  isSuspectLearningPack,
  normalizeProgressState,
  publicProgressState,
} from '../functions/api/_read2lead-v2-state.js';

function baseState() {
  return normalizeProgressState({
    schema_version: 2,
    level_reset_version: LEVEL_RESET_VERSION,
    current_level: 'L1',
    initial_level: 'L1',
    unlocked_levels: ['L1'],
    completed_packs: 0,
    completed_pack_ids: [],
    level_progress: { L1: 0 },
    coins: 0,
    xp_in_level: 0,
    total_xp: 0,
    pack_history: [],
  }, { accessCode: 'R2L-METRIC-1', nowIso: '2026-06-16T00:00:00.000Z' });
}

test('suspect detection follows spec threshold', () => {
  assert.equal(isSuspectLearningPack({ timeToPassMs: 29999, scorePercent: 50 }), true);
  assert.equal(isSuspectLearningPack({ timeToPassMs: 30000, scorePercent: 50 }), false);
  assert.equal(isSuspectLearningPack({ timeToPassMs: 10000, scorePercent: 49 }), false);
});

test('learning metric entry flags fast passing pack', () => {
  const entry = buildLearningMetricEntry({
    packId: 'pack-fast',
    startedAt: '2026-06-16T00:00:00.000Z',
    passedAt: '2026-06-16T00:00:20.000Z',
    scorePercent: 80,
    retryCount: 0,
    attentionScore: 15,
  });
  assert.equal(entry.suspect, true);
  assert.equal(entry.time_to_pass_ms, 20000);
});

test('appendLearningMetric updates 7-day summary without schema bump', () => {
  const metrics = appendLearningMetric(null, buildLearningMetricEntry({
    packId: 'pack-1',
    startedAt: '2026-06-16T00:00:00.000Z',
    passedAt: '2026-06-16T00:02:00.000Z',
    scorePercent: 80,
    retryCount: 0,
    attentionScore: 75,
  }), '2026-06-16T00:02:00.000Z');
  assert.equal(metrics.packs_history.length, 1);
  assert.equal(metrics['7day_summary'].first_try_pass_rate, 1);
  assert.equal(metrics['7day_summary'].avg_attention_score, 75);
});

test('applyPackCompletion persists learning metrics additively', () => {
  const metric = buildLearningMetricEntry({
    packId: 'pack-1',
    startedAt: '2026-06-16T00:00:00.000Z',
    passedAt: '2026-06-16T00:02:00.000Z',
    scorePercent: 82,
    retryCount: 1,
    attentionScore: 64,
  });
  const result = applyPackCompletion(baseState(), {
    packId: 'pack-1',
    completedAt: '2026-06-16T00:02:00.000Z',
    rewardsEarned: { coins: 10, xp: 20 },
    activityResults: [],
    scorePercent: 82,
    learningMetric: metric,
  });
  assert.equal(result.state.schema_version, 2);
  assert.equal(result.state.learning_metrics.packs_history[0].pack_id, 'pack-1');
  assert.equal(result.state.learning_metrics['7day_summary'].avg_retry_count, 1);
});

test('public progress exposes normalized learning metrics to parent UI', () => {
  const publicState = publicProgressState(baseState());
  assert.equal(publicState.schema_version, 2);
  assert.deepEqual(publicState.learning_metrics.packs_history, []);
  assert.equal(publicState.learning_metrics['7day_summary'].suspect_count, 0);
});
