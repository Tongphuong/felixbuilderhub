import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { canAccessPackForPractice } from './_read2lead-pack-access.js';
import {
  azureSpeechConfigured,
  azureUnderFreeTier,
  azureBumpUsage,
  assessPronunciationWithAzure,
  mapAzureReadResult,
  mapAzureOpenResult,
  mapAzureFramePronunciation,
  trimWavToSeconds,
  splitWavIntoChunks,
  mergeAzureChunkResults,
  AZURE_PA_EST_SECONDS_PER_CALL,
} from './_azure-pronunciation.js';
// V1.3 homework feedback sandwich (2026-07-12) — see that file's header for
// the two-way-import note (it imports normalizePracticeWord from here).
import { buildFeedbackContext, generateHomeworkFeedback } from './_homework-feedback.js';
import { validateReplyShape, detectCharacterBreak, scanBannedTopics, screenWithLlamaGuard } from './_minny-guardrails.js';
// Grading-honesty packet (2026-07-14): the no-reference open scorer grounds
// relevance on the child's OWN homework vocabulary instead of story
// keywords — normalizeHomeworkRecord is the one tolerant-read chokepoint for
// any stored schema version (v1/v2/v3), reused here rather than re-deriving
// task shapes a second time (rule 21).
import { normalizeHomeworkRecord } from './_homework.js';
// Grading-honesty packet v3 (2026-07-15): the commonness gate on CREDIT —
// see _common-english-words.js's own header for the full source/license
// history and why string similarity alone (isLikelyContentMatch below)
// cannot separate "the child said a different real word on purpose"
// (pork/park) from "the transcriber mangled the intended word"
// (footbal/football).
import { isCommonWord } from './_common-english-words.js';

export const SKIP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'at',
]);

export const CLOSE_SCORE_WEIGHT = 0.5;
export const SIMILARITY_THRESHOLD = 0.75;
export const CLOSE_THRESHOLD = 0.5;
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES_LONG = 10 * 1024 * 1024;

// Shared "how many spoken words counts as full effort" scale — used by both
// scoreOpenTranscript's effort component and scoreSpeechFrame's zero-anchor
// carve-out below (grading-honesty packet, 2026-07-14), so a stem/attempt
// with nothing to match against still degrades to one consistent notion of
// "did the child actually speak" rather than each place inventing its own.
export const EFFORT_WORDS_FOR_FULL_CREDIT = 10;

// Defense in depth (revision 2, 2026-07-14 — fixes Buffet's reject finding
// 2): the pronunciation_effort branch with no Azure blend has NO content
// basis at all — pure word-count effort, unable to tell a genuine long
// answer from gibberish (Buffet reproduced 100 + "Hay quá!" praise on 12
// nonsense words). A hard ceiling below the top praise tier means an
// effort-only number can never claim the "Hay quá!"/"Tuyệt vời!" tier,
// regardless of what upstream evidence (Azure chunk failures, an exhausted
// free tier) put this attempt on this branch.
export const EFFORT_ONLY_SCORE_CEILING = 60;

// A no-reference open attempt: the photo carries the task (no expected_text
// exists to score against) or Free Talking (the conversation LLM handles
// Vietnamese there, score is ignored client-side). scoreOpenTranscript must
// never extract "keywords" out of either literal sentinel string itself —
// that was the root cause of the 45%-ceiling bug (greping the sentinel text
// for a fake "phototalk" keyword). Real story-context scoring (a genuine
// story's text as storyContext) is untouched by this set.
export const OPEN_NO_REFERENCE_SENTINELS = new Set(['photo_talk', 'free_talking_no_score']);

export function normalizeWord(word) {
  return String(word || '').toLowerCase().replace(/[^a-z]/g, '');
}

export function wordSimilarity(a, b) {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

// Length-aware content-match floor (grading-honesty packet REVISION 2,
// 2026-07-14 — fixes Buffet's reject finding 1). Plain Levenshtein ratio
// (wordSimilarity) is unfit for judging whether a spoken word IS a target
// word: any 3-4 letter English rhyme pair (park/dark, cat/hat, book/look,
// sing/ring) differs by exactly one edit and clears any single flat
// threshold that also has to admit real typos/mishearings ("hapy"->"happy",
// "becase"->"because"). Bucketed by word length instead of one flat number:
//   - up to 4 letters: the first letter must match, on top of the existing
//     0.75 bar. A mis-heard/mis-transcribed word overwhelmingly keeps its
//     onset consonant — every false-rhyme pair above differs in the FIRST
//     letter (dark/park, cat/hat, book/look, sing/ring), while the genuine
//     near-miss this packet's own fixture relies on ("pack" heard for
//     "park") shares it. A literal "exact match only" rule (the packet's
//     starting suggestion) would also reject pack/park and break the
//     existing near-miss test — this is the documented refinement, same
//     shape as the 5-6 bucket's explicitly-invited one below.
//   - 5-6 letters: first letter must match, similarity >= 0.8. Raising the
//     bar to 0.84 instead was tried and rejected: "hapy"/"happy" sits at
//     exactly 0.8, so 0.84 would reject a required-to-match pair. The
//     first-letter tiebreak is what lets 0.8 stay the floor while still
//     rejecting house/mouse (0.8, first letters differ).
//   - 7+ letters: unchanged, similarity >= 0.75 ("as today" per the revision
//     brief) — "becase"/"because" (0.857) and "footbal"/"football" (0.875)
//     must keep matching.
// Used everywhere fuzzy matching grants CONTENT CREDIT or NEAR-MISS status:
// scoreOpenTranscript's wordsMatched loop, computeContentPrecision,
// findNearMissVocabularyWords. Deliberately NOT used by scoreTranscript's
// read-aloud close/exact buckets or scoreSpeechFrame's anchor-word coverage
// — out of this revision's scope (see the packet's scope guard); those keep
// wordSimilarity + SIMILARITY_THRESHOLD/CLOSE_THRESHOLD exactly as before.
export function isLikelyContentMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  const sameFirstLetter = a[0] === b[0];
  if (maxLen <= 4) return sameFirstLetter && wordSimilarity(a, b) >= SIMILARITY_THRESHOLD;
  if (maxLen <= 6) return sameFirstLetter && wordSimilarity(a, b) >= 0.8;
  return wordSimilarity(a, b) >= SIMILARITY_THRESHOLD;
}

// Commonness gate on CREDIT (grading-honesty packet v3, 2026-07-15 — the
// design that replaces this packet's two rejected string-only attempts; see
// _common-english-words.js's header for the full history). isLikelyContentMatch
// above stays UNCHANGED and is still exactly what candidate proposal
// (findNearMissVocabularyWords) uses — a candidate may legitimately be
// proposed for ANY close pair, including two different common words
// (pack->park AND pork->park both surface as candidates; the LLM feedback
// layer decides from context whether either is worth mentioning). This
// function is the separate, narrower rule for automatic SCORE/CREDIT: a
// spoken word that both (a) fuzzy-matches a vocabulary word AND (b) is
// itself an ordinary, common English word the child could easily have said
// on purpose must NOT earn fuzzy credit — only an exact (normalized) match
// does. A spoken word NOT in the common set (a misspelling/mis-hearing like
// "hapy"/"becase"/"footbal", or a genuinely rare word) keeps crediting under
// the existing bucketed fuzzy rule. Used by computeContentPrecision and
// scoreOpenTranscript's wordsMatched loop — nowhere else (scoreTranscript's
// read-aloud buckets and scoreSpeechFrame's anchor coverage are out of this
// revision's scope, same as isLikelyContentMatch itself).
export function isCreditableContentMatch(spoken, vocabWord) {
  if (!spoken || !vocabWord) return false;
  if (spoken === vocabWord) return true; // exact match always credits, common or not
  if (isCommonWord(spoken)) return false; // ordinary word, not what was asked for -> no fuzzy credit
  return isLikelyContentMatch(spoken, vocabWord);
}

