// Reusable Read2Lead book-pack fixture for tests.
//
// Produces a lesson object in the exact shape the book reader and
// src/lib/read2lead-book-flow.mjs consume, so book-reader behaviour can be
// tested without a live pack, KV, or a microphone. `makeBookReaderState` builds
// a *completed* run using the real selection/chunking logic, so the state it
// returns actually validates against validateBookFlowSubmission.
import {
  selectBookQuestions,
  buildBookShadowChunks,
  buildBookPageReads,
  BOOK_QUESTION_LIMIT_V3,
} from '../../src/lib/read2lead-book-flow.mjs';

// Build a valid book-pack lesson: `pages` pages, `sentencesPerPage` sentences
// each, and up to `questionsPerPage` guided-listening questions per page.
export function makeBookPackLesson({
  pages = 2,
  sentencesPerPage = 2,
  questionsPerPage = 2,
} = {}) {
  const sentences = [];
  const paragraphs_en = [];
  const guided_listening = [];
  const book_images = [];
  const book_page_audio = [];

  for (let p = 0; p < pages; p += 1) {
    const pageTexts = [];
    const questions = [];
    for (let s = 0; s < sentencesPerPage; s += 1) {
      const globalIndex = p * sentencesPerPage + s;
      const text_en = `Page ${p + 1} sentence ${s + 1}.`;
      sentences.push({ paragraph_index: p, text_en, audio_url: `audio/p${p}_s${s}.mp3` });
      pageTexts.push(text_en);
      if (s < questionsPerPage) {
        questions.push({
          id: `q_p${p}_i${globalIndex}`,
          question_en: `What happens in sentence ${s + 1} of page ${p + 1}?`,
          options_en: ['The correct answer', 'A plausible distractor'],
          correct_index: 0,
          sentence_index: globalIndex,
        });
      }
    }
    paragraphs_en.push(pageTexts.join(' '));
    guided_listening.push({ paragraph_index: p, questions });
    book_images.push(`img/p${p}.png`);
    book_page_audio.push(`audio/page${p}.mp3`);
  }

  return {
    story: {
      title: 'Test Book',
      paragraphs_en,
      sentences,
      full_audio_url: 'audio/full.mp3',
    },
    guided_listening,
    book_images,
    book_page_audio,
    book_attribution: { publisher: 'Test Publisher' },
    activities: [],
  };
}

// Build a stored `book:<slug>` pack in the exact shape KV holds and the health
// gate (src/lib/read2lead-book-health.mjs) assesses. Reuses makeBookPackLesson
// for the story/questions and adds the book-pool envelope (schema_version,
// book_slug, a read_aloud activity, attribution). Defaults to 3 pages so it
// satisfies the gate's `book_images >= 3` rule. A pack from this helper is
// HEALTHY — makeBrokenBookPack mutates a copy to introduce one defect.
export function makeStoredBookPack(slug = 'book_1', {
  level = 'L1',
  pages = 3,
  sentencesPerPage = 2,
  questionsPerPage = 2,
  title = 'Test Book',
} = {}) {
  const lesson = makeBookPackLesson({ pages, sentencesPerPage, questionsPerPage });
  return {
    schema_version: 2,
    student_name: 'Student',
    level,
    topic: title,
    book_slug: slug,
    story: { ...lesson.story, title },
    guided_listening: lesson.guided_listening,
    book_images: lesson.book_images,
    book_page_audio: lesson.book_page_audio,
    book_attribution: lesson.book_attribution,
    activities: [{ type: 'read_aloud', items: [] }],
  };
}

