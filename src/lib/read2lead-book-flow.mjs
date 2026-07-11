const BOOK_QUESTION_LIMIT = 2;
const BOOK_CHUNK_SENTENCE_LIMIT = 3;
const BOOK_CHUNK_WORD_LIMIT = 24;

// book flow v3 (R2L-PAGE-LOOP, 2026-07-11): one read-aloud unit per story page
// (two only when the page exceeds the word cap) replaces v2's 3-9 shadow
// chunks per page; 4 comprehension questions per page (AJ Hoge style) replace
// v2's 2. See specs/SPEC_R2L_PAGE_LOOP.md.
export const BOOK_FLOW_VERSION = 3;
export const BOOK_QUESTION_LIMIT_V3 = 4;
export const BOOK_PAGE_READ_WORD_CAP = 60;

function wordsIn(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function sentenceEntriesForPage(sentences, pageIndex) {
  return (Array.isArray(sentences) ? sentences : [])
    .map((sentence, sentenceIndex) => ({ sentence, sentenceIndex }))
    .filter(({ sentence }) => (
      (Number(sentence?.paragraph_index) || 0) === pageIndex
      && String(sentence?.text_en || sentence?.text || '').trim()
    ));
}

function normalizedQuestion(question, fallbackSentenceIndex) {
  const options = Array.isArray(question?.options_en)
    ? question.options_en.map((option) => String(option || '').trim())
    : [];
  const correctIndex = Number(question?.correct_index);
  const sentenceIndex = Number(question?.sentence_index);
  const resolvedSentenceIndex = Number.isFinite(sentenceIndex)
    ? sentenceIndex
    : fallbackSentenceIndex;
  if (
    !String(question?.id || '').trim()
    || !String(question?.question_en || '').trim()
    || !Number.isInteger(resolvedSentenceIndex)
    || options.length < 2
    || !Number.isInteger(correctIndex)
    || correctIndex < 0
    || correctIndex >= options.length
    || !options[correctIndex]
  ) return null;

  const distractorIndex = options.findIndex((option, index) => index !== correctIndex && option);
  if (distractorIndex < 0) return null;
  const optionIndexes = [correctIndex, distractorIndex].sort((a, b) => a - b);
  return {
    id: String(question.id),
    question_en: String(question.question_en).trim(),
    sentence_index: resolvedSentenceIndex,
    options_en: optionIndexes.map((index) => options[index]),
    correct_index: optionIndexes.indexOf(correctIndex),
  };
}

export function selectBookQuestions(guidedListening, sentences, pageIndex, limit = BOOK_QUESTION_LIMIT) {
  const pageEntries = sentenceEntriesForPage(sentences, pageIndex);
  const pageSentenceIndexes = new Set(pageEntries.map((entry) => entry.sentenceIndex));
  const paragraph = (Array.isArray(guidedListening) ? guidedListening : [])
    .find((entry) => (Number(entry?.paragraph_index) || 0) === pageIndex);
  const fallbackIndexes = pageEntries.map((entry) => entry.sentenceIndex);
  const candidates = (Array.isArray(paragraph?.questions) ? paragraph.questions : [])
    .map((question, index) => normalizedQuestion(
      question,
      fallbackIndexes[index % Math.max(1, fallbackIndexes.length)],
    ))
    .filter((question) => question && pageSentenceIndexes.has(question.sentence_index));

  const bySentence = new Map();
  candidates.forEach((question) => {
    const group = bySentence.get(question.sentence_index) || [];
    group.push(question);
    bySentence.set(question.sentence_index, group);
  });
  bySentence.forEach((group) => group.sort((a, b) => (
    wordsIn(a.question_en) - wordsIn(b.question_en)
    || a.question_en.length - b.question_en.length
    || a.id.localeCompare(b.id)
  )));

  const selected = [];
  const sentenceIndexes = [...bySentence.keys()].sort((a, b) => a - b);
  for (const sentenceIndex of sentenceIndexes) {
    const question = bySentence.get(sentenceIndex)?.shift();
    if (question) selected.push(question);
    if (selected.length >= limit) return selected;
  }
  const remaining = [...bySentence.values()].flat().sort((a, b) => (
    wordsIn(a.question_en) - wordsIn(b.question_en)
    || a.question_en.length - b.question_en.length
    || a.sentence_index - b.sentence_index
    || a.id.localeCompare(b.id)
  ));
  return selected.concat(remaining.slice(0, Math.max(0, limit - selected.length)));
}

// One read-aloud unit per page (two only when the page exceeds `wordCap`),
// replacing v2's 3-9 shadow chunks per page. Fields mirror buildBookShadowChunks
// (sentence_indexes/text_en/audio_urls/word_count, minus chunk_id) so the card
// renderer and recorder pipeline are reused untouched. 0 sentences -> [] (an
// image-only page has no read unit). A single source sentence never splits —
// same sentence-integrity principle as buildBookShadowChunks' soft word-limit
// comment below.
export function buildBookPageReads(sentences, pageIndex, wordCap = BOOK_PAGE_READ_WORD_CAP) {
  const entries = sentenceEntriesForPage(sentences, pageIndex);
  if (!entries.length) return [];

  const textOf = (entry) => String(entry.sentence?.text_en || entry.sentence?.text || '').trim();
  const words = entries.map((entry) => wordsIn(textOf(entry)));
  const totalWords = words.reduce((total, count) => total + count, 0);

  const buildUnit = (unitEntries, readIndex) => ({
    read_id: `p${pageIndex}_r${readIndex}`,
    sentence_indexes: unitEntries.map((entry) => entry.sentenceIndex),
    text_en: unitEntries.map((entry) => textOf(entry)).join(' '),
    audio_urls: unitEntries.map((entry) => String(entry.sentence?.audio_url || '')),
    word_count: unitEntries.reduce((total, entry) => total + wordsIn(textOf(entry)), 0),
  });

  if (entries.length < 2 || totalWords <= wordCap) {
    return [buildUnit(entries, 0)];
  }

  // Split at the sentence boundary where cumulative words first reach half the
  // total. Bounded to [0, entries.length - 2] so both units keep >= 1 sentence
  // even when one sentence dominates the page's word count.
  const half = totalWords / 2;
  let cumulative = 0;
  let splitAt = entries.length - 2;
  for (let index = 0; index <= entries.length - 2; index += 1) {
    cumulative += words[index];
    if (cumulative >= half) {
      splitAt = index;
      break;
    }
  }

  return [
    buildUnit(entries.slice(0, splitAt + 1), 0),
    buildUnit(entries.slice(splitAt + 1), 1),
  ];
}

export function buildBookShadowChunks(
  sentences,
  pageIndex,
  sentenceLimit = BOOK_CHUNK_SENTENCE_LIMIT,
  wordLimit = BOOK_CHUNK_WORD_LIMIT,
) {
  const chunks = [];
  let current = [];
  let currentWords = 0;
  const flush = () => {
    if (!current.length) return;
    const chunkIndex = chunks.length;
    chunks.push({
      chunk_id: `p${pageIndex}_c${chunkIndex}`,
      sentence_indexes: current.map((entry) => entry.sentenceIndex),
      text_en: current.map((entry) => String(entry.sentence?.text_en || entry.sentence?.text || '').trim()).join(' '),
      audio_urls: current.map((entry) => String(entry.sentence?.audio_url || '')),
      word_count: currentWords,
    });
    current = [];
    currentWords = 0;
  };

  sentenceEntriesForPage(sentences, pageIndex).forEach((entry) => {
    const wordCount = wordsIn(entry.sentence?.text_en || entry.sentence?.text || '');
    if (current.length && (current.length >= sentenceLimit || currentWords + wordCount > wordLimit)) {
      flush();
    }
    // The word limit is a soft grouping target. A single source sentence stays
    // intact even when it exceeds the target; validation checks exact coverage.
    current.push(entry);
    currentWords += wordCount;
  });
  flush();
  return chunks;
}

// Each page contributes from `page.page_reads` (v3) when that array is
// present, else from `page.shadow_chunks` (v2 snapshots) — so a checkpoint
// resumed mid-migration and a mixed v2/v3 book reader still summarize
// correctly. Output keys are unchanged: page reads count under the same
// `chunks_*` names the server and client summary UI already key off.
export function summarizeBookFlow(bookReader) {
  const pages = Array.isArray(bookReader?.pages) ? bookReader.pages : [];
  const units = pages.flatMap((page) => (
    Array.isArray(page?.page_reads)
      ? page.page_reads
      : (Array.isArray(page?.shadow_chunks) ? page.shadow_chunks : [])
  ));
  const scores = units
    .map((unit) => Number(unit?.score_percent))
    .filter(Number.isFinite);
  return {
    pages_heard: pages.filter((page) => page?.audio_completed === true).length,
    questions_answered: pages.reduce(
      (total, page) => total + (Array.isArray(page?.question_results) ? page.question_results.length : 0),
      0,
    ),
    chunks_passed: units.filter((unit) => unit?.status === 'passed').length,
    chunks_skipped: units.filter((unit) => unit?.status === 'skipped').length,
    average_pronunciation_score: scores.length
      ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
      : 0,
  };
}

function validateBookFlowV2(bookReader, lessonContext) {
  const errors = [];
  const paragraphs = Array.isArray(lessonContext?.story?.paragraphs_en)
    ? lessonContext.story.paragraphs_en
    : [];
  const sentences = Array.isArray(lessonContext?.story?.sentences)
    ? lessonContext.story.sentences
    : [];
  const pages = Array.isArray(bookReader?.pages) ? bookReader.pages : [];
  if (pages.length !== paragraphs.length) {
    errors.push(`book_reader.pages must contain ${paragraphs.length} pages`);
  }

  paragraphs.forEach((_, pageIndex) => {
    const page = pages[pageIndex];
    if (!page || Number(page.page_index) !== pageIndex) {
      errors.push(`book_reader.pages[${pageIndex}].page_index must be ${pageIndex}`);
      return;
    }
    if (page.audio_completed !== true) {
      errors.push(`book_reader.pages[${pageIndex}] audio is incomplete`);
    }

    const expectedQuestions = selectBookQuestions(
      lessonContext?.guided_listening,
      sentences,
      pageIndex,
    );
    const questionResults = Array.isArray(page.question_results) ? page.question_results : [];
    const expectedQuestionIds = expectedQuestions.map((question) => question.id);
    const submittedQuestionIds = questionResults.map((result) => String(result?.question_id || ''));
    if (
      questionResults.length !== expectedQuestions.length
      || expectedQuestionIds.some((id, index) => submittedQuestionIds[index] !== id)
    ) {
      errors.push(`book_reader.pages[${pageIndex}] must answer ${expectedQuestions.length} selected questions in order`);
    }

    const expectedChunks = buildBookShadowChunks(sentences, pageIndex);
    const submittedChunks = Array.isArray(page.shadow_chunks) ? page.shadow_chunks : [];
    if (submittedChunks.length !== expectedChunks.length) {
      errors.push(`book_reader.pages[${pageIndex}] must contain ${expectedChunks.length} shadow chunks`);
    }
    expectedChunks.forEach((expected, chunkIndex) => {
      const submitted = submittedChunks[chunkIndex];
      if (!submitted || submitted.chunk_id !== expected.chunk_id) {
        errors.push(`book_reader.pages[${pageIndex}].shadow_chunks[${chunkIndex}] has an invalid chunk_id`);
        return;
      }
      if (
        JSON.stringify(submitted.sentence_indexes) !== JSON.stringify(expected.sentence_indexes)
        || expected.sentence_indexes.length > BOOK_CHUNK_SENTENCE_LIMIT
      ) {
        errors.push(`book_reader.pages[${pageIndex}].shadow_chunks[${chunkIndex}] does not cover the expected sentences`);
      }
      const attempts = Math.max(0, Math.floor(Number(submitted.attempts) || 0));
      const score = Number(submitted.score_percent);
      if (submitted.status === 'passed') {
        if (!Number.isFinite(score) || score < 50) {
          errors.push(`book_reader.pages[${pageIndex}].shadow_chunks[${chunkIndex}] passed below 50 percent`);
        }
      } else if (submitted.status === 'skipped') {
        const technicalSkip = submitted.technical_skip === true
          && Number(submitted.technical_failures) >= 2;
        if (attempts < 3 && !technicalSkip) {
          errors.push(`book_reader.pages[${pageIndex}].shadow_chunks[${chunkIndex}] was skipped too early`);
        }
      } else {
        errors.push(`book_reader.pages[${pageIndex}].shadow_chunks[${chunkIndex}] is not settled`);
      }
    });
  });

  const summary = summarizeBookFlow(bookReader);
  return {
    ok: errors.length === 0,
    errors,
    summary,
    skipped: summary.chunks_skipped > 0,
  };
}

// v3 (R2L-PAGE-LOOP): page reads (buildBookPageReads) replace shadow chunks,
// question limit rises to BOOK_QUESTION_LIMIT_V3. Settle rules (pass >= 50 /
// skip after 3 attempts or a technical skip with >= 2 failures) are identical
// in shape to v2 — only the per-page unit being settled changes.
function validateBookFlowV3(bookReader, lessonContext) {
  const errors = [];
  const paragraphs = Array.isArray(lessonContext?.story?.paragraphs_en)
    ? lessonContext.story.paragraphs_en
    : [];
  const sentences = Array.isArray(lessonContext?.story?.sentences)
    ? lessonContext.story.sentences
    : [];
  const pages = Array.isArray(bookReader?.pages) ? bookReader.pages : [];
  if (pages.length !== paragraphs.length) {
    errors.push(`book_reader.pages must contain ${paragraphs.length} pages`);
  }

  paragraphs.forEach((_, pageIndex) => {
    const page = pages[pageIndex];
    if (!page || Number(page.page_index) !== pageIndex) {
      errors.push(`book_reader.pages[${pageIndex}].page_index must be ${pageIndex}`);
      return;
    }
    if (page.audio_completed !== true) {
      errors.push(`book_reader.pages[${pageIndex}] audio is incomplete`);
    }

    const expectedQuestions = selectBookQuestions(
      lessonContext?.guided_listening,
      sentences,
      pageIndex,
      BOOK_QUESTION_LIMIT_V3,
    );
    const questionResults = Array.isArray(page.question_results) ? page.question_results : [];
    const expectedQuestionIds = expectedQuestions.map((question) => question.id);
    const submittedQuestionIds = questionResults.map((result) => String(result?.question_id || ''));
    if (
      questionResults.length !== expectedQuestions.length
      || expectedQuestionIds.some((id, index) => submittedQuestionIds[index] !== id)
    ) {
      errors.push(`book_reader.pages[${pageIndex}] must answer ${expectedQuestions.length} selected questions in order`);
    }

    const expectedReads = buildBookPageReads(sentences, pageIndex);
    const submittedReads = Array.isArray(page.page_reads) ? page.page_reads : [];
    if (submittedReads.length !== expectedReads.length) {
      errors.push(`book_reader.pages[${pageIndex}] must contain ${expectedReads.length} page reads`);
    }
    expectedReads.forEach((expected, readIndex) => {
      const submitted = submittedReads[readIndex];
      if (
        !submitted
        || submitted.read_id !== expected.read_id
        || JSON.stringify(submitted.sentence_indexes) !== JSON.stringify(expected.sentence_indexes)
      ) {
        errors.push(`book_reader.pages[${pageIndex}].page_reads[${readIndex}] does not match the expected read`);
        return;
      }
      const attempts = Math.max(0, Math.floor(Number(submitted.attempts) || 0));
      const score = Number(submitted.score_percent);
      if (submitted.status === 'passed') {
        if (!Number.isFinite(score) || score < 50) {
          errors.push(`book_reader.pages[${pageIndex}].page_reads[${readIndex}] passed below 50 percent`);
        }
      } else if (submitted.status === 'skipped') {
        const technicalSkip = submitted.technical_skip === true
          && Number(submitted.technical_failures) >= 2;
        if (attempts < 3 && !technicalSkip) {
          errors.push(`book_reader.pages[${pageIndex}].page_reads[${readIndex}] was skipped too early`);
        }
      } else {
        errors.push(`book_reader.pages[${pageIndex}].page_reads[${readIndex}] is not settled`);
      }
    });
  });

  const summary = summarizeBookFlow(bookReader);
  return {
    ok: errors.length === 0,
    errors,
    summary,
    skipped: summary.chunks_skipped > 0,
  };
}

// `options.version` defaults to 2 for byte-compatibility with existing 2-arg
// callers (tests and any future caller that omits it) — NOT because v2 is the
// intended path going forward. Production callers (the submit endpoint and the
// book-health gate) always pass the payload's actual version explicitly, so
// this default is a test-surface convenience only; a caller that silently
// relies on it would validate under the OLD rules without meaning to.
export function validateBookFlowSubmission(bookReader, lessonContext, options = {}) {
  const version = options.version === undefined ? 2 : options.version;
  if (version === 2) return validateBookFlowV2(bookReader, lessonContext);
  if (version === 3) return validateBookFlowV3(bookReader, lessonContext);
  const summary = summarizeBookFlow(bookReader);
  return {
    ok: false,
    errors: ['unsupported book_flow_version'],
    summary,
    skipped: summary.chunks_skipped > 0,
  };
}

// The book reader's phase container. Every page change scrolls back to its top
// so a new page never opens scrolled to where the kid tapped "Trang tiếp →".
export const BOOK_READER_SCROLL_ANCHOR_ID = 'w1-book-reader-phase';

// Extracted from lesson.astro's bookShowPage() so the scroll-on-page-turn
// behaviour is unit-testable. Runtime is identical to the original inline call
// (`qs('#w1-book-reader-phase')?.scrollIntoView({ behavior: 'smooth', block: 'start' })`).
// The module is inlined into the page via ?raw, so callers pass the page's
// `document`; tests pass a mock document. Returns the target element (or null)
// for assertions. Null-safe on a missing document or a missing element.
export function scrollBookReaderToTop(doc) {
  if (!doc || typeof doc.querySelector !== 'function') return null;
  const target = doc.querySelector('#' + BOOK_READER_SCROLL_ANCHOR_ID);
  if (target && typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return target;
}
