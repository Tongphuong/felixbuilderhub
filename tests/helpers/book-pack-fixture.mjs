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

// Build a completed book_reader state for `lesson`: every page heard, its
// selected questions answered in order, and every shadow chunk passed. Uses the
// real selectBookQuestions / buildBookShadowChunks so the result validates.
export function makeBookReaderState(lesson) {
  const sentences = lesson.story.sentences;
  const pageCount = lesson.story.paragraphs_en.length;
  const pages = [];
  for (let p = 0; p < pageCount; p += 1) {
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
    flowVersion: 2,
    story_completed: true,
    pageIndex: Math.max(0, pageCount - 1),
    stage: 'summary',
    pages,
  };
}
