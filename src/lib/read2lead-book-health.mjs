// Read2Lead book-pack health gate.
//
// Runs at ASSIGNMENT time (functions/api/generate-read2lead-pack.js) against a
// stored `book:<slug>` pack, right before it is handed to a student. It answers
// one question: "can a child actually FINISH this book?" — deterministically,
// with no dependency and no dictionary.
//
// Why this exists: the book pool is picked at random with no content check, and
// a pack with inconsistent internal data dead-ends the child (a page whose audio
// can never complete leaves "Trang tiếp →" disabled forever; a word-ordering
// item whose tokens can't rebuild the target sentence traps a W1 kid). The gate
// mirrors the exact runtime completion logic so "passes" provably means
// "finishable".
//
// Reasons are classified so the caller can apply the founder's "prefer clean,
// don't strand" policy:
//   - HARD  = genuinely unfinishable -> must skip this book.
//   - SOFT  = cosmetic (typos / HTML artifacts) -> deprioritize, but may serve
//             as a last resort rather than leaving the child with nothing.
import { selectBookQuestions, buildBookPageReads, BOOK_QUESTION_LIMIT_V3 } from './read2lead-book-flow.mjs';

// Mirror of lesson.astro `normalizeOrderSentence` (~7727) — the RUNTIME check
// `isOrderAnswerCorrect` uses, so it is authoritative for whether a child can
// finish a listen_and_order item. NOTE: this intentionally lowercases, matching
// the JS runtime. The Python generator check
// (read2lead_v0_codex/api/validator_v2.py `_normalize_for_reconstruction`, ~139)
// does NOT lowercase and is therefore stricter; the runtime is the one that
// determines finishability, so we mirror the runtime. Keep these two JS copies
// byte-identical.
export function normalizeForReconstruction(text) {
  let value = String(text || '').trim();
  if (value && /[.!?,;:]$/.test(value)) {
    value = value.slice(0, -1).trim();
  }
  return value.replace(/\s+/g, ' ').toLowerCase();
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// HARD — structural finishability. Supersedes validStoredBookPack: same count/
// parity rules but returns reason strings instead of a bare boolean, requires
// every image/audio/paragraph entry to be individually present, and — when the
// caller passes the slug the record was fetched under (options.expectedSlug) —
// re-asserts book_slug === expectedSlug so a pack can never be served under the
// wrong key. An empty page-audio URL is a real dead-end: bookPlayPageAudio never
// fires `ended`, `audio_completed` stays false, and the next-page button never
// enables.
function checkCountParity(pack, reasons, expectedSlug) {
  if (!pack || typeof pack !== 'object') {
    reasons.push({ level: 'hard', code: 'pack_missing', detail: 'pack is empty or not an object' });
    return;
  }
  if (pack.schema_version !== 2) {
    reasons.push({ level: 'hard', code: 'schema_version', detail: `schema_version ${pack.schema_version} != 2` });
  }
  if (!isNonEmptyString(pack.book_slug)) {
    reasons.push({ level: 'hard', code: 'slug_missing', detail: 'book_slug is missing' });
  } else if (isNonEmptyString(expectedSlug) && pack.book_slug !== expectedSlug) {
    reasons.push({ level: 'hard', code: 'slug_mismatch', detail: `book_slug "${pack.book_slug}" != expected "${expectedSlug}"` });
  }

  const images = Array.isArray(pack.book_images) ? pack.book_images : null;
  const audio = Array.isArray(pack.book_page_audio) ? pack.book_page_audio : null;
  const paragraphs = Array.isArray(pack.story?.paragraphs_en) ? pack.story.paragraphs_en : null;

  if (!images || images.length < 3) {
    reasons.push({ level: 'hard', code: 'images_missing', detail: `book_images has ${images ? images.length : 0} entries (need >= 3)` });
  }
  if (!audio) {
    reasons.push({ level: 'hard', code: 'audio_missing', detail: 'book_page_audio is not an array' });
  }
  if (!paragraphs) {
    reasons.push({ level: 'hard', code: 'paragraphs_missing', detail: 'story.paragraphs_en is not an array' });
  }
  if (images && audio && audio.length !== images.length) {
    reasons.push({ level: 'hard', code: 'audio_image_mismatch', detail: `book_page_audio (${audio.length}) != book_images (${images.length})` });
  }
  if (images && paragraphs && paragraphs.length !== images.length) {
    reasons.push({ level: 'hard', code: 'paragraph_image_mismatch', detail: `paragraphs_en (${paragraphs.length}) != book_images (${images.length})` });
  }

  (images || []).forEach((url, index) => {
    if (!isNonEmptyString(url)) reasons.push({ level: 'hard', code: 'image_url_empty', detail: `book_images[${index}] is empty` });
  });
  (audio || []).forEach((url, index) => {
    if (!isNonEmptyString(url)) reasons.push({ level: 'hard', code: 'page_audio_empty', detail: `book_page_audio[${index}] is empty` });
  });
  (paragraphs || []).forEach((text, index) => {
    if (!isNonEmptyString(text)) reasons.push({ level: 'hard', code: 'paragraph_empty', detail: `paragraphs_en[${index}] is empty` });
  });

  const activities = Array.isArray(pack.activities) ? pack.activities : [];
  if (activities.length < 1) {
    reasons.push({ level: 'hard', code: 'no_activities', detail: 'activities is empty' });
  }
  if (!activities.some((activity) => activity?.type === 'read_aloud')) {
    reasons.push({ level: 'hard', code: 'no_read_aloud', detail: 'no read_aloud activity present' });
  }
}

// HARD — listen_and_order finishability. Book packs are read_aloud-only today so
// this is usually dormant, but if such an activity ever ships in a book pack, a
// token set that cannot reconstruct original_sentence traps a W1 child. Mirrors
// the runtime isOrderAnswerCorrect (lesson.astro ~7744).
function checkListenAndOrder(pack, reasons) {
  const activities = Array.isArray(pack?.activities) ? pack.activities : [];
  activities.forEach((activity, activityIndex) => {
    if (activity?.type !== 'listen_and_order') return;
    const items = Array.isArray(activity.items) ? activity.items : [];
    items.forEach((item, itemIndex) => {
      const where = `activities[${activityIndex}].items[${itemIndex}]`;
      const tokens = Array.isArray(item?.scrambled_tokens) ? item.scrambled_tokens : null;
      const indices = Array.isArray(item?.correct_order_indices) ? item.correct_order_indices : null;
      if (!tokens || !tokens.length || !indices) {
        reasons.push({ level: 'hard', code: 'order_malformed', detail: `${where} is missing scrambled_tokens/correct_order_indices` });
        return;
      }
      // correct_order_indices must be a permutation of [0..n-1].
      const sorted = [...indices].map(Number).sort((a, b) => a - b);
      const isPermutation = sorted.length === tokens.length
        && sorted.every((value, i) => value === i);
      if (!isPermutation) {
        reasons.push({ level: 'hard', code: 'order_bad_permutation', detail: `${where} correct_order_indices is not a permutation of the tokens` });
        return;
      }
      const reconstructed = indices.map((tokenIdx) => tokens[tokenIdx]).join(' ');
      if (normalizeForReconstruction(reconstructed) !== normalizeForReconstruction(item.original_sentence || '')) {
        reasons.push({
          level: 'hard',
          code: 'order_unreconstructable',
          detail: `${where} reconstructed "${reconstructed}" != original "${item.original_sentence || ''}"`,
        });
      }
    });
  });
}

// HARD (narrow) — book-flow consistency. The client and server both derive pages
// from the SAME pure helpers (selectBookQuestions / buildBookPageReads), so a
// well-formed pack is self-consistent by construction; the real risk is data that
// makes those helpers throw or that references a non-existent page. Empty
// `sentences` is VALID (read_aloud books legitimately ship with no page-read
// flow), so we deliberately do NOT require >= 1 page read per page.
//
// Pinned to book flow v3 (R2L-PAGE-LOOP, 2026-07-11): assignment-time health
// must mirror what the NEW client requires (BOOK_QUESTION_LIMIT_V3, page reads
// instead of shadow chunks) so "gate pass" keeps meaning "validateBookFlowSubmission
// pass" under the rules actually in force. See specs/SPEC_R2L_PAGE_LOOP.md.
function checkBookFlow(pack, reasons) {
  const paragraphs = Array.isArray(pack?.story?.paragraphs_en) ? pack.story.paragraphs_en : [];
  const sentences = Array.isArray(pack?.story?.sentences) ? pack.story.sentences : [];

  sentences.forEach((sentence, index) => {
    const paragraphIndex = Number(sentence?.paragraph_index) || 0;
    if (paragraphIndex < 0 || paragraphIndex >= paragraphs.length) {
      reasons.push({ level: 'hard', code: 'sentence_page_out_of_range', detail: `story.sentences[${index}].paragraph_index ${paragraphIndex} has no page` });
    }
  });

  // Smoke-run the runtime derivations for every page: a throw here means the
  // client could never render a submittable page.
  try {
    for (let pageIndex = 0; pageIndex < paragraphs.length; pageIndex += 1) {
      selectBookQuestions(pack?.guided_listening, sentences, pageIndex, BOOK_QUESTION_LIMIT_V3);
      buildBookPageReads(sentences, pageIndex);
    }
  } catch (err) {
    reasons.push({ level: 'hard', code: 'book_flow_throws', detail: `page derivation failed: ${err?.message || err}` });
  }
}

// HARD — non-Latin script (Devanagari/Cyrillic/CJK/etc — the live example is
// book_158997 p2 at 15.0%, a known-bad book; the R2L-PHUC-7TZV incident
// itself, book_178669 p15, is romanized Hindi in Latin letters and is caught
// by Check B below, not this one). Needed because Check B cannot see a
// non-Latin page on its own: its tokenizer (`.split(/[^a-z]+/)`) strips
// everything outside [a-z] first, so a non-Latin page would otherwise
// silently fall under the 10-token floor and never get evaluated. This is a
// real kid-facing hazard on its own: `normalizeWord` in
// read2lead-speaking-check.js strips everything outside [a-z], so a
// non-Latin page scores 0/0 "từ đúng" and is unpassable no matter what the
// child reads.
//
// Threshold picked empirically against the full live corpus (394 books,
// 11,253 text units): exactly one page has ANY non-Latin content at all —
// book_158997 p2 at 15.0% (a known-bad book) — every other page is 0.0%, so
// >= 5% has an enormous margin either way it could have been drawn.
const NON_LATIN_LETTER_RATIO = 0.05;
const NON_LATIN_MIN_LETTERS = 10;
const LETTER_RE = /\p{L}/u;

// "Latin" is a RANGE ALLOWLIST, not a single ceiling — two disjoint blocks,
// deliberately not merged into one wide range:
//   - 0x0000-0x024F: Basic Latin + Latin-1 Supplement + Latin Extended-A/B
//     (plain ASCII plus é/ñ/ü-style accents).
//   - 0x1E00-0x1EFF: Latin Extended Additional, where every precomposed
//     Vietnamese tone-marked vowel lives (ệ=U+1EC7, ễ=U+1EC5, ố, ắ, ữ, ợ...).
//     Our audience is Vietnamese children — without this range, a perfectly
//     good English page with a Vietnamese name in it (e.g. "Nguyễn Thị Việt")
//     read >=5% non-Latin and auto-quarantined, the exact silent-corpus-
//     erosion failure this check exists to prevent, inverted onto our own
//     users. Found in review (2026-08-10) before it ever shipped.
//   A single widened ceiling would NOT work: the Devanagari we must catch
//   sits at U+0900-U+097F (e.g. ज = 0x91C), which is BELOW 0x1EFF, so raising
//   one ceiling to cover Vietnamese would make Hindi script read as "Latin"
//   and destroy the check entirely. The two ranges must stay separate.
const LATIN_BASIC_MAX = 0x24f;
const LATIN_EXT_ADDITIONAL_MIN = 0x1e00;
const LATIN_EXT_ADDITIONAL_MAX = 0x1eff;

function isLatinCodepoint(cp) {
  return cp <= LATIN_BASIC_MAX || (cp >= LATIN_EXT_ADDITIONAL_MIN && cp <= LATIN_EXT_ADDITIONAL_MAX);
}

function checkNonLatinScript(pack, reasons) {
  const paragraphs = Array.isArray(pack?.story?.paragraphs_en) ? pack.story.paragraphs_en : [];
  paragraphs.forEach((text, index) => {
    const letters = [...String(text || '')].filter((ch) => LETTER_RE.test(ch));
    if (letters.length < NON_LATIN_MIN_LETTERS) return;
    const nonLatin = letters.filter((ch) => !isLatinCodepoint(ch.codePointAt(0)));
    const ratio = nonLatin.length / letters.length;
    if (ratio >= NON_LATIN_LETTER_RATIO) {
      reasons.push({
        level: 'hard',
        code: 'non_latin_script',
        detail: `paragraphs_en[${index}] is ${(ratio * 100).toFixed(1)}% non-Latin script (${nonLatin.length}/${letters.length} letters)`,
      });
    }
  });
}

// HARD — romanized non-English text (the R2L-PHUC-7TZV incident itself:
// romanized Hindi reads as Latin-alphabet tokens, so it needs its own check
// separate from Check A above). Dependency-free word-set heuristic, not a
// dictionary/spell-check: a real English page always contains at least one
// function/common word from this list; a page with zero hits after the token
// floor is not English. Word list intentionally wide (function words + very
// common content words, plus a vocab/counting/colour top-up added in review)
// — narrower lists produced 31 false positives across 29 books on the full
// live corpus (real English pages like "Mr. Berger walked slowly, measuring
// every step judiciously.", onomatopoeia, and numbered lists all lack
// "small" function words but do contain something from this broader set).
//
// Floor raised 10 -> 20 in review (2026-08-10): at 10, legitimate
// vocabulary/roster page shapes false-flagged — fruit lists ("Apple. Banana.
// Cherry. Durian. Eggplant. Fig. Grape. Honeydew. Ivy gourd. Jackfruit."),
// name rosters (Indian: "Arjuna, Bhima, Nakula, ..."; Vietnamese surnames:
// "Nguyen, Tran, Le, Pham, ..."), and counting pages ("Four. Five. Six.
// Seven. ...") — all 10-13 tokens with no function word among them, all
// legitimate children's-book content. The incident page (book_178669 p15) is
// 28 tokens, so it is still caught with a comfortable margin at floor 20.
// Verified against the full live corpus (3,936 page units): zero false
// positives at floors 10, 15, AND 20.
const ENGLISH_WORD_SET = new Set(`
the a an is was were are am and or to of in on at it he she they we you i his her their my your
that this with for but so as had have has do did does not no all be been being from by there here
what when then them him us me d s t ll re ve m will would can could should may might must if into
out up down over under again very just now too also more most some any one two three
said say says go goes went going get got come came see saw look looked make made take took know
knew think thought want wanted like liked little big small good great new old day night time back
man boy girl mother father friend home house tree water food eat ate run ran play played work help
thing things way long after before well still even much many every
four five six seven eight nine ten eleven twelve thirteen fourteen fifteen twenty hundred
red blue green yellow black white brown pink orange purple
apple banana cherry grape mango fruit fruits cat dog bird fish cow bee ant hen egg milk rice
school book books ball sun moon star rain sky bus car train road city village farm garden flower
number numbers colour color colours colors name names animal animals
`.trim().split(/\s+/));

const ENGLISH_TOKEN_MIN = 20;

// Known limitation (accepted in review, 2026-08-10): this is a word-set
// heuristic, not a language model — it cannot be airtight.
//
// 1. A single common-word collision defeats detection at ANY length. A
//    French page ("On a vu un petit chat...") or Spanish page ("...fue a la
//    escuela...") can slip through because French "on" / Spanish "a" both
//    happen to be English words too. This is not just a generic caveat —
//    it is a LIVE RECURRENCE PATH for the founding incident: romanized
//    Hindi commonly transliterates था/थे ("was"/"were") as "tha"/"the", and
//    "the" is both the single most common English word and the first entry
//    in ENGLISH_WORD_SET. book_178669 (the incident book) is Hindi-derived
//    StoryWeaver content, so a future page from that same source using that
//    exact transliteration would pass this check clean.
// 2. A genuinely non-English passage under ENGLISH_TOKEN_MIN (20) tokens is
//    never evaluated at all. The floor was raised from 10 to 20 specifically
//    to kill vocab/roster/counting-page false positives (fruit lists, name
//    rosters, counting pages — see the floor's own comment above); the cost
//    is that shorter non-English passages go unjudged, including a slice of
//    the founding incident's own text that the floor of 10 used to catch.
// 3. Requiring >= 2 DISTINCT word-set matches (instead of >= 1) was measured
//    against the live corpus and REJECTED, not merely unconsidered: over all
//    2,418 real pages of >= 20 tokens, the distinct-match distribution is
//    0 matches: 1 page (book_178669 p15, the target), 1 match: 1 page
//    (book_103458 p18, a real English proper-noun folklore list —
//    "Skondhokata - West Bengal, Baak - Assam, Rantas - Kashmir..."), 2
//    matches: 2 pages, 3+: 2,414 pages. So >= 2 WOULD close the "the"
//    collision above — at the cost of false-flagging that one legitimate
//    page, on a margin of exactly one. Do not "improve" this threshold
//    without re-measuring: we accept the trade deliberately, because a false
//    POSITIVE here silently removes a good book from the shelf with no
//    human in the loop, while a false NEGATIVE is backstopped downstream —
//    the child's 3-attempt auto-skip on an unreadable page (lesson.astro
//    ~6157-6224, which advances the child at 0💎 rather than trapping them),
//    plus the periodic book QA audit. Do not try to close this gap by adding
//    a dictionary/langdetect dependency; see the module header for why.
function checkNonEnglishPage(pack, reasons) {
  const paragraphs = Array.isArray(pack?.story?.paragraphs_en) ? pack.story.paragraphs_en : [];
  paragraphs.forEach((text, index) => {
    const tokens = String(text || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
    if (tokens.length < ENGLISH_TOKEN_MIN) return;
    const hasEnglishWord = tokens.some((token) => ENGLISH_WORD_SET.has(token));
    if (!hasEnglishWord) {
      reasons.push({
        level: 'hard',
        code: 'non_english_page',
        detail: `paragraphs_en[${index}] has ${tokens.length} tokens and none match a common English word`,
      });
    }
  });
}

// SOFT — cosmetic text hygiene. High-precision mechanical signals only; NO
// dictionary spell-check (avoids false positives on character names / kid words).
// These never hard-block: a book with a typo is annoying but finishable.
const HTML_ARTIFACT = /&(?:nbsp|amp|quot|lt|gt|#\d+|#x[0-9a-f]+);|<\/?[a-z][^>]*>/i;
// Control chars (excluding tab/newline/carriage-return) and the Unicode
// replacement char — both signal corrupted/mis-decoded source text. Written with
// explicit escapes so the source file stays plain ASCII (no literal NUL bytes).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/;
const DOUBLED_WORD = /\b(\w+)\s+\1\b/i;

function checkTextHygiene(pack, reasons) {
  const texts = [];
  (Array.isArray(pack?.story?.paragraphs_en) ? pack.story.paragraphs_en : []).forEach((text, index) => {
    texts.push({ text, where: `paragraphs_en[${index}]` });
  });
  (Array.isArray(pack?.story?.sentences) ? pack.story.sentences : []).forEach((sentence, index) => {
    texts.push({ text: sentence?.text_en || sentence?.text, where: `sentences[${index}].text_en` });
  });

  texts.forEach(({ text, where }) => {
    const value = String(text || '');
    if (HTML_ARTIFACT.test(value)) {
      reasons.push({ level: 'soft', code: 'html_artifact', detail: `${where} contains raw HTML/entity markup` });
    }
    if (CONTROL_CHARS.test(value)) {
      reasons.push({ level: 'soft', code: 'control_char', detail: `${where} contains a control/replacement character` });
    }
    if (DOUBLED_WORD.test(value)) {
      reasons.push({ level: 'soft', code: 'doubled_word', detail: `${where} contains a doubled word` });
    }
  });
}

// Assess a stored book pack. Returns:
//   { ok, hardOk, reasons, checkedAt }
// where `ok` is true only when there are no reasons at all, and `hardOk` is true
// when there are no HARD (unfinishable) reasons — a hygiene-only pack has
// ok=false but hardOk=true, so the caller can serve it as a last resort.
export function assessBookHealth(pack, options = {}) {
  const checkedAt = typeof options.now === 'string' ? options.now : null;
  const reasons = [];
  checkCountParity(pack, reasons, options.expectedSlug);
  checkListenAndOrder(pack, reasons);
  checkBookFlow(pack, reasons);
  checkNonLatinScript(pack, reasons);
  checkNonEnglishPage(pack, reasons);
  checkTextHygiene(pack, reasons);
  const hardReasons = reasons.filter((reason) => reason.level === 'hard');
  return {
    ok: reasons.length === 0,
    hardOk: hardReasons.length === 0,
    reasons,
    checkedAt,
  };
}