function tokenize(text) {
  return String(text || '')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function scoreTranscript(expectedText, transcript) {
  const expectedWords = tokenize(expectedText)
    .map((word) => ({ raw: word, norm: normalizeWord(word) }))
    .filter((word) => word.norm && !SKIP_WORDS.has(word.norm));

  const transcriptWords = tokenize(transcript)
    .map((word) => ({ raw: word, norm: normalizeWord(word) }))
    .filter((word) => word.norm);

  const used = new Set();
  let correct = 0;
  let close = 0;
  const wordsMissed = [];
  const wordsClose = [];
  const wordsExact = [];
  const wordFeedback = [];

  for (const expectedWord of expectedWords) {
    let bestIndex = -1;
    let bestSimilarity = 0;

    for (let index = 0; index < transcriptWords.length; index += 1) {
      if (used.has(index)) continue;
      const similarity = wordSimilarity(expectedWord.norm, transcriptWords[index].norm);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = index;
      }
    }

    const spokenWord = bestIndex >= 0 ? transcriptWords[bestIndex] : null;
    if (bestIndex >= 0 && bestSimilarity >= SIMILARITY_THRESHOLD) {
      used.add(bestIndex);
      correct += 1;
      wordsExact.push(expectedWord.raw);
      wordFeedback.push(wordFeedbackEntry(
        expectedWord,
        spokenWord,
        spokenWord?.norm === expectedWord.norm ? 'exact' : 'close',
        bestSimilarity,
      ));
    } else if (bestIndex >= 0 && bestSimilarity >= CLOSE_THRESHOLD) {
      used.add(bestIndex);
      close += 1;
      wordsClose.push(expectedWord.raw);
      wordFeedback.push(wordFeedbackEntry(expectedWord, spokenWord, 'close', bestSimilarity));
    } else {
      wordsMissed.push(expectedWord.raw);
      wordFeedback.push(wordFeedbackEntry(expectedWord, spokenWord, 'missed', bestSimilarity));
    }
  }

  const totalCount = expectedWords.length;
  const exactCount = correct;
  const closeCount = close;
  const scorePercent = totalCount > 0
    ? Math.round(((exactCount + closeCount * CLOSE_SCORE_WEIGHT) / totalCount) * 100)
    : 0;

  return {
    transcript: String(transcript || '').trim(),
    score_percent: scorePercent,
    exact_count: exactCount,
    close_count: closeCount,
    correct_count: exactCount,
    total_count: totalCount,
    words_missed: wordsMissed,
    words_close: wordsClose,
    words_exact: wordsExact,
    word_feedback: wordFeedback,
    feedback_vi: feedbackVi(scorePercent, wordsMissed.length > 0 || wordsClose.length > 0),
  };
}

function wordFeedbackEntry(expectedWord, spokenWord, status, similarity) {
  const expected = String(expectedWord?.raw || '');
  const spoken = String(spokenWord?.raw || '').trim();
  const expectedNorm = expectedWord?.norm || normalizeWord(expected);
  const spokenNorm = spokenWord?.norm || normalizeWord(spoken);
  return {
    expected,
    expected_norm: expectedNorm,
    spoken,
    spoken_norm: spokenNorm,
    status,
    similarity: Math.round((Number(similarity) || 0) * 100) / 100,
    can_replay: true,
    feedback_vi: status === 'exact'
      ? `Con đọc "${expected}" rõ rồi.`
      : spoken
        ? `Con đọc "${spoken}", cần "${expected}".`
        : `Con luyện lại từ "${expected}".`,
  };
}

// hasFlaggedWord (grading-honesty packet, 2026-07-14): true when at least
// one content word was flagged close/missed this attempt. The top-praise
// line ("cực kỳ rõ ràng" / "rất tốt") claims a level of correctness that
// isn't true when a real word was flagged — praise copy must not claim it,
// so a flagged attempt steps down exactly one tier instead (never mentions
// the word itself; the coach names it). Purely a tone change: scorePercent
// and every other field are untouched.
export function feedbackVi(scorePercent, hasFlaggedWord = false) {
  if (scorePercent >= 90 && !hasFlaggedWord) return 'Tuyệt vời! Con đọc cực kỳ rõ ràng!';
  if (scorePercent >= 70) return 'Giỏi lắm! Con đọc được hầu hết các từ rồi!';
  if (scorePercent >= 50) return 'Cố lên! Con đang tiến bộ rất tốt!';
  return 'Không sao, thử lại nào! Đọc to hơn một chút nhé!';
}

export function feedbackOpenVi(scorePercent, hasFlaggedWord = false) {
  if (scorePercent >= 80 && !hasFlaggedWord) return 'Hay quá! Con kể và suy nghĩ về truyện rất tốt!';
  if (scorePercent >= 55) return 'Giỏi lắm! Minny thấy con hiểu câu chuyện rồi!';
  if (scorePercent >= 35) return 'Con đã cố trả lời! Thử nói thêm một chút về truyện nhé.';
  return 'Con thử trả lời bằng tiếng Anh, nói to và rõ hơn một chút nhé!';
}

export function extractStoryKeywords(storyContext) {
  const seen = new Set();
  const keywords = [];
  for (const word of tokenize(storyContext)) {
    const norm = normalizeWord(word);
    if (!norm || norm.length < 4 || SKIP_WORDS.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    keywords.push(word);
    if (keywords.length >= 12) break;
  }
  return keywords;
}

// Deterministic homework vocabulary (grading-honesty packet, 2026-07-14): the
// real content grounding for a no-reference open attempt (photo_talk) —
// build columns' label_en+options, present/qa stems' anchor_words, story
// must_use, and read items' content words, from EVERY task on the child's
// current homework, not just whichever task compiled to this step (a bare
// photo answer can legitimately echo vocabulary the teacher put in a
// DIFFERENT task on the same assignment). normalizeHomeworkRecord upgrades
// any stored schema version first. Words <3 chars are dropped (same
// threshold mapAzureFramePronunciation already uses to skip trivial words).
// Pure, never throws.
export function deriveHomeworkVocabulary(homeworkRaw) {
  const homework = normalizeHomeworkRecord(homeworkRaw);
  const tasks = Array.isArray(homework?.tasks) ? homework.tasks : [];
  const words = new Set();
  const add = (raw) => {
    for (const token of tokenize(raw)) {
      const norm = normalizeWord(token);
      if (norm && norm.length >= 3 && !SKIP_WORDS.has(norm)) words.add(norm);
    }
  };
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    if (task.type === 'read') {
      for (const item of task.items || []) add(item?.text_en);
    } else if (task.type === 'present') {
      for (const stem of task.stems || []) {
        for (const w of stem?.anchor_words || []) add(w);
      }
    } else if (task.type === 'story') {
      for (const w of task.must_use || []) add(w);
    } else if (task.type === 'build') {
      for (const col of task.columns || []) {
        add(col?.label_en);
        for (const opt of col?.options || []) add(opt);
      }
    } else if (task.type === 'qa') {
      for (const card of task.cards || []) {
        add(card?.question_en);
        for (const w of card?.stem?.anchor_words || []) add(w);
      }
    }
    // picture: anchors are the answer key (hidden from the child) — never a
    // vocabulary source, same reasoning minny-voice's tap-allowlist excludes them.
  }
  return [...words];
}

