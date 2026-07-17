import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreTranscript as clientScoreTranscript,
  lightWords,
  PASS_PERCENT,
} from '../src/lib/shadowing-score.mjs';

import { scoreTranscript as serverScoreTranscript } from '../functions/api/read2lead-speaking-check.js';

// ---------------------------------------------------------------------------
// Parity: the client port and the live server module must compute IDENTICAL
// scoreTranscript output for the same inputs, field for field, except the
// server-only Vietnamese feedback_vi copy (both top-level and per-word) that
// the port intentionally drops -- see shadowing-score.mjs's header comment.
// ---------------------------------------------------------------------------

function omitFeedbackVi(result) {
  const { feedback_vi, word_feedback, ...rest } = result;
  return {
    ...rest,
    word_feedback: word_feedback.map(({ feedback_vi: _fvi, ...w }) => w),
  };
}

// ~30 fixture pairs spanning the categories called out in the packet: exact
// match, close matches, SKIP_WORDS-only diffs, punctuation/case, empty
// transcript, extra/missing words, one-word sentences, accent near-misses,
// long sentences, plus a few extra edge cases (digits, unicode, whitespace).
// No fixture here needs hand-verified similarity math -- both
// implementations run the exact same ported algorithm on the exact same
// input, so any input is a valid parity fixture; math only needs verifying
// for the boundary/lightWords tests below, which assert specific tiers.
const FIXTURES = [
  ['exact_simple', 'cat', 'cat'],
  ['exact_multi_word', 'The cat sat on the mat', 'The cat sat on the mat'],
  ['close_pack_park', 'pack', 'park'],
  ['skip_words_only_diff', 'The cat is on the mat', 'Cat on mat'],
  ['punctuation_and_case', 'Hello, World!', 'hello world'],
  ['empty_transcript', 'The cat sat', ''],
  ['extra_words_in_transcript', 'I like cats', 'I really like big cats a lot'],
  ['missing_words_in_transcript', 'The dog ran fast today', 'The dog ran'],
  ['one_word_exact', 'Dog', 'Dog'],
  ['one_word_mismatch', 'Dog', 'Cat'],
  ['one_word_close', 'cat', 'cot'],
  ['vietnamese_accent_footbal_football', 'I love football', 'I love footbal'],
  ['vietnamese_accent_becase_because', 'This happened becase of rain', 'This happened because of rain'],
  ['long_sentence_mixed', 'The quick brown fox jumps over the lazy dog while the children watch and laugh',
    'The quick brown fox jumped over a lazy dog while the children watched and laughed'],
  ['all_words_missed', 'The dog ran fast', 'xyz qwe rst uvw'],
  ['digits_in_expected_stripped', 'I have 3 dogs', 'I have three dogs'],
  ['repeated_word_transcript', 'the cat and the cat', 'the cat and the cat'],
  ['mixed_case_transcript_only', 'APPLE BANANA', 'apple banana'],
  ['extra_whitespace', '  cat   dog  ', '  cat   dog '],
  ['only_skip_words_expected', 'the a an', 'the a an'],
  ['contractions_and_punctuation', "It's a big dog", "It's a big, dog!"],
  ['numbers_and_symbols_transcript', 'call me now', 'call me now #1!!'],
  ['transcript_longer_than_expected', 'good morning', 'good morning everyone how are you today'],
  ['expected_longer_than_transcript', 'good morning everyone how are you today', 'good morning'],
  ['near_miss_multiple_words', 'apple orange banana pack', 'aple orage banaba sock'],
  ['exact_then_close_then_missed', 'happy house guitar', 'happy hose xyz'],
  ['unicode_accented_characters', 'café au lait', 'cafe au lait'],
  ['tabs_and_newlines_whitespace', 'cat\tdog\nbird', 'cat dog bird'],
  ['single_letter_words', 'a b c', 'a b c'],
  ['very_long_sentence', 'Once upon a time there was a small village near a quiet river where children played every single day',
    'Once upon a time there was a small village near a quiet river where children play every single day'],
];

