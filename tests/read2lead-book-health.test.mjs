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
    ['non_english_page', 'non_english_page'],
    ['non_latin_script', 'non_latin_script'],
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

// R2L-PHUC-7TZV incident (2026-08-09): a Vietnamese kid was assigned a page of
// romanized Hindi (book_178669 p15, scored 14%, unpassable) and a Devanagari
// page (book_158997 p2) would suffer the same fate via a different mechanism —
// normalizeWord in read2lead-speaking-check.js strips everything outside
// [a-z], so a non-Latin page scores 0/0 "từ đúng" no matter what the child
// reads aloud. These two HARD checks close both holes. Both run over
// paragraphs_en only (NOT story.sentences[], which is where nearly all the
// false-positive noise lived when validated against the full 394-book,
// 11,253-unit live corpus).
test('non-English / non-Latin detection: known-BAD pages are caught', () => {
  const hindi = assessBookHealth(makeBrokenBookPack('non_english_page'));
  assert.equal(hindi.hardOk, false, JSON.stringify(hindi.reasons));
  assert.ok(codesOf(hindi).includes('non_english_page'), JSON.stringify(hindi.reasons));

  const devanagari = assessBookHealth(makeBrokenBookPack('non_latin_script'));
  assert.equal(devanagari.hardOk, false, JSON.stringify(devanagari.reasons));
  assert.ok(codesOf(devanagari).includes('non_latin_script'), JSON.stringify(devanagari.reasons));
});

// Added in review (2026-08-10, Buffet's independent review of cda9fa8): pins the Check A
// range-allowlist so a future "just widen the ceiling" change can never quietly swallow other
// scripts again — Cyrillic and CJK sit BELOW the Vietnamese Latin Extended Additional range
// (0x1E00-0x1EFF), so a naive single-ceiling fix for Vietnamese would have made these read as
// Latin and stopped flagging entirely.
test('non-Latin detection: Cyrillic and CJK scripts are still caught after the Vietnamese allowlist fix', () => {
  const cyrillicPack = makeStoredBookPack('book_cyrillic');
  cyrillicPack.story.paragraphs_en[0] =
    'Мама читает книгу интересную историю про котёнка который гуляет по саду каждый день.';
  const cyrillic = assessBookHealth(cyrillicPack);
  assert.equal(cyrillic.hardOk, false, JSON.stringify(cyrillic.reasons));
  assert.ok(codesOf(cyrillic).includes('non_latin_script'), JSON.stringify(cyrillic.reasons));

  const cjkPack = makeStoredBookPack('book_cjk');
  cjkPack.story.paragraphs_en[0] =
    '从前有一只小猫喜欢在花园里玩耍它每天都很开心地跑来跑去和它的朋友们一起玩耍。';
  const cjk = assessBookHealth(cjkPack);
  assert.equal(cjk.hardOk, false, JSON.stringify(cjk.reasons));
  assert.ok(codesOf(cjk).includes('non_latin_script'), JSON.stringify(cjk.reasons));
});

// Known-GOOD pages that must NOT trip either new reason code — these are the
// exact shapes that produced 31 false positives across 29 books under the
// packet author's FIRST (rejected) rule, or are named explicitly in the
// corrected packet as required non-flagging cases.
test('non-English / non-Latin detection: known-GOOD pages produce neither reason code', () => {
  const goodPages = [
    // 3. ordinary English story prose
    'The little rabbit hopped across the meadow, looking for her family before the sun went down.',
    // 4. short page under the 10-token floor
    'Vroom Vroom Vroom !! Vehicles. Vehicles Author Vihaan',
    // 5. contraction-heavy (also under the floor once split: i, d, like, one, more, banana, said, first, monkey)
    '"I\'d like one more banana", said first monkey .',
    // 6. onomatopoeia
    'Ta-dhump, ta-dhump, ta-dhump dhump dhumppp!',
    // 7. real English that fooled the first (rejected) rule
    'Things make bigger things. Bigger things make huge ones. Huge things make ginormous ones.',
    // 8. accented Latin must not trip Check A (non_latin_script)
    "In Mexico, the sun is not over Yaretzi's head anymore. Madhav calls his friend señor Muñoz.",
    // 9. review addition (2026-08-10) — the Vietnamese false positive Buffet found: precomposed
    // Vietnamese tone marks (Latin Extended Additional, U+1E00-U+1EFF) were reading as
    // "non-Latin" under the original single-ceiling check and would have auto-quarantined a
    // perfectly good page. Our own audience's language must never trip this.
    'Nguyễn Thị Việt walked to school with her friend Diễm every morning before the sun rose high.',
    // 10. Vietnamese-heavy — a denser cluster of diacritic names, stress-testing the ratio
    // threshold itself (not just presence of one accented letter).
    'Nguyễn Thị Diễm Hương, Đặng Thị Mỹ Duyên, and Trịnh Văn Đức walked to school together with '
      + 'their friend Phương every single morning before the sun rose over the village.',
    // 11. vocabulary/fruit list — 11 tokens, clears the ENGLISH_TOKEN_MIN=20 floor untouched;
    // no function word among them, would have false-flagged at the old floor of 10.
    'Apple. Banana. Cherry. Durian. Eggplant. Fig. Grape. Honeydew. Ivy gourd. Jackfruit.',
    // 12. name roster (Indian) — 10 tokens, same floor-clears-it shape.
    'Arjuna, Bhima, Nakula, Sahadeva, Yudhishthira, Draupadi, Kunti, Karna, Krishna, Duryodhana.',
    // 13. name roster (Vietnamese surnames) — 10 tokens, plain ASCII (no diacritics), same shape.
    'Nguyen, Tran, Le, Pham, Hoang, Vu, Vo, Dang, Bui, Dao.',
    // 14. counting page — 10 tokens; also now literally in ENGLISH_WORD_SET, belt and suspenders.
    'Four. Five. Six. Seven. Eight. Nine. Ten. Eleven. Twelve. Thirteen.',
  ];
  for (const text of goodPages) {
    const pack = makeStoredBookPack('book_good');
    pack.story.paragraphs_en[0] = text;
    const result = assessBookHealth(pack);
    assert.ok(!codesOf(result).includes('non_english_page'), `should not flag non_english_page: "${text}" -> ${codesOf(result)}`);
    assert.ok(!codesOf(result).includes('non_latin_script'), `should not flag non_latin_script: "${text}" -> ${codesOf(result)}`);
  }
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
