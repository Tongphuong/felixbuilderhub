import test from 'node:test';
import assert from 'node:assert/strict';

import {
  QUEST_DEFS,
  QUEST_IDS,
  pickDailyQuestIds,
  questCompleted,
  questReward,
  questDeltasForEvent,
} from '../functions/api/_read2lead-quests.js';

const REQUIRED_KEYS = ['label_vi', 'target', 'reward', 'trigger'];

test('QUEST_DEFS has exactly 8 quests with valid shape', () => {
  assert.equal(QUEST_IDS.length, 8);
  for (const id of QUEST_IDS) {
    const def = QUEST_DEFS[id];
    assert.ok(def, `missing def for ${id}`);
    for (const key of REQUIRED_KEYS) {
      assert.ok(key in def, `${id} missing ${key}`);
    }
    assert.equal(typeof def.label_vi, 'string');
    assert.ok(def.label_vi.length > 0);
    assert.equal(typeof def.target, 'number');
    assert.ok(def.target >= 1);
    assert.equal(typeof def.reward.coins, 'number');
    assert.equal(typeof def.reward.rp, 'number');
    assert.equal(typeof def.trigger, 'string');
  }
});

test('pickDailyQuestIds is deterministic for same (date, code)', () => {
  const a = pickDailyQuestIds('2026-06-13', 'R2L-ABC123');
  const b = pickDailyQuestIds('2026-06-13', 'R2L-ABC123');
  assert.deepEqual(a, b);
});

test('pickDailyQuestIds returns 3 unique ids', () => {
  for (let day = 1; day <= 100; day++) {
    const dateKey = `2026-06-${String(day).padStart(2, '0')}`;
    const ids = pickDailyQuestIds(dateKey, 'R2L-TEST');
    assert.equal(ids.length, 3);
    assert.equal(new Set(ids).size, 3);
    for (const id of ids) {
      assert.ok(QUEST_DEFS[id], `unknown quest id ${id}`);
    }
  }
});

test('pickDailyQuestIds varies across dates/codes', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const dateKey = `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`;
    const code = `R2L-CODE${i}`;
    const triple = pickDailyQuestIds(dateKey, code).join(',');
    seen.add(triple);
  }
  assert.ok(seen.size > 30, `expected >30 distinct triples, got ${seen.size}`);
});

test('pickDailyQuestIds treats empty code as anon', () => {
  const withEmpty = pickDailyQuestIds('2026-06-13', '');
  const withAnon = pickDailyQuestIds('2026-06-13', 'anon');
  assert.deepEqual(withEmpty, withAnon);
});

test('questCompleted returns true at target', () => {
  assert.equal(questCompleted('q1', 0), false);
  assert.equal(questCompleted('q1', 1), true);
  assert.equal(questCompleted('q6', 1), false);
  assert.equal(questCompleted('q6', 2), true);
  assert.equal(questCompleted('q99', 99), false);
});

test('questReward returns shallow copy (cannot mutate def)', () => {
  const reward = questReward('q2');
  assert.deepEqual(reward, { coins: 15, rp: 1 });
  reward.coins = 999;
  reward.rp = 999;
  assert.deepEqual(QUEST_DEFS.q2.reward, { coins: 15, rp: 1 });
});

test('questReward returns zeros for unknown quest', () => {
  assert.deepEqual(questReward('q99'), { coins: 0, rp: 0 });
});

test('questDeltasForEvent pack_passed increments q1+q6 if active', () => {
  const deltas = questDeltasForEvent('pack_passed', { score: 60, has_speak: true }, ['q1', 'q6', 'q3']);
  assert.deepEqual(deltas, [
    { questId: 'q1', delta: 1 },
    { questId: 'q6', delta: 1 },
  ]);
});

test('questDeltasForEvent pack_passed_high_score increments q2 only if active', () => {
  const deltas = questDeltasForEvent('pack_passed_high_score', { score: 85 }, ['q2', 'q1']);
  assert.deepEqual(deltas, [{ questId: 'q2', delta: 1 }]);
});

test('questDeltasForEvent speak_completed increments q3 when active', () => {
  const deltas = questDeltasForEvent('speak_completed', {}, ['q3', 'q1']);
  assert.deepEqual(deltas, [{ questId: 'q3', delta: 1 }]);
});

test('questDeltasForEvent inactive quest returns no delta', () => {
  const deltas = questDeltasForEvent('pack_passed', { score: 90 }, ['q2', 'q3']);
  assert.deepEqual(deltas, []);
});

test('questDeltasForEvent unknown event returns empty', () => {
  assert.deepEqual(questDeltasForEvent('not_a_real_event', {}, ['q1', 'q2', 'q3']), []);
});

test('questDeltasForEvent handles missing activeIds gracefully', () => {
  assert.deepEqual(questDeltasForEvent('pack_passed', {}, null), []);
  assert.deepEqual(questDeltasForEvent('', {}, ['q1']), []);
});