// Return a stored book pack carrying exactly ONE defect of the given kind, so a
// test can prove the health gate catches it. `hard` kinds are unfinishable
// (must be skipped); `soft` kinds are cosmetic (deprioritized, not stranding).
export function makeBrokenBookPack(kind, slug = 'book_broken', opts = {}) {
  const pack = makeStoredBookPack(slug, opts);
  switch (kind) {
    case 'order_unreconstructable':
      pack.activities.push({
        type: 'listen_and_order',
        items: [{
          scrambled_tokens: ['The', 'cat', 'sat'],
          correct_order_indices: [0, 1, 2],
          original_sentence: 'The cat sat down.', // tokens can never reach "down"
        }],
      });
      return pack;
    case 'order_bad_permutation':
      pack.activities.push({
        type: 'listen_and_order',
        items: [{
          scrambled_tokens: ['The', 'cat', 'sat'],
          correct_order_indices: [0, 1, 1], // not a permutation
          original_sentence: 'The cat sat.',
        }],
      });
      return pack;
    case 'count_mismatch':
      pack.book_page_audio.pop(); // audio count != image count
      return pack;
    case 'page_audio_empty':
      pack.book_page_audio[1] = '   '; // present but blank -> audio never completes
      return pack;
    case 'sentence_out_of_range':
      pack.story.sentences[0] = { ...pack.story.sentences[0], paragraph_index: 99 };
      return pack;
    case 'no_read_aloud':
      pack.activities = [{ type: 'reading_comprehension', items: [] }];
      return pack;
    case 'html_entity': // SOFT
      pack.story.paragraphs_en[0] = `A tree said &nbsp; hello &#39; there.`;
      return pack;
    case 'doubled_word': // SOFT
      pack.story.paragraphs_en[0] = 'The the tree stood tall.';
      return pack;
    case 'non_english_page': // HARD — the R2L-PHUC-7TZV incident itself (romanized Hindi)
      pack.story.paragraphs_en[0] = 'Shanti ko chillate dekha , Krursingh khada tha chup chap , '
        + 'Nayansukh ke nen nahi , Kali nam rakhe hai aap , Rani mang rahi hai bhikh , Namo ki hai kaisi seekh ,';
      return pack;
    case 'non_latin_script': // HARD — Devanagari page
      pack.story.paragraphs_en[0] = "And on priyanshi's way home she heard advit telling that "
        + 'जभी आकजत दनबभ मलह आकजत दनबभ मलह';
      return pack;
    default:
      throw new Error(`unknown broken pack kind: ${kind}`);
  }
}

// Build a completed book_reader state for `lesson`: every page heard, its
// selected questions answered in order, and every read unit passed. Uses the
// real selectBookQuestions / buildBookShadowChunks / buildBookPageReads so the
// result validates against validateBookFlowSubmission.
//
// `version` defaults to 2 (shadow_chunks, question limit 2) for
// byte-compatibility with existing callers that predate book flow v3 — same
// default-is-legacy rationale as validateBookFlowSubmission's own `options`
// (src/lib/read2lead-book-flow.mjs). Pass `{ version: 3 }` for a page-reads
// state (question limit BOOK_QUESTION_LIMIT_V3) built with the same real
// production functions the v3 client and validator use.
export function makeBookReaderState(lesson, { version = 2 } = {}) {
  const sentences = lesson.story.sentences;
  const pageCount = lesson.story.paragraphs_en.length;
  const pages = [];
  for (let p = 0; p < pageCount; p += 1) {
    if (version === 3) {
      const selected = selectBookQuestions(lesson.guided_listening, sentences, p, BOOK_QUESTION_LIMIT_V3);
      const page_reads = buildBookPageReads(sentences, p).map((read) => ({
        ...read,
        status: 'passed',
        score_percent: 90,
        attempts: 1,
      }));
      pages.push({
        page_index: p,
        audio_completed: true,
        selected_questions: selected,
        question_results: selected.map((question) => ({ question_id: question.id, correct: true })),
        page_reads,
      });
      continue;
    }
    const selected = selectBookQuestions(lesson.guided_listening, sentences, p);
    const shadow_chunks = buildBookShadowChunks(sentences, p).map((chunk) => ({
      ...chunk,
      status: 'passed',
      score_percent: 90,
      attempts: 1,
    }));
    pages.push({
      page_index: p,
      audio_completed: true,
      selected_questions: selected,
      question_results: selected.map((question) => ({ question_id: question.id, correct: true })),
      shadow_chunks,
    });
  }
  return {
    flowVersion: version,
    story_completed: true,
    pageIndex: Math.max(0, pageCount - 1),
    stage: 'summary',
    pages,
  };
}
