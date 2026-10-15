import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY_MISSION_VERSION, STORY_RECALL_DELAY_MS, storyRewardForScore } from '../src/lib/read2lead-story-mission.mjs';
import { assessStoryMission, completeStoryMission, completeStoryRecall, emptyStoryRewardLedger } from '../functions/lib/read2lead/story-assessment.mjs';

// Synthetic semantic IDs only: no publisher text, child data, or provider calls.
function fixture() {
  const manifest = {
    schemaVersion: STORY_MISSION_VERSION, storyId: 'synthetic-story', contentVersion: '1.0',
    tasks: [
      { id: 'clues', kind: 'understand', criteria: ['who', 'why', 'where', 'result'] },
      { id: 'retell', kind: 'retell', criteria: ['start', 'problem', 'action', 'end'] },
    ],
    recallTask: { id: 'remember', criteria: ['cause', 'result'] },
  };
  const attempt = { storyId: manifest.storyId, contentVersion: manifest.contentVersion, readComplete: true,
    answers: manifest.tasks.map((task) => ({ taskId: task.id, responseId: `response-${task.id}`,
      modality: 'spoken', reliability: 'confirmed', support: 'none', matchedCriteria: [...task.criteria] })) };
  const recall = { storyId: manifest.storyId, contentVersion: manifest.contentVersion,
    answer: { taskId: 'remember', responseId: 'response-later', modality: 'spoken', reliability: 'confirmed', support: 'none', matchedCriteria: ['cause', 'result'] } };
  return { manifest, attempt, recall };
}

test('large diamond tiers retain XP and enforce exact score boundaries', () => {
  for (const [score, grade, xp, diamonds] of [[49.99, null, 0, 0], [50, 'B', 10, 400], [69.99, 'B', 10, 400], [70, 'A', 20, 800], [84.99, 'A', 20, 800], [85, 'S', 20, 1000], [100, 'S', 20, 1000]]) {
    const actual = storyRewardForScore(score);
    assert.deepEqual([actual.grade, actual.xp, actual.diamonds], [grade, xp, diamonds]);
  }
  for (const bad of [NaN, Infinity, -1, 101, '85', null]) assert.throws(() => storyRewardForScore(bad));
});

test('full semantic evidence earns S; half in each domain earns B', () => {
  const { manifest, attempt } = fixture();
  assert.equal(assessStoryMission(manifest, attempt).reward.diamonds, 1000);
  attempt.answers.forEach((answer) => { answer.matchedCriteria = answer.matchedCriteria.slice(0, 2); });
  assert.equal(assessStoryMission(manifest, attempt).reward.diamonds, 400);
});

test('strong comprehension cannot compensate for missing retelling', () => {
  const { manifest, attempt } = fixture();
  attempt.answers[1].matchedCriteria = [];
  const result = assessStoryMission(manifest, attempt);
  assert.equal(result.scorePercent, 50);
  assert.equal(result.status, 'needs_practice');
  assert.equal(result.reward.diamonds, 0);
});

test('hints and picture support remain labelled without deducting earned diamonds', () => {
  const { manifest, attempt } = fixture();
  attempt.answers[1].support = 'picture';
  const result = assessStoryMission(manifest, attempt);
  assert.equal(result.assisted, true);
  assert.equal(result.spokenRetellingDemonstrated, true);
  assert.equal(result.independentSpokenRetelling, false);
  assert.equal(result.reward.diamonds, 1000);
});

test('accessible tap retelling earns story credit but never a spoken-retelling claim', () => {
  const { manifest, attempt } = fixture();
  attempt.answers[1].modality = 'tap';
  const result = assessStoryMission(manifest, attempt);
  assert.equal(result.status, 'complete');
  assert.equal(result.spokenRetellingDemonstrated, false);
  assert.equal(result.independentSpokenRetelling, false);
});

test('unclear speech requests technical retry, not a failing learning score', () => {
  const { manifest, attempt } = fixture();
  Object.assign(attempt.answers[0], { reliability: 'uncertain', matchedCriteria: [] });
  const result = assessStoryMission(manifest, attempt);
  assert.equal(result.status, 'retry_technical');
  assert.equal(result.scorePercent, undefined);
  assert.equal(result.reward.diamonds, 0);
});

test('copying a model answer does not establish understanding', () => {
  const { manifest, attempt } = fixture();
  attempt.answers.forEach((answer) => { answer.support = 'model'; });
  assert.equal(assessStoryMission(manifest, attempt).status, 'needs_practice');
});

test('reading and every task must be attempted before completion', () => {
  const { manifest, attempt } = fixture();
  attempt.readComplete = false;
  assert.equal(assessStoryMission(manifest, attempt).status, 'in_progress');
  attempt.readComplete = true;
  attempt.answers.pop();
  assert.equal(assessStoryMission(manifest, attempt).status, 'in_progress');
});

