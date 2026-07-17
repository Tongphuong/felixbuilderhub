/**
 * Client-side shadowing scorer — ports the read-aloud matching engine out of
 * `functions/api/read2lead-speaking-check.js` (normalizeWord, tokenize,
 * wordSimilarity, levenshteinDistance, SKIP_WORDS, CLOSE_SCORE_WEIGHT,
 * SIMILARITY_THRESHOLD, CLOSE_THRESHOLD, scoreTranscript) so the Shadowing
 * page can light up words live in the browser while a sentence is being
 * recorded, and so the offline prep tool can sanity-check content. Final
 * GRADING for Shadowing still happens server-side against the existing
 * Whisper endpoint (not this file) — this module is the live/interim
 * preview + the numeric parity surface, never the record of truth.
 *
 * Zero imports, plain ESM: runs unmodified in the browser via Vite and under
 * `node --test`. Ported fields keep IDENTICAL numeric/count semantics to the
 * server module (see tests/shadowing-score.test.mjs's parity test, which
 * imports both and diffs them on ~30 fixtures) — the only intentional
 * difference is DROPPING the server's baked-in Vietnamese `feedback_vi`
 * copy (both the top-level field and each word_feedback entry's), since the
 * Shadowing page owns its own UI copy. Every numeric field, count, and
 * per-word `status` is unchanged.
 *
 * Reuse survey (rule 21): this is a PORT of already-shipped, already
 * externally-unavailable in-house logic (functions/api/read2lead-speaking-
 * check.js's word matcher), not a new capability — there is no external
 * OSS/library survey to run for "make this exact function importable from
 * the browser too." N/A — porting existing approved logic to a second
 * runtime, not building new capability.
 */

export const SKIP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'at',
]);

export const CLOSE_SCORE_WEIGHT = 0.5;
export const SIMILARITY_THRESHOLD = 0.75;
export const CLOSE_THRESHOLD = 0.5;

// Shadowing-specific: a sentence attempt passes at >=50% word match (spec
// SPEC_SPEAKUP_SHADOWING.md). Not present in the server module (its pass
// bar lives in the graded-rewards table, a different scale) — new to this
// port, not a divergence from anything being copied verbatim.
export const PASS_PERCENT = 50;

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

export function levenshteinDistance(a, b) {
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

export function tokenize(text) {
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
  };
}

// ---------------------------------------------------------------------------
// lightWords — live karaoke word-lighting for an in-progress recording.
// ---------------------------------------------------------------------------
//
// Pure function of (expectedText, interimTranscript) — no hidden state, safe
// to call on every interim Web Speech / ASR update; the caller just re-runs
// it with the latest interim string each time. Returns one entry per
// EXPECTED word (unlike scoreTranscript, which drops SKIP_WORDS from its
// matched set — lightWords must still show every word from the sentence on
// screen, filler words included).
//
// Matching rule for CONTENT words (not in SKIP_WORDS): identical
// tokenize/normalizeWord/wordSimilarity + SIMILARITY_THRESHOLD/
// CLOSE_THRESHOLD greedy alignment as scoreTranscript, run only over the
// content-word subsequence in order, so a settled 'exact'/'close' call here
// is always a call scoreTranscript would also make once the transcript is
// final. No match yet (interim transcript hasn't produced a good enough
// candidate) -> 'pending' (there is no 'missed' state mid-recording; only
// the final scoreTranscript call can decide a word was missed).
//
// Matching rule for SKIP_WORDS (a/an/the/is/are/...): these are exactly the
// short function words live ASR interim results most often drop or garble,
// so requiring a direct hit would leave them stuck on 'pending' even once
// the sentence around them is clearly being read correctly. Kept simple and
// deterministic: a SKIP_WORD lights 'exact' the moment EITHER (a) any
// transcript word (the full interim transcript, not filtered by what
// content-word matching has consumed) normalizes to it exactly (a direct
// loose hit), OR (b) its nearest neighboring CONTENT word
// (scanning outward, skipping over other SKIP_WORDS) has already settled to
// 'exact' or 'close' — i.e. filler-word credit propagates from the content
// word next to it. Otherwise 'pending'. This never feeds back into or
// consumes slots from the content-word alignment above, so it cannot change
// what scoreTranscript would compute.
export function lightWords(expectedText, interimTranscript) {
  const expectedWords = tokenize(expectedText).map((word) => ({ raw: word, norm: normalizeWord(word) }));
  const transcriptWords = tokenize(interimTranscript)
    .map((word) => normalizeWord(word))
    .filter(Boolean);

  const used = new Set();
  const contentStatus = new Map();

  expectedWords.forEach((word, idx) => {
    if (!word.norm || SKIP_WORDS.has(word.norm)) return;
    let bestIndex = -1;
    let bestSimilarity = 0;
    for (let i = 0; i < transcriptWords.length; i += 1) {
      if (used.has(i)) continue;
      const similarity = wordSimilarity(word.norm, transcriptWords[i]);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0 && bestSimilarity >= SIMILARITY_THRESHOLD) {
      used.add(bestIndex);
      contentStatus.set(idx, 'exact');
    } else if (bestIndex >= 0 && bestSimilarity >= CLOSE_THRESHOLD) {
      used.add(bestIndex);
      contentStatus.set(idx, 'close');
    } else {
      contentStatus.set(idx, 'pending');
    }
  });

  const transcriptSet = new Set(transcriptWords);

  function nearestContentStatus(fromIdx, direction) {
    for (let i = fromIdx + direction; i >= 0 && i < expectedWords.length; i += direction) {
      const w = expectedWords[i];
      if (!w.norm || SKIP_WORDS.has(w.norm)) continue;
      return contentStatus.get(i) || 'pending';
    }
    return null;
  }

  return expectedWords.map((word, idx) => {
    if (!word.norm) return { raw: word.raw, status: 'pending' };
    if (!SKIP_WORDS.has(word.norm)) {
      return { raw: word.raw, status: contentStatus.get(idx) || 'pending' };
    }
    const directHit = transcriptSet.has(word.norm);
    const prev = nearestContentStatus(idx, -1);
    const next = nearestContentStatus(idx, +1);
    const neighborLit = prev === 'exact' || prev === 'close' || next === 'exact' || next === 'close';
    return { raw: word.raw, status: directHit || neighborLit ? 'exact' : 'pending' };
  });
}