// A single flat similarity floor for near-miss detection (this constant,
// 0.65) was Buffet's reject finding 1: at 0.65+, ordinary English rhyme
// pairs (park/dark, cat/hat, sing/ring...) read as "the child mis-said the
// homework word" just as easily as genuine mis-hearings like "pack"/"park"
// do — a false accusation the honesty rule forbids. Superseded 2026-07-14
// (revision 2) by isLikelyContentMatch's length-bucketed rule above, which
// separates the two cases the flat threshold could not.
//
// A transcript content word that is NOT an exact homework-vocabulary member
// but closely resembles one (grading-honesty packet, 2026-07-14) is a likely
// mis-said homework word — "grid-grounded", deterministic (never an LLM
// guess). Used both to step the praise tone down (feedbackOpenVi) and, via
// the caller's result object, as a hint for the coach's grid-grounded recast
// (_homework-feedback.js reads result.near_miss_words). Pure, never throws.
export function findNearMissVocabularyWords(transcript, vocabulary) {
  const vocabList = Array.isArray(vocabulary) ? vocabulary : [];
  if (!vocabList.length) return [];
  const vocabSet = new Set(vocabList);
  const seen = new Set();
  const results = [];
  for (const token of tokenize(transcript)) {
    const norm = normalizeWord(token);
    if (!norm || norm.length < 3 || SKIP_WORDS.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    if (vocabSet.has(norm)) continue; // already a known-good vocabulary word
    let bestWord = null;
    let bestSim = 0;
    for (const vocabWord of vocabSet) {
      if (!isLikelyContentMatch(norm, vocabWord)) continue;
      const sim = wordSimilarity(norm, vocabWord);
      if (sim > bestSim) {
        bestSim = sim;
        bestWord = vocabWord;
      }
    }
    if (bestWord) {
      results.push({ said: norm, nearest: bestWord, similarity: Math.round(bestSim * 100) / 100 });
    }
  }
  return results;
}

// Precision, not recall (grading-honesty packet, 2026-07-14): homework
// vocabulary drawn from a multi-column build task is a MENU of alternatives
// — a real, correct answer only ever uses a handful of them, so "what
// fraction of the whole menu did the child recite" unfairly caps a genuinely
// on-topic answer well under 100%. The honest question is the other
// direction: of the real content words the child actually SAID, how many
// are genuine homework vocabulary? Gibberish or off-topic speech (including
// mistranscribed Vietnamese, forced through English ASR) scores near zero
// here even when it happens to contain one common English word, because the
// measure is a fraction of ALL the distinct content words spoken, not a
// bare yes/no. Pure, never throws.
export function computeContentPrecision(transcript, vocabulary) {
  const vocabList = Array.isArray(vocabulary) ? vocabulary : [];
  if (!vocabList.length) return 0;
  const contentWords = new Set();
  for (const token of tokenize(transcript)) {
    const norm = normalizeWord(token);
    if (norm && norm.length >= 3 && !SKIP_WORDS.has(norm)) contentWords.add(norm);
  }
  if (!contentWords.size) return 0;
  let matched = 0;
  for (const word of contentWords) {
    // Commonness gate (grading-honesty packet v3, 2026-07-15): fuzzy credit
    // via isCreditableContentMatch, not raw isLikelyContentMatch — see that
    // function's header. Exact matches always count regardless of commonness.
    if (vocabList.some((kw) => isCreditableContentMatch(word, kw))) matched += 1;
  }
  return Math.round((matched / contentWords.size) * 100);
}

/**
 * Scores a no-reference-text-safe open attempt. Real story-context scoring
 * (storyContext is genuine story text, not a sentinel) is UNCHANGED — same
 * extractStoryKeywords-based relevance as before this packet.
 *
 * For a no-reference attempt (storyContext is photo_talk / free_talking_no_
 * score — OPEN_NO_REFERENCE_SENTINELS), scoreOpenTranscript must never treat
 * the sentinel string itself as content to extract keywords from (that was
 * the 45%-ceiling bug: greping "photo_talk" produced one fake keyword,
 * "phototalk", that a real transcript could never literally contain).
 * Instead:
 *   - homeworkVocabulary present -> ground relevance on it (real content),
 *     graded_against: 'homework_content'.
 *   - no derivable vocabulary at all (bare photo, empty tasks) -> effort +
 *     Azure pronunciation only when azurePronunciationPercent is supplied
 *     (the caller only has this on the Azure-graded path), else pure effort
 *     — graded_against: 'pronunciation_effort'. The UI can label the result
 *     honestly instead of implying content was graded when it wasn't.
 *
 * @param {string} transcript
 * @param {string} storyContext
 * @param {{homeworkVocabulary?: string[], azurePronunciationPercent?: number}} [opts]
 */
export function scoreOpenTranscript(transcript, storyContext, { homeworkVocabulary, azurePronunciationPercent } = {}) {
  const transcriptWords = tokenize(transcript)
    .map((word) => normalizeWord(word))
    .filter(Boolean);
  const spokenCount = transcriptWords.length;

  const isNoReference = OPEN_NO_REFERENCE_SENTINELS.has(String(storyContext || '').trim());
  const vocabulary = isNoReference && Array.isArray(homeworkVocabulary) ? homeworkVocabulary : [];
  const gradedAgainst = isNoReference ? (vocabulary.length ? 'homework_content' : 'pronunciation_effort') : null;

  const keywords = isNoReference ? vocabulary : extractStoryKeywords(storyContext);
  const wordsMatched = [];

  for (const keyword of keywords) {
    const norm = normalizeWord(keyword);
    // Commonness gate (grading-honesty packet v3, 2026-07-15): a spoken word
    // only earns "words_matched" credit for this keyword via fuzzy
    // similarity when it is NOT itself a common English word the child could
    // have said on purpose (isCreditableContentMatch) — exact matches always
    // count. This is what stops "pork" (common, spoken) from lighting up
    // "park" (vocabulary) as a green chip the child never actually said.
    const hit = transcriptWords.some((spoken) => isCreditableContentMatch(spoken, norm));
    if (hit) wordsMatched.push(keyword);
  }

  const effortScore = Math.min(100, Math.round((spokenCount / EFFORT_WORDS_FOR_FULL_CREDIT) * 100));

  // homework_content uses computeContentPrecision (see above) instead of the
  // keywords-matched/keywords.length recall fraction real story-context
  // scoring still uses below — a menu of build-task alternatives makes recall
  // an unfair, unreachable ceiling for a genuinely correct answer.
  const contentRelevancePercent = gradedAgainst === 'homework_content'
    ? computeContentPrecision(transcript, vocabulary)
    : null;
  const relevanceScore = gradedAgainst === 'homework_content'
    ? contentRelevancePercent
    : (keywords.length ? Math.round((wordsMatched.length / keywords.length) * 100) : Math.min(100, effortScore));

  // homework_content weights relevance more heavily than the real
  // story-context/no-vocabulary 0.45/0.55 split: effort alone must never
  // carry a zero-relevance (gibberish/off-topic) answer past a low ceiling
  // (100 * 0.3 = 30, comfortably under the honesty rule's "low" bar) — see
  // row 3 (gibberish) and row 4 (Vietnamese, garbled through English ASR) in
  // the live battery this packet fixes.
  const useAzureBlend = gradedAgainst === 'pronunciation_effort' && Number.isFinite(azurePronunciationPercent);
  const effortWeight = gradedAgainst === 'homework_content' ? 0.3 : 0.45;
  const rawScorePercent = useAzureBlend
    ? Math.round(effortScore * 0.45 + azurePronunciationPercent * 0.55)
    : Math.round(effortScore * effortWeight + relevanceScore * (1 - effortWeight));
  // pronunciation_effort + no Azure blend = zero content basis — see
  // EFFORT_ONLY_SCORE_CEILING above. Every other branch (homework_content,
  // real story-context, and pronunciation_effort WITH an Azure blend) is
  // unaffected.
  const scorePercent = (gradedAgainst === 'pronunciation_effort' && !useAzureBlend)
    ? Math.min(rawScorePercent, EFFORT_ONLY_SCORE_CEILING)
    : rawScorePercent;

  const nearMissWords = gradedAgainst === 'homework_content'
    ? findNearMissVocabularyWords(transcript, vocabulary)
    : [];

  const result = {
    transcript: String(transcript || '').trim(),
    score_percent: scorePercent,
    correct_count: wordsMatched.length,
    total_count: Math.max(keywords.length, 1),
    words_missed: [],
    words_close: [],
    words_matched: wordsMatched,
    feedback_vi: feedbackOpenVi(scorePercent, nearMissWords.length > 0),
    check_mode: 'open',
  };
  if (gradedAgainst) result.graded_against = gradedAgainst;
  // content_relevance_percent (grading-honesty packet, 2026-07-14): the SAME
  // precision measure that drove the score, exposed so hasLowContentRelevance
  // (the VN-redirect trigger) can threshold on it rather than a bare "did
  // they touch the vocabulary at all" boolean — see hasLowContentRelevance's
  // own header for why that boolean was too easy to clear by accident.
  if (contentRelevancePercent !== null) result.content_relevance_percent = contentRelevancePercent;
  if (nearMissWords.length) result.near_miss_words = nearMissWords;
  return result;
}

/**
 * Score a speech frame (presentation) against anchor-word stems.
 *
 * @param {string} transcript - ASR transcript
 * @param {Array<{id:string, text_en:string, anchor_words:string[]}>} stems
 * @param {number} durationTargetSec - target duration in seconds
 * @param {object} telemetry - client telemetry (peak_level, duration_seconds, etc.)
 * @returns {object} result shape described in SPEC_SPEAKUP_V0.md Phase 2
 */
export function scoreSpeechFrame(transcript, stems, durationTargetSec, telemetry = {}) {
  const transcriptWords = tokenize(transcript)
    .map((word) => normalizeWord(word))
    .filter(Boolean);
  const wordCount = transcriptWords.length;

  const stemResults = stems.map((stem) => {
    const anchorWords = Array.isArray(stem.anchor_words) ? stem.anchor_words : [];
    if (anchorWords.length === 0) {
      // Zero-anchor carve-out (grading-honesty packet, 2026-07-14): a story
      // task's must_use is legitimately allowed to be empty ("if the lesson
      // names no target words, use an empty list"), which used to auto-score
      // this stem 100 regardless of what — or whether — the child said
      // anything. There is nothing to match against, so score on spoken
      // effort instead (same EFFORT_WORDS_FOR_FULL_CREDIT scale
      // scoreOpenTranscript uses), never a free 100.
      const coveragePct = Math.min(100, Math.round((wordCount / EFFORT_WORDS_FOR_FULL_CREDIT) * 100));
      return { id: stem.id, text_en: stem.text_en, matched: coveragePct >= 50, coveragePct };
    }
    let matchedCount = 0;
    for (const anchor of anchorWords) {
      const normAnchor = normalizeWord(anchor);
      const found = transcriptWords.some((tw) => wordSimilarity(tw, normAnchor) >= SIMILARITY_THRESHOLD);
      if (found) matchedCount++;
    }
    const coveragePct = Math.round((matchedCount / anchorWords.length) * 100);
    // A stem is considered matched when at least 50% of its anchor words appear in the transcript.
    const matched = coveragePct >= 50;
    return { id: stem.id, text_en: stem.text_en, matched, coveragePct };
  });

  const matchPct = stemResults.length
    ? Math.round(stemResults.reduce((sum, s) => sum + s.coveragePct, 0) / stemResults.length)
    : 0;

  const spokeAllStems = stemResults.every(s => s.matched);

  // Duration tolerance: +/-20% of target
  let durationOnTarget = false;
  let durationSec = 0;
  if (typeof durationTargetSec === 'number' && durationTargetSec > 0) {
    const actual = Number.isFinite(telemetry?.duration_seconds) ? telemetry.duration_seconds : 0;
    durationSec = actual;
    const lower = durationTargetSec * 0.8;
    const upper = durationTargetSec * 1.2;
    durationOnTarget = actual >= lower && actual <= upper;
  }

  // Soft spokeClearly signal derived from peak_level telemetry; never punitive.
  let spokeClearly = true;
  const peakRaw = telemetry?.peak_level;
  if (peakRaw !== undefined && peakRaw !== null && peakRaw !== '') {
    const peak = parseFloat(peakRaw);
    if (!Number.isNaN(peak) && peak <= 0) {
      spokeClearly = false;
    }
  }

  return {
    matchPct,
    rubric: {
      spokeAllStems,
      durationOnTarget,
      spokeClearly,
    },
    stems: stemResults,
    wordCount,
    durationSec,
  };
}

export function inferAudioFilename(blob) {
  // MIME type wins over client filename — Safari records MP4 but some pages still name the file audio.webm.
  const type = String(blob?.type || '').toLowerCase();
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'audio.mp4';
  if (type.includes('ogg')) return 'audio.ogg';
  if (type.includes('wav')) return 'audio.wav';
  if (type.includes('webm')) return 'audio.webm';

  const name = blob?.name || '';
  if (name && /\.(webm|mp4|m4a|ogg|wav|mp3|flac)$/i.test(name)) return name;

  return 'audio.webm';
}

export const TRANSCRIBE_TIMEOUT_MS = 20000;

export function resolveOpenAIApiKey(env = {}) {
  return String(env.OPENAI_API_KEY || env.READ2LEAD_OPENAI_API_KEY || '').trim();
}

export async function transcribeWithOpenAI(audioBlob, apiKey, fetchFn = fetch, prompt) {
  const filename = inferAudioFilename(audioBlob);
  const formData = new FormData();
  formData.append('file', audioBlob, filename);
  formData.append('model', 'whisper-1');
  formData.append('language', 'en');
  formData.append('response_format', 'json');
  if (prompt) formData.append('prompt', String(prompt));

  let response;
  try {
    response = await fetchFn('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      const error = new Error('openai_timeout');
      error.code = 'transcription_timeout';
      throw error;
    }
    throw err;
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch {}
    console.error(`[openai-whisper] ${response.status} ${filename}:`, detail);
    const error = new Error('openai_transcription_failed');
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  const payload = await response.json();
  return String(payload?.text || '').trim();
}

export const WORKERS_AI_ASR_MODEL = '@cf/openai/whisper-large-v3-turbo';

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// PRIMARY provider: Whisper running INSIDE Cloudflare (Workers AI binding).
// Reason: direct calls to external ASR providers from a Worker serving
// Vietnamese users egress from nearby colos (often Hong Kong) and get
// geo-blocked with 403 "unsupported_country_region_territory" — the root
// cause of the 2026-06-11 speaking outage. Workers AI never leaves
// Cloudflare, so there is no border to be blocked at.
export async function transcribeWithWorkersAI(audioBlob, ai, prompt) {
  const buffer = await audioBlob.arrayBuffer();
  let result;
  try {
    result = await ai.run(WORKERS_AI_ASR_MODEL, {
      audio: arrayBufferToBase64(buffer),
      task: 'transcribe',
      language: 'en',
      // V1.1 (2026-07-11): whisper-large-v3-turbo's documented input schema
      // (developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)
      // supports `initial_prompt` (not `prompt`, which is OpenAI whisper-1's
      // field name) -- only send it when set, an undocumented extra field is
      // how requests start 500ing.
      ...(prompt ? { initial_prompt: String(prompt) } : {}),
    });
  } catch (err) {
    const error = new Error('workers_ai_transcription_failed');
    error.detail = String(err?.message || err).slice(0, 300);
    // No HTTP status available — classify as a provider outage so the child
    // gets the honest outage message (and the OpenAI fallback can run).
    error.status = 503;
    throw error;
  }
  return String(result?.text || '').trim();
}

// Workers AI first; OpenAI (US egress permitting) as automatic fallback.
export async function transcribeAudio(audioBlob, { ai = null, openaiApiKey = '', fetchFn = fetch, prompt } = {}) {
  if (!ai && !openaiApiKey) {
    const error = new Error('no_transcription_provider');
    error.code = 'config_error';
    throw error;
  }
  if (ai) {
    try {
      return await transcribeWithWorkersAI(audioBlob, ai, prompt);
    } catch (err) {
      if (!openaiApiKey) throw err;
      /* fall through to OpenAI */
    }
  }
  return transcribeWithOpenAI(audioBlob, openaiApiKey, fetchFn, prompt);
}

// Vietnamese-speech detection (spec's known weakness, line 277): Whisper is
// pinned to language 'en', so a kid speaking Vietnamese gets a garbage
// English transcript and a nonsense score. When a scored attempt lands very
// low, re-transcribe once WITHOUT the language pin (auto-detect) and test for
// Vietnamese diacritics — if found, return a warm retry message instead of a
// garbage score. Costs ~$0.0005/audio-min and only fires on very low scores.
export const VIETNAMESE_REDIRECT_THRESHOLD = 20;
export const VIETNAMESE_DIACRITICS_RE = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

export async function detectVietnameseSpeech(audioBlob, ai) {
  if (!ai) return false;
  try {
    const buffer = await audioBlob.arrayBuffer();
    const result = await ai.run(WORKERS_AI_ASR_MODEL, {
      audio: arrayBufferToBase64(buffer),
      task: 'transcribe',
    });
    return VIETNAMESE_DIACRITICS_RE.test(String(result?.text || ''));
  } catch {
    return false;
  }
}

// VN-redirect trigger for no-reference open attempts (grading-honesty
// packet, 2026-07-14): a raw score<20 gate was proven insufficient — a
// fluent Vietnamese answer that Azure pronounces well, or that racks up
// effort-score word count, can clear 20 easily while matching NONE of the
// homework vocabulary. When the attempt was graded against real vocabulary
// (graded_against 'homework_content'), "low relevance" is thresholded on
// content_relevance_percent (the same precision measure that drove the
// score) — NOT a bare "did they touch the vocabulary at all" boolean: a
// garbled/mistranscribed transcript can coincidentally contain one common
// English word that happens to be in the homework vocabulary (observed live:
// "...new version bank" from real Vietnamese speech matched the vocabulary
// word "new") while being overwhelmingly irrelevant otherwise. When there is
// no vocabulary to grade against, fall back to the original score<20 gate
// (unchanged behaviour).
export function hasLowContentRelevance(result) {
  if (result?.graded_against === 'homework_content') {
    return Number(result?.content_relevance_percent ?? 0) < VIETNAMESE_REDIRECT_THRESHOLD;
  }
  return Number(result?.score_percent) < VIETNAMESE_REDIRECT_THRESHOLD;
}

export const VIETNAMESE_REDIRECT_VI = 'Minny nghe con nói tiếng Việt — mình thử lại bằng tiếng Anh nhé!';

function vietnameseRedirectResult(checkMode) {
  return {
    ok: true,
    vietnamese_detected: true,
    score_percent: null,
    transcript: '',
    exact_count: 0,
    close_count: 0,
    correct_count: 0,
    total_count: 0,
    words_exact: [],
    words_close: [],
    words_missed: [],
    words_matched: [],
    word_feedback: [],
    feedback_vi: VIETNAMESE_REDIRECT_VI,
    check_mode: checkMode,
  };
}

export async function runSpeakingCheck({
  audioBlob,
  expectedText,
  checkMode = 'read',
  ai = null,
  openaiApiKey,
  fetchFn = fetch,
  stems,
  durationTargetSec,
  telemetry,
  env = null,
  // Grading-honesty packet (2026-07-14): the child's own homework record
  // (codeData.homework, any stored schema version — the caller already has
  // it from the access-code lookup). Only ever consulted for checkMode
  // 'open' (content grounding for a no-reference attempt); read/frame modes
  // ignore it entirely, so omitting it changes nothing for those paths.
  homework = null,
} = {}) {
  // Homework reading: Azure Pronunciation Assessment first (purpose-built,
  // per-word/phoneme scoring — rule 21 reuse). Requires the WAV recording the
  // client sends for read steps; any failure, missing config, or exhausted
  // free tier falls straight through to the local scorer below.
  const isWav = Boolean(audioBlob && /wav/i.test(String(audioBlob.type || '')));
  if (checkMode === 'read' && env && azureSpeechConfigured(env) && isWav) {
    const kv = env.READ2LEAD_CODES;
    if (await azureUnderFreeTier(kv)) {
      try {
        const best = await assessPronunciationWithAzure({
          env,
          audioBlob,
          referenceText: expectedText,
          fetchFn,
        });
        await azureBumpUsage(kv, AZURE_PA_EST_SECONDS_PER_CALL);
        const mapped = mapAzureReadResult(best);
        if (mapped.score_percent < VIETNAMESE_REDIRECT_THRESHOLD && (await detectVietnameseSpeech(audioBlob, ai))) {
          return vietnameseRedirectResult('read');
        }
        return {
          ok: true,
          ...mapped,
          feedback_vi: feedbackVi(mapped.score_percent, mapped.words_missed.length > 0 || mapped.words_close.length > 0),
          check_mode: 'read',
        };
      } catch (err) {
        console.error(`[read2lead-speaking-check] azure PA failed (${err?.message} ${err?.detail || ''}); using local scorer`);
      }
    }
  }

  // Photo-only homework ("photo_talk"): the photo carries the task, so
  // there is no reference text — grade via Azure's unscripted mode (REST
  // caps at 30s/call, so a longer clip is chunked into sequential ≤30s
  // pieces and merged — "The Ear on long clips", grading-honesty packet
  // 2026-07-14). Anything else — Azure down/over tier the whole way through,
  // non-WAV, unparseable WAV — falls through to the normal transcribe + open
  // scorer below. Scripted read grading is untouched.
  if (checkMode === 'open' && expectedText === 'photo_talk' && env && azureSpeechConfigured(env) && isWav) {
    const kv = env.READ2LEAD_CODES;
    let merged = null;
    try {
      const buffer = await audioBlob.arrayBuffer();
      const chunks = splitWavIntoChunks(buffer, 30);
      if (chunks) {
        const successfulChunks = [];
        for (const chunk of chunks) {
          // Hard stop: the meter is checked before EVERY chunk, never just
          // the first — a long clip must not silently overspend the free
          // tier partway through. Denied -> stop chunking (never block the
          // child); whatever chunks already succeeded are still used below.
          // eslint-disable-next-line no-await-in-loop
          if (!(await azureUnderFreeTier(kv, chunk.sampledSeconds))) break;
          try {
            // A transient per-chunk failure (Azure 5xx, timeout) on chunk N
            // must not discard chunks 1..N-1 (revision 2, 2026-07-14 — fixes
            // Buffet's reject finding 2: this used to fall through to a full
            // re-transcription with no vocabulary/Azure evidence, landing in
            // the uncapped pronunciation_effort branch). Same "keep whatever
            // already succeeded" shape as the free-tier `break` above — one
            // code path, both `break` out of this loop and let the merge
            // below run on however many chunks made it.
            // eslint-disable-next-line no-await-in-loop
            const best = await assessPronunciationWithAzure({ env, audioBlob: chunk.wav, referenceText: '', fetchFn });
            // eslint-disable-next-line no-await-in-loop
            await azureBumpUsage(kv, chunk.sampledSeconds);
            successfulChunks.push({ best, sampledSeconds: chunk.sampledSeconds });
          } catch (chunkErr) {
            console.error(`[read2lead-speaking-check] azure unscripted PA chunk failed (${chunkErr?.message} ${chunkErr?.detail || ''}); keeping ${successfulChunks.length} prior chunk(s)`);
            break;
          }
        }
        if (successfulChunks.length) merged = mergeAzureChunkResults(successfulChunks);
      }
    } catch (err) {
      console.error(`[read2lead-speaking-check] azure unscripted PA failed (${err?.message} ${err?.detail || ''}); using open scorer`);
    }

    if (merged) {
      const azureMapped = mapAzureOpenResult(merged);
      const homeworkVocabulary = deriveHomeworkVocabulary(homework);
      const scored = scoreOpenTranscript(azureMapped.transcript, expectedText, {
        homeworkVocabulary,
        azurePronunciationPercent: azureMapped.score_percent,
      });
      const result = {
        ok: true,
        ...scored,
        pronunciation: {
          accuracy_percent: azureMapped.accuracy_percent,
          fluency_percent: azureMapped.fluency_percent,
          scorer: azureMapped.scorer,
          sampled_seconds: merged.sampledSeconds,
        },
        check_mode: 'open',
      };
      if (hasLowContentRelevance(result) && (await detectVietnameseSpeech(audioBlob, ai))) {
        return vietnameseRedirectResult('open');
      }
      return result;
    }
  }

  const transcript = await transcribeAudio(audioBlob, { ai, openaiApiKey, fetchFn });
  if (!transcript) {
    const error = new Error('empty_transcript');
    error.code = 'transcription_failed';
    throw error;
  }

  if (checkMode === 'open') {
    const homeworkVocabulary = OPEN_NO_REFERENCE_SENTINELS.has(expectedText) ? deriveHomeworkVocabulary(homework) : undefined;
    const result = { ok: true, ...scoreOpenTranscript(transcript, expectedText, { homeworkVocabulary }) };
    // Free Talking submits expected_text 'free_talking_no_score' and ignores
    // the score (the conversation LLM handles Vietnamese there) — skip.
    if (
      expectedText !== 'free_talking_no_score'
      && hasLowContentRelevance(result)
      && (await detectVietnameseSpeech(audioBlob, ai))
    ) {
      return vietnameseRedirectResult('open');
    }
    return result;
  }

  if (checkMode === 'frame') {
    const result = scoreSpeechFrame(transcript, stems || [], durationTargetSec || 0, telemetry || {});
    const frameResult = {
      ok: true,
      ...result,
      check_mode: 'frame',
    };

    // Azure pronunciation grading (V1, 2026-07-11), additive only: the
    // deterministic scoreSpeechFrame result above is untouched and remains
    // the source of truth. This only ever ADDS an optional `pronunciation`
    // block on top — reuses the photo_talk unscripted Azure call verbatim,
    // sampling the first 30s (Azure's short-audio REST cap). ANY failure or
    // skip below must leave frameResult byte-identical to today.
    if (env && azureSpeechConfigured(env) && isWav) {
      try {
        const wavBuffer = await audioBlob.arrayBuffer();
        const trimmed = trimWavToSeconds(wavBuffer, 30);
        if (trimmed) {
          const kv = env.READ2LEAD_CODES;
          const sampledSeconds = trimmed.sampledSeconds;
          if (await azureUnderFreeTier(kv, sampledSeconds)) {
            const best = await assessPronunciationWithAzure({
              env,
              audioBlob: trimmed.wav,
              referenceText: '',
              fetchFn,
            });
            await azureBumpUsage(kv, sampledSeconds);
            frameResult.pronunciation = mapAzureFramePronunciation(best, sampledSeconds, SKIP_WORDS);
          }
        }
      } catch (err) {
        console.error(`[read2lead-speaking-check] azure frame PA failed (${err?.message} ${err?.detail || ''}); frame result unaffected`);
      }
    }

    return frameResult;
  }

  const readResult = { ok: true, ...scoreTranscript(expectedText, transcript), check_mode: 'read' };
  if (readResult.score_percent < VIETNAMESE_REDIRECT_THRESHOLD && (await detectVietnameseSpeech(audioBlob, ai))) {
    return vietnameseRedirectResult('read');
  }
  return readResult;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.READ2LEAD_CODES) {
    return json(
      { ok: false, error: 'config_error', message: 'Felixar chua cau hinh ma hoc sinh.' },
      500,
    );
  }

  const openaiApiKey = resolveOpenAIApiKey(env);
  const workersAi = env.AI || null;

  if (!workersAi && !openaiApiKey) {
    return json(
      { ok: false, error: 'config_error', message: 'Speaking check chua duoc cau hinh.' },
      500,
    );
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return json({ ok: false, error: 'invalid_form', message: 'Khong doc duoc du lieu thu am.' }, 400);
  }

  if (formData.get('website')) {
    return json({ ok: true, message: 'Da ghi nhan.' });
  }

  const accessCode = String(formData.get('access_code') || '').trim().toUpperCase();
  const packId = String(formData.get('pack_id') || '').trim();
  const expectedText = String(formData.get('expected_text') || '').trim();
  const checkMode = String(formData.get('check_mode') || 'read').trim().toLowerCase();
  const practiceMode = String(formData.get('practice_mode') || '').trim() === '1';
  const audio = formData.get('audio');

  const clientTelemetry = {
    peak_level: String(formData.get('peak_level') || ''),
    device_label: String(formData.get('device_label') || '').slice(0, 80),
    rec_engine: String(formData.get('rec_engine') || ''),
    rec_mime: String(formData.get('rec_mime') || ''),
    mic_profile: String(formData.get('mic_profile') || ''),
  };

  const reportSilent = String(formData.get('report_silent') || '').trim() === '1';

  if (!accessCode || !packId || (!expectedText && checkMode !== 'frame') || (!audio && !reportSilent)) {
    return json(
      { ok: false, error: 'missing_fields', message: 'Thieu ma hoc sinh, ma bai, noi dung hoac file thu am.' },
      400,
    );
  }

  const maxSeconds = Number(formData.get('max_seconds') || 0);
  const maxAudioBytes = Number.isFinite(maxSeconds) && maxSeconds >= 60
    ? MAX_AUDIO_BYTES_LONG
    : MAX_AUDIO_BYTES;

  const audioSize = audio && typeof audio.size === 'number' ? audio.size : 0;
  if (audioSize > maxAudioBytes) {
    return json(
      {
        ok: false,
        error: 'audio_too_large',
        message: 'File thu am qua lon. Con thu lai voi doan ngan hon nhe!',
      },
      413,
    );
  }

  const clientIp = getClientIp(request);
  const rateLimit = await checkCodeRateLimit(env.READ2LEAD_CODES, clientIp);
  if (rateLimit.blocked) {
    return rateLimitedResponse(rateLimit.retryAfter);
  }

  const codeData = await env.READ2LEAD_CODES.get(accessCode, { type: 'json' });
  if (!codeData) {
    await recordCodeFailure(env.READ2LEAD_CODES, clientIp);
    return json({ ok: false, error: 'code_not_found', message: 'Ma hoc sinh khong ton tai.' }, 404);
  }

  if (reportSilent) {
    await recordSpeakingError(env, {
      ts: new Date().toISOString(),
      code: 'silent_capture',
      message: 'client_detected_silence',
      ...clientTelemetry,
      ua: (request.headers.get('user-agent') || '').slice(0, 200),
      access_code: accessCode,
    });
    return json({ ok: true, recorded: true });
  }

  if (!audio) {
    return json(
      { ok: false, error: 'missing_fields', message: 'Thieu file thu am.' },
      400,
    );
  }

  const currentPack = codeData.progress?.current_pack;
  const packAllowed = practiceMode
    ? canAccessPackForPractice(codeData, packId)
    : Boolean(currentPack && currentPack.pack_id === packId);
  if (!packAllowed) {
    return json(
      { ok: false, error: 'pack_not_found', message: 'Khong tim thay bai nay trong ma hoc sinh.' },
      404,
    );
  }

  const audioName = audio?.name || 'unknown';
  const audioType = audio?.type || 'unknown';

  let stems = [];
  let durationTargetSec = 0;
  let durationSec = undefined;
  if (checkMode === 'frame') {
    const stemsRaw = formData.get('stems');
    if (stemsRaw) {
      try {
        stems = JSON.parse(stemsRaw);
      } catch {}
    }
    durationTargetSec = Number(formData.get('max_seconds') || 0);
    const durRaw = formData.get('duration_seconds');
    if (durRaw !== null && durRaw !== '') {
      const parsed = parseFloat(durRaw);
      if (Number.isFinite(parsed)) durationSec = parsed;
    }
  }

  try {
    const result = await runSpeakingCheck({
      audioBlob: audio,
      expectedText,
      checkMode: checkMode === 'open' ? 'open' : (checkMode === 'frame' ? 'frame' : 'read'),
      ai: workersAi,
      openaiApiKey,
      stems,
      durationTargetSec,
      telemetry: { ...clientTelemetry, duration_seconds: durationSec },
      env,
      homework: codeData.homework,
    });

    // V1 word-level feedback (2026-07-12): best-effort, short-TTL record of
    // this attempt's practice words so minny-voice's `word` branch can allow
    // a tap-to-hear request for exactly these words and nothing else. Never
    // blocks the response — a KV hiccup here must not fail a scored attempt.
    // Hoisted to an outer `let` (V1.3 fix round, 2026-07-12) so the coach
    // feedback step below can merge its own focus_word into the same
    // in-memory list instead of re-fetching the record it just wrote.
    let flaggedWords = [];
    try {
      flaggedWords = collectFlaggedWords(result);
      if (flaggedWords.length) {
        await env.READ2LEAD_CODES.put(
          `flagged-words:${accessCode}`,
          JSON.stringify({ words: flaggedWords, at: Date.now() }),
          { expirationTtl: 3600 },
        );
      }
    } catch {
      /* best-effort; must never block the response */
    }

    // V1.3 homework feedback sandwich (2026-07-12, founder gate: Phương ack
    // via AskUserQuestion). Best-effort, additive only — every step below is
    // wrapped so ANY failure (no key, not a homework attempt, LLM
    // error/timeout/parse, ungrounded claim, guardrail flag) leaves `result`
    // exactly as computed above; only a clean pass ever adds `result.coach`.
    try {
      const feedbackEligible = codeData.homework && (
        result.check_mode === 'read'
        || result.check_mode === 'frame'
        || (result.check_mode === 'open' && expectedText === 'photo_talk')
      );
      if (env.OPENROUTER_API_KEY && feedbackEligible) {
        const azure = result.pronunciation && typeof result.pronunciation === 'object'
          ? result.pronunciation
          : (typeof result.accuracy_percent === 'number'
            ? { accuracy_percent: result.accuracy_percent, fluency_percent: result.fluency_percent }
            : null);
        const context = buildFeedbackContext({
          checkMode: result.check_mode,
          result,
          transcript: result.transcript || '',
          homework: codeData.homework,
          azure,
          skipWords: SKIP_WORDS,
        });
        const feedback = await generateHomeworkFeedback({ env, context, skipWords: SKIP_WORDS });
        if (feedback) {
          // Screen every string of the feedback through the same guardrail
          // stack minny-conversation.js runs on the kid-visible surface
          // (surfaceExtras pattern): deterministic shape/character/topic
          // checks first, then the Llama Guard ML backstop on the
          // concatenated text. Fail-open only on guard `degraded`
          // (infra outage — the deterministic gate already passed); reject
          // on a genuine `flagged` verdict.
          const feedbackStrings = [
            feedback.praise_vi, feedback.focus_word, feedback.model_sentence_en,
            feedback.tiny_challenge_vi, ...(feedback.recast_en ? [feedback.recast_en] : []),
          ];
          const shapeFlag = feedbackStrings.map((s) => validateReplyShape(s)).find((r) => r.flagged);
          const feedbackText = feedbackStrings.join('\n');
          const characterFlag = detectCharacterBreak(feedbackText);
          const topicFlag = scanBannedTopics(feedbackText);
          const deterministicFlag = Boolean(shapeFlag) || characterFlag.flagged || topicFlag.flagged;
          if (!deterministicFlag) {
            const guardResult = await screenWithLlamaGuard(workersAi, feedbackText, result.transcript || '');
            if (!guardResult.flagged) {
              result.coach = feedback;

              // V1.3 fix round (2026-07-12, Steve's UI review): focus_word
              // gets the same tap-to-hear treatment as any other practice
              // chip, but minny-voice's `word` branch only allows words
              // present in the flagged-words:<code> record. On the
              // kid-did-great path, allowed_focus_words fell back to
              // homework content words instead of anything actually
              // flagged, so focus_word was never written above — merge it
              // in now. Safe to allow: focus_word is only ever set from the
              // SAME allowed_focus_words set validateFeedbackGrounding just
              // enforced membership against, never an arbitrary word.
              //
              // Grading-honesty packet (2026-07-14): the coach's own
              // model_sentence_en is a NOVEL sentence the model composed
              // (never derivable from the static homework record, unlike
              // deriveHomeworkTapAllowlist's static sentences), so it needs
              // its own short-TTL allowlist entry too — persisted here
              // alongside the word merge so minny-voice's `text` branch can
              // allow tapping the coach's sentence. This is why the write
              // below now also fires when focus_word was already flagged:
              // the sentence itself is still new information either way.
              try {
                const normalizedFocus = normalizePracticeWord(feedback.focus_word);
                const modelSentence = typeof feedback.model_sentence_en === 'string' ? feedback.model_sentence_en.trim() : '';
                const needsWordMerge = normalizedFocus && !flaggedWords.includes(normalizedFocus);
                if (needsWordMerge || modelSentence) {
                  const mergedWords = needsWordMerge ? [...flaggedWords, normalizedFocus] : flaggedWords;
                  await env.READ2LEAD_CODES.put(
                    `flagged-words:${accessCode}`,
                    JSON.stringify({
                      words: mergedWords,
                      sentences: modelSentence ? [modelSentence] : [],
                      at: Date.now(),
                    }),
                    { expirationTtl: 3600 },
                  );
                }
              } catch {
                /* best-effort; must never block the response */
              }
            }
          }
        }
      }
    } catch {
      /* best-effort; must never block or alter the deterministic response */
    }

    return json(result);
  } catch (error) {
    console.error(`[read2lead-speaking-check] ${error?.message} | file=${audioName} type=${audioType} size=${audioSize}`, error?.detail || '');
    await recordSpeakingError(env, {
      ts: new Date().toISOString(),
      code: error?.code || null,
      message: error?.message || null,
      api_status: error?.status || null,
      type: audioType,
      size: audioSize,
      file: audioName,
      ...clientTelemetry,
      detail: String(error?.detail || '').slice(0, 300),
      ua: (request.headers.get('user-agent') || '').slice(0, 200),
      access_code: accessCode,
    });
    if (error?.code === 'transcription_timeout') {
      return json(
        {
          ok: false,
          error: 'transcription_timeout',
          message: 'Mang hoi cham, Minny cham chua kip. Con bam Thu lai nhe!',
        },
        504,
      );
    }
    const apiStatus = Number(error?.status) || 0;
    // Quota (429) and provider 5xx are outages too — the kid DID speak; the
    // scoring machine failed. Never turn those into "đọc to hơn".
    const asrOutage = apiStatus === 401 || apiStatus === 403 || apiStatus === 429
      || apiStatus >= 500
      || error?.code === 'transcription_timeout'
      || error?.code === 'config_error';
    const outageMessage = 'Minny nghe con nói rồi, nhưng hôm nay máy chưa chấm điểm được — con bấm Tiếp tục xuống dưới nhé!';
    const retryMessage = 'Khong nghe duoc ro. Con thu doc to hon nhe!';

    if (
      error?.code === 'transcription_failed'
      || error?.message === 'openai_transcription_failed'
    ) {
      return json(
        {
          ok: false,
          error: 'transcription_failed',
          asr_outage: asrOutage,
          message: asrOutage ? outageMessage : retryMessage,
          _debug_file: audioName,
          _debug_type: audioType,
          _debug_size: audioSize,
        },
        422,
      );
    }
    return json(
      {
        ok: false,
        error: 'internal_error',
        asr_outage: asrOutage,
        message: asrOutage ? outageMessage : retryMessage,
        _debug_file: audioName,
        _debug_type: audioType,
        _debug_size: audioSize,
      },
      500,
    );
  }
}

// V1 word-level feedback fix round (2026-07-12, Elon ruling): strips
// anything outside minny-voice's own allowlisted character class ([a-z'-])
// after lowercasing, so a word carrying the original sentence's punctuation
// (e.g. scoreTranscript's raw "banana.") still lands in the flagged-words
// record as exactly the string minny-voice's `/^[a-z''-]{1,30}$/` regex will
// accept ("banana") — speak-up.astro's tap handler applies this identical
// normalization to a chip's word before tapping it, so what a kid taps is
// exactly what the server allowlisted. Returns '' (dropped by the caller)
// for anything that becomes empty or exceeds minny-voice's 30-char cap once
// stripped (e.g. an ASR artifact like "...").
export function normalizePracticeWord(raw) {
  const cleaned = String(raw || '').toLowerCase().replace(/[^a-z'-]/g, '');
  return cleaned.length >= 1 && cleaned.length <= 30 ? cleaned : '';
}

// Collects practice words from whichever shape the speaking-check result
// carries (V1 word-level feedback, 2026-07-12): read mode's
// words_missed/words_close (scoreTranscript's raw-case strings, or Azure's
// already-lowercase mapAzureReadResult strings) and frame mode's optional
// Azure pronunciation.words[] ({word, accuracy_percent} objects). Pure and
// defensive — normalizes either shape via normalizePracticeWord, never throws.
export function collectFlaggedWords(result) {
  const words = new Set();
  const addAll = (list) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      const raw = entry && typeof entry === 'object' ? entry.word : entry;
      const normalized = normalizePracticeWord(raw);
      if (normalized) words.add(normalized);
    }
  };
  addAll(result?.words_missed);
  addAll(result?.words_close);
  addAll(result?.pronunciation?.words);
  return [...words];
}

async function recordSpeakingError(env, record) {
  try {
    if (!env.READ2LEAD_CODES) return;
    const KEY = 'debug:speaking-errors';
    const existing = await env.READ2LEAD_CODES.get(KEY, { type: 'json' });
    const ring = Array.isArray(existing) ? existing : [];
    ring.unshift(record);
    await env.READ2LEAD_CODES.put(KEY, JSON.stringify(ring.slice(0, 40)), { expirationTtl: 172800 });
  } catch {
    /* diagnostics are best-effort; never break the response */
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