test('parity: client scoreTranscript matches live server scoreTranscript on all fixtures', () => {
  for (const [name, expectedText, transcript] of FIXTURES) {
    const clientResult = clientScoreTranscript(expectedText, transcript);
    const serverResult = serverScoreTranscript(expectedText, transcript);
    assert.deepEqual(
      omitFeedbackVi(clientResult),
      omitFeedbackVi(serverResult),
      `fixture "${name}" diverged between client port and server module`,
    );
  }
});

test('parity: fixture count is at least ~30 as specced', () => {
  assert.ok(FIXTURES.length >= 28, `expected ~30 fixtures, found ${FIXTURES.length}`);
});

// ---------------------------------------------------------------------------
// Boundary: PASS_PERCENT = 50. A fixture engineered to score exactly 50
// passes (>= PASS_PERCENT); one at 49 fails. Both use 100 identical
// SKIP_WORDS-free expected words ("cat" x100) so the score is pure
// exact_count/total_count*100 with no rounding ambiguity: 50/100*100=50,
// 49/100*100=49.
// ---------------------------------------------------------------------------

test('boundary: score of exactly 50 passes PASS_PERCENT', () => {
  const expectedText = Array(100).fill('cat').join(' ');
  const transcript = Array(50).fill('cat').join(' ');
  const result = clientScoreTranscript(expectedText, transcript);
  assert.equal(result.score_percent, 50);
  assert.ok(result.score_percent >= PASS_PERCENT);
});

test('boundary: score of 49 fails PASS_PERCENT', () => {
  const expectedText = Array(100).fill('cat').join(' ');
  const transcript = Array(49).fill('cat').join(' ');
  const result = clientScoreTranscript(expectedText, transcript);
  assert.equal(result.score_percent, 49);
  assert.ok(result.score_percent < PASS_PERCENT);
});

// ---------------------------------------------------------------------------
// lightWords: interim word-lighting must progress pending -> close -> exact
// and never regress a settled word within one call sequence given the same
// growing interim prefix.
// ---------------------------------------------------------------------------

const TIER_RANK = { pending: 0, close: 1, exact: 2 };

function statuses(expectedText, interim) {
  return lightWords(expectedText, interim).map((w) => w.status);
}

test('lightWords: single content word progresses pending -> close -> exact', () => {
  // "cat" vs "cot": distance 1 / maxLen 3 -> similarity 0.667, in [0.5, 0.75)
  // -> 'close'. Once "cat" itself appears in the interim transcript, the
  // exact-tier match wins.
  const seq = ['', 'cot', 'cot cat'];
  const results = seq.map((interim) => statuses('cat', interim));
  assert.deepEqual(results, [['pending'], ['close'], ['exact']]);
});

test('lightWords: growing interim transcript never regresses a settled word', () => {
  const expected = 'The cat sat on the mat';
  const seq = ['', 'the', 'the cat', 'the cat sat', 'the cat sat on the mat'];
  let prevRanks = null;
  for (const interim of seq) {
    const ranks = statuses(expected, interim).map((s) => TIER_RANK[s]);
    if (prevRanks) {
      ranks.forEach((rank, idx) => {
        assert.ok(rank >= prevRanks[idx], `word ${idx} regressed from rank ${prevRanks[idx]} to ${rank} at interim "${interim}"`);
      });
    }
    prevRanks = ranks;
  }
  // and it does actually reach fully lit by the end
  assert.deepEqual(statuses(expected, 'the cat sat on the mat'),
    ['exact', 'exact', 'exact', 'exact', 'exact', 'exact']);
});

test('lightWords: returns one entry per expected word, SKIP_WORDS included', () => {
  const result = lightWords('The cat sat on the mat', '');
  assert.equal(result.length, 6);
  assert.deepEqual(result.map((w) => w.raw), ['The', 'cat', 'sat', 'on', 'the', 'mat']);
  assert.ok(result.every((w) => ['exact', 'close', 'pending'].includes(w.status)));
});

test('lightWords: empty interim transcript leaves every word pending', () => {
  const result = lightWords('one two three', '');
  assert.deepEqual(result.map((w) => w.status), ['pending', 'pending', 'pending']);
});

test('lightWords: content word match does not consume the same transcript word twice', () => {
  // Two distinct expected content words, only one matching transcript word
  // available -- the second one must stay pending, not double-count.
  const result = lightWords('dog cat', 'dog');
  assert.deepEqual(result.map((w) => w.status), ['exact', 'pending']);
});
