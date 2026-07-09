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
import { selectBookQuestions, buildBookShadowChunks } from './read2lead-book-flow.mjs';

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
// from the SAME pure helpers (selectBookQuestions / buildBookShadowChunks), so a
// well-formed pack is self-consistent by construction; the real risk is data that
// makes those helpers throw or that references a non-existent page. Empty
// `sentences` is VALID (read_aloud books legitimately ship with no shadow flow),
// so we deliberately do NOT require >= 1 chunk per page.
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
      selectBookQuestions(pack?.guided_listening, sentences, pageIndex);
      buildBookShadowChunks(sentences, pageIndex);
    }
  } catch (err) {
    reasons.push({ level: 'hard', code: 'book_flow_throws', detail: `page derivation failed: ${err?.message || err}` });
  }
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
  checkTextHygiene(pack, reasons);
  const hardReasons = reasons.filter((reason) => reason.level === 'hard');
  return {
    ok: reasons.length === 0,
    hardOk: hardReasons.length === 0,
    reasons,
    checkedAt,
  };
}
