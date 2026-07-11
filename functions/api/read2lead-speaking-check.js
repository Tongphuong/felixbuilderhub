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
  AZURE_PA_EST_SECONDS_PER_CALL,
  AZURE_PA_UNSCRIPTED_MAX_WAV_BYTES,
} from './_azure-pronunciation.js';

export const SKIP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'at',
]);

export const CLOSE_SCORE_WEIGHT = 0.5;
export const SIMILARITY_THRESHOLD = 0.75;
export const CLOSE_THRESHOLD = 0.5;
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
export const MAX_AUDIO_BYTES_LONG = 10 * 1024 * 1024;

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
    feedback_vi: feedbackVi(scorePercent),
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

export function feedbackVi(scorePercent) {
  if (scorePercent >= 90) return 'Tuyệt vời! Con đọc cực kỳ rõ ràng!';
  if (scorePercent >= 70) return 'Giỏi lắm! Con đọc được hầu hết các từ rồi!';
  if (scorePercent >= 50) return 'Cố lên! Con đang tiến bộ rất tốt!';
  return 'Không sao, thử lại nào! Đọc to hơn một chút nhé!';
}

export function feedbackOpenVi(scorePercent) {
  if (scorePercent >= 80) return 'Hay quá! Con kể và suy nghĩ về truyện rất tốt!';
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

export function scoreOpenTranscript(transcript, storyContext) {
  const transcriptWords = tokenize(transcript)
    .map((word) => normalizeWord(word))
    .filter(Boolean);
  const spokenCount = transcriptWords.length;
  const keywords = extractStoryKeywords(storyContext);
  const wordsMatched = [];

  for (const keyword of keywords) {
    const norm = normalizeWord(keyword);
    const hit = transcriptWords.some((spoken) => wordSimilarity(spoken, norm) >= SIMILARITY_THRESHOLD);
    if (hit) wordsMatched.push(keyword);
  }

  const effortScore = Math.min(100, Math.round((spokenCount / 10) * 100));
  const relevanceScore = keywords.length
    ? Math.round((wordsMatched.length / keywords.length) * 100)
    : Math.min(100, effortScore);
  const scorePercent = Math.round(effortScore * 0.45 + relevanceScore * 0.55);

  return {
    transcript: String(transcript || '').trim(),
    score_percent: scorePercent,
    correct_count: wordsMatched.length,
    total_count: Math.max(keywords.length, 1),
    words_missed: [],
    words_close: [],
    words_matched: wordsMatched,
    feedback_vi: feedbackOpenVi(scorePercent),
    check_mode: 'open',
  };
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
      return { id: stem.id, text_en: stem.text_en, matched: true, coveragePct: 100 };
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
          feedback_vi: feedbackVi(mapped.score_percent),
          check_mode: 'read',
        };
      } catch (err) {
        console.error(`[read2lead-speaking-check] azure PA failed (${err?.message} ${err?.detail || ''}); using local scorer`);
      }
    }
  }

  // Photo-only homework ("photo_talk"): the photo carries the task, so
  // there is no reference text — grade pronunciation-only via Azure's
  // unscripted mode (REST caps at 30s of audio). Anything else — longer
  // clips, Azure down/over tier, non-WAV — falls through to the normal
  // transcribe + open scorer below. Scripted read grading is untouched.
  if (
    checkMode === 'open'
    && expectedText === 'photo_talk'
    && env && azureSpeechConfigured(env) && isWav
    && audioBlob.size <= AZURE_PA_UNSCRIPTED_MAX_WAV_BYTES
  ) {
    const kv = env.READ2LEAD_CODES;
    if (await azureUnderFreeTier(kv)) {
      try {
        const best = await assessPronunciationWithAzure({
          env,
          audioBlob,
          referenceText: '',
          fetchFn,
        });
        await azureBumpUsage(kv, AZURE_PA_EST_SECONDS_PER_CALL);
        const mapped = mapAzureOpenResult(best);
        return {
          ok: true,
          ...mapped,
          feedback_vi: feedbackOpenVi(mapped.score_percent),
          check_mode: 'open',
        };
      } catch (err) {
        console.error(`[read2lead-speaking-check] azure unscripted PA failed (${err?.message} ${err?.detail || ''}); using open scorer`);
      }
    }
  }

  const transcript = await transcribeAudio(audioBlob, { ai, openaiApiKey, fetchFn });
  if (!transcript) {
    const error = new Error('empty_transcript');
    error.code = 'transcription_failed';
    throw error;
  }

  if (checkMode === 'open') {
    const result = { ok: true, ...scoreOpenTranscript(transcript, expectedText) };
    // Free Talking submits expected_text 'free_talking_no_score' and ignores
    // the score (the conversation LLM handles Vietnamese there) — skip.
    if (
      expectedText !== 'free_talking_no_score'
      && result.score_percent < VIETNAMESE_REDIRECT_THRESHOLD
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
            frameResult.pronunciation = mapAzureFramePronunciation(best, sampledSeconds);
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
    });
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