test('malformed, stale, duplicated or unrelated evidence fails closed', () => {
  const mutations = [
    ({ manifest }) => { manifest.schemaVersion = 'old'; },
    ({ manifest }) => { manifest.tasks[0].criteria = []; },
    ({ manifest }) => { manifest.tasks[0].criteria.push('who'); },
    ({ manifest }) => { manifest.tasks[0].kind = 'retell'; },
    ({ attempt }) => { attempt.contentVersion = '2.0'; },
    ({ attempt }) => { attempt.storyId = 'other-story'; },
    ({ attempt }) => { attempt.answers[0].matchedCriteria = ['invented-fact']; },
    ({ attempt }) => { attempt.answers[0].matchedCriteria = ['who', 'who']; },
    ({ attempt }) => { attempt.answers[1].taskId = 'clues'; },
    ({ attempt }) => { attempt.answers[1].responseId = 'response-clues'; },
    ({ attempt }) => { attempt.answers[0].modality = 'typing'; },
    ({ attempt }) => { attempt.answers[0].reliability = 'uncertain'; },
  ];
  for (const mutate of mutations) {
    const value = fixture(); mutate(value);
    assert.throws(() => assessStoryMission(value.manifest, value.attempt), TypeError);
  }
});

test('completion is immutable and cannot pay again after replay or content revision', () => {
  const { manifest, attempt } = fixture();
  const ledger = emptyStoryRewardLedger();
  const first = completeStoryMission(ledger, manifest, attempt, 1000);
  assert.equal(ledger.receipts.length, 0);
  assert.deepEqual(first.award, { xp: 20, diamonds: 1000 });
  const reloaded = JSON.parse(JSON.stringify(first.ledger));
  const duplicate = completeStoryMission(reloaded, manifest, attempt, 2000);
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.award, { xp: 0, diamonds: 0 });
  manifest.contentVersion = attempt.contentVersion = '1.1';
  assert.equal(completeStoryMission(reloaded, manifest, attempt, 3000).award.diamonds, 0);
});

test('incomplete attempts never reserve a reward receipt', () => {
  const { manifest, attempt } = fixture();
  attempt.answers[1].matchedCriteria = [];
  const result = completeStoryMission(emptyStoryRewardLedger(), manifest, attempt, 1000);
  assert.equal(result.ledger.receipts.length, 0);
  assert.equal(result.award.diamonds, 0);
});

test('recall needs prior completion and server delay; rewards once per story', () => {
  const { manifest, attempt, recall } = fixture();
  const empty = emptyStoryRewardLedger();
  assert.equal(completeStoryRecall(empty, manifest, recall, 1000).status, 'not_completed');
  const completed = completeStoryMission(empty, manifest, attempt, 1000).ledger;
  const due = 1000 + STORY_RECALL_DELAY_MS;
  assert.equal(completeStoryRecall(completed, manifest, recall, due - 1).status, 'not_due');
  const result = completeStoryRecall(completed, manifest, recall, due);
  assert.deepEqual(result.award, { xp: 0, diamonds: 200 });
  assert.equal(completed.receipts.length, 1);
  assert.equal(completeStoryRecall(result.ledger, manifest, recall, due + 1000).status, 'already_awarded');
  manifest.contentVersion = recall.contentVersion = '2.0';
  assert.equal(completeStoryRecall(result.ledger, manifest, recall, due + 2000).award.diamonds, 0);
});

test('recall is practice-only with source text or model; hint use is recorded', () => {
  const { manifest, attempt, recall } = fixture();
  const ledger = completeStoryMission(emptyStoryRewardLedger(), manifest, attempt, 0).ledger;
  for (const support of ['text', 'model']) {
    recall.answer.support = support;
    assert.equal(completeStoryRecall(ledger, manifest, recall, STORY_RECALL_DELAY_MS).status, 'practice_only');
  }
  recall.answer.support = 'hint';
  assert.equal(completeStoryRecall(ledger, manifest, recall, STORY_RECALL_DELAY_MS).assisted, true);
});

test('bad server times and corrupt ledgers are rejected', () => {
  const { manifest, attempt } = fixture();
  for (const now of [-1, NaN, '1000', Infinity]) {
    assert.throws(() => completeStoryMission(emptyStoryRewardLedger(), manifest, attempt, now));
  }
  const result = completeStoryMission(emptyStoryRewardLedger(), manifest, attempt, 0);
  result.ledger.receipts.push(result.receipt);
  assert.throws(() => completeStoryMission(result.ledger, manifest, attempt, 1));
});
