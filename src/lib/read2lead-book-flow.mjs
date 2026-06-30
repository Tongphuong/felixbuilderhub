const BOOK_QUESTION_LIMIT = 2;
const BOOK_CHUNK_SENTENCE_LIMIT = 3;
const BOOK_CHUNK_WORD_LIMIT = 24;

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
    current.push(entry);
    currentWords += wordCount;
  });
  flush();
  return chunks;
}

export function summarizeBookFlow(bookReader) {
  const pages = Array.isArray(bookReader?.pages) ? bookReader.pages : [];
  const chunks = pages.flatMap((page) => (
    Array.isArray(page?.shadow_chunks) ? page.shadow_chunks : []
  ));
  const scores = chunks
    .map((chunk) => Number(chunk?.score_percent))
    .filter(Number.isFinite);
  return {
    pages_heard: pages.filter((page) => page?.audio_completed === true).length,
    questions_answered: pages.reduce(
      (total, page) => total + (Array.isArray(page?.question_results) ? page.question_results.length : 0),
      0,
    ),
    chunks_passed: chunks.filter((chunk) => chunk?.status === 'passed').length,
    chunks_skipped: chunks.filter((chunk) => chunk?.status === 'skipped').length,
    average_pronunciation_score: scores.length
      ? Math.round(scores.reduce((total, score) => total + score, 0) / scores.length)
      : 0,
  };
}

export function validateBookFlowSubmission(bookReader, lessonContext) {
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
        || expected.word_count > BOOK_CHUNK_WORD_LIMIT
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
