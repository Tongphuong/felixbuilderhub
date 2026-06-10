import { getClientIp, checkCodeRateLimit, recordCodeFailure, rateLimitedResponse } from './_rate-limit.js';
import { canAccessPackForPractice } from './_read2lead-pack-access.js';

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
    .map((word) => normalizeWord(word))
    .filter(Boolean);

  const used = new Set();
  let correct = 0;
  let close = 0;
  const wordsMissed = [];
  const wordsClose = [];
  const wordsExact = [];

  for (const expectedWord of expectedWords) {
    let bestIndex = -1;
    let bestSimilarity = 0;

    for (let index = 0; index < transcriptWords.length; index += 1) {
      if (used.has(index)) continue;
      const similarity = wordSimilarity(expectedWord.norm, transcriptWords[index]);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0 && bestSimilarity >= SIMILARITY_THRESHOLD) {
      used.add(bestIndex);
      correct += 1;
      wordsExact.push(expectedWord.raw);
    } else if (bestIndex >= 0 && bestSimilarity >= CLOSE_THRESHOLD) {
      used.add(bestIndex);
      close += 1;
      wordsClose.push(expectedWord.raw);
    } else {
      wordsMissed.push(expectedWord.raw);
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
    feedback_vi: feedbackVi(scorePercent),
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

export const GROQ_TIMEOUT_MS = 20000;

export async function transcribeWithGroq(audioBlob, apiKey, fetchFn = fetch) {
  const filename = inferAudioFilename(audioBlob);
  const formData = new FormData();
  formData.append('file', audioBlob, filename);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'en');
  formData.append('response_format', 'json');

  // Cap the Groq call so a slow upstream cannot hang the whole Worker (Vietnam 3G).
  let response;
  try {
    response = await fetchFn('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      const error = new Error('groq_timeout');
      error.code = 'transcription_timeout';
      throw error;
    }
    throw err;
  }

  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch {}
    console.error(`[groq-whisper] ${response.status} ${filename}:`, detail);
    const error = new Error('groq_transcription_failed');
    error.status = response.status;
    error.detail = detail;
    throw error;
  }

  const payload = await response.json();
  return String(payload?.text || '').trim();
}

export async function runSpeakingCheck({
  audioBlob,
  expectedText,
  checkMode = 'read',
  groqApiKey,
  fetchFn = fetch,
}) {
  const transcript = await transcribeWithGroq(audioBlob, groqApiKey, fetchFn);
  if (!transcript) {
    const error = new Error('empty_transcript');
    error.code = 'transcription_failed';
    throw error;
  }

  if (checkMode === 'open') {
    return {
      ok: true,
      ...scoreOpenTranscript(transcript, expectedText),
    };
  }

  return {
    ok: true,
    ...scoreTranscript(expectedText, transcript),
    check_mode: 'read',
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.READ2LEAD_CODES) {
    return json(
      { ok: false, error: 'config_error', message: 'Felixar chua cau hinh ma hoc sinh.' },
      500,
    );
  }

  if (!env.GROQ_API_KEY) {
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

  if (!accessCode || !packId || !expectedText || !audio) {
    return json(
      { ok: false, error: 'missing_fields', message: 'Thieu ma hoc sinh, ma bai, noi dung hoac file thu am.' },
      400,
    );
  }

  const maxSeconds = Number(formData.get('max_seconds') || 0);
  const maxAudioBytes = Number.isFinite(maxSeconds) && maxSeconds >= 60
    ? MAX_AUDIO_BYTES_LONG
    : MAX_AUDIO_BYTES;

  const audioSize = typeof audio.size === 'number' ? audio.size : 0;
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

  try {
    const result = await runSpeakingCheck({
      audioBlob: audio,
      expectedText,
      checkMode: checkMode === 'open' ? 'open' : 'read',
      groqApiKey: env.GROQ_API_KEY,
    });
    return json(result);
  } catch (error) {
    console.error(`[read2lead-speaking-check] ${error?.message} | file=${audioName} type=${audioType} size=${audioSize}`, error?.detail || '');
    await recordSpeakingError(env, {
      ts: new Date().toISOString(),
      code: error?.code || null,
      message: error?.message || null,
      groq_status: error?.status || null,
      type: audioType,
      size: audioSize,
      file: audioName,
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
    if (error?.code === 'transcription_failed' || error?.message === 'groq_transcription_failed') {
      return json(
        {
          ok: false,
          error: 'transcription_failed',
          message: 'Khong nghe duoc ro. Con thu doc to hon nhe!',
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
        message: 'Khong nghe duoc ro. Con thu doc to hon nhe!',
        _debug_file: audioName,
        _debug_type: audioType,
        _debug_size: audioSize,
      },
      500,
    );
  }
}

// Best-effort diagnostic ring buffer (read with: wrangler kv key get debug:speaking-errors).
// Captures every speaking-check failure with audio type/size + Groq status, so errors that
// happen anytime can be diagnosed later without a live tail. Never throws into the response.
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
