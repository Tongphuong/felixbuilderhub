import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessBookHealth,
  normalizeForReconstruction,
} from '../src/lib/read2lead-book-health.mjs';
import { validateBookFlowSubmission } from '../src/lib/read2lead-book-flow.mjs';
import {
  makeStoredBookPack,
  makeBrokenBookPack,
  makeBookReaderState,
} from './helpers/book-pack-fixture.mjs';

function codesOf(result) {
  return result.reasons.map((reason) => reason.code);
}

test('a well-formed book pack passes with no reasons', () => {
  const result = assessBookHealth(makeStoredBookPack('book_1'));
  assert.equal(result.ok, true, JSON.stringify(result.reasons));
  assert.equal(result.hardOk, true);
  assert.deepEqual(result.reasons, []);
});

test('a book with empty sentences is still finishable (read_aloud-only book)', () => {
  const pack = makeStoredBookPack('book_1');
  pack.story.sentences = [];
  pack.guided_listening = [];
  const result = assessBookHealth(pack);
  assert.equal(result.ok, true, JSON.stringify(result.reasons));
});

test('each HARD defect is caught and marks the pack unfinishable', () => {
  const cases = [
    ['order_unreconstructable', 'order_unreconstructable'],
    ['order_bad_permutation', 'order_bad_permutation'],
    ['count_mismatch', 'audio_image_mismatch'],
    ['page_audio_empty', 'page_audio_empty'],
    ['sentence_out_of_range', 'sentence_page_out_of_range'],
    ['no_read_aloud', 'no_read_aloud'],
  ];
  for (const [kind, expectedCode] of cases) {
    const result = assessBookHealth(makeBrokenBookPack(kind));
    assert.equal(result.ok, false, `${kind} should fail`);
    assert.equal(result.hardOk, false, `${kind} should be a HARD failure`);
    assert.ok(codesOf(result).includes(expectedCode), `${kind} -> expected code ${expectedCode}, got ${codesOf(result)}`);
  }
});

test('SOFT text-hygiene defects fail ok but keep hardOk (finishable, deprioritized)', () => {
  for (const [kind, expectedCode] of [['html_entity', 'html_artifact'], ['doubled_word', 'doubled_word']]) {
    const result = assessBookHealth(makeBrokenBookPack(kind));
    assert.equal(result.ok, false, `${kind} should not be fully clean`);
    assert.equal(result.hardOk, true, `${kind} must remain finishable`);
    assert.ok(codesOf(result).includes(expectedCode), `${kind} -> ${codesOf(result)}`);
    assert.ok(result.reasons.every((reason) => reason.level === 'soft'), 'only soft reasons expected');
  }
});

test('expectedSlug enforces the pack is served under the right key', () => {
  const pack = makeStoredBookPack('book_9');
  // No expectedSlug -> only checks non-empty slug, passes.
  assert.equal(assessBookHealth(pack).ok, true);
  // Mismatched expectedSlug -> hard failure.
  const mismatched = assessBookHealth(pack, { expectedSlug: 'book_1' });
  assert.equal(mismatched.hardOk, false);
  assert.ok(codesOf(mismatched).includes('slug_mismatch'));
  // Matching expectedSlug -> passes.
  assert.equal(assessBookHealth(pack, { expectedSlug: 'book_9' }).ok, true);
});

test('a null / garbage pack fails hard rather than throwing', () => {
  assert.equal(assessBookHealth(null).hardOk, false);
  assert.equal(assessBookHealth({}).hardOk, false);
});

test('normalizeForReconstruction mirrors the runtime normalizeOrderSentence', () => {
  // Case, trailing punctuation, and collapsed whitespace are all normalized —
  // matching lesson.astro isOrderAnswerCorrect (the authoritative runtime check).
  assert.equal(normalizeForReconstruction('The Cat Sat.'), normalizeForReconstruction('the  cat sat'));
  assert.equal(normalizeForReconstruction('Hello!'), 'hello');
  assert.equal(normalizeForReconstruction('  spaced   out  '), 'spaced out');
  assert.notEqual(normalizeForReconstruction('the cat sat'), normalizeForReconstruction('the cat sat down'));
});

// Pinned contract, book flow v3 (R2L-PAGE-LOOP): "gate pass" must keep meaning
// "validateBookFlowSubmission pass" now that assignment-time health mirrors
// the v3 rules (BOOK_QUESTION_LIMIT_V3, buildBookPageReads). The same pack
// object doubles as both the health-gate input and the validator's
// lessonContext, exactly like the v2 parity pin in
// read2lead-book-payload-completion.test.mjs.
test('a pack that passes the health gate is runtime-finishable under version 3', () => {
  const pack = makeStoredBookPack('book_1', { pages: 3, sentencesPerPage: 2, questionsPerPage: 2 });
  const health = assessBookHealth(pack);
  assert.equal(health.ok, true, JSON.stringify(health.reasons));
  const reader = makeBookReaderState(pack, { version: 3 });
  const result = validateBookFlowSubmission(reader, pack, { version: 3 });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test('a legitimately hard but correct order sentence still passes (no false positive)', () => {
  const pack = makeStoredBookPack('book_1');
  pack.activities.push({
    type: 'listen_and_order',
    items: [{
      scrambled_tokens: ['Persephone', 'wandered', 'through', 'the', 'labyrinth'],
      correct_order_indices: [0, 1, 2, 3, 4],
      original_sentence: 'Persephone wandered through the labyrinth.',
    }],
  });
  const result = assessBookHealth(pack);
  assert.equal(result.ok, true, JSON.stringify(result.reasons));
});
