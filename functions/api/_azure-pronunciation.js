// Azure AI Speech — Pronunciation Assessment for homework reading steps.
//
// Reuse-first (AGENTS.md rule 21): purpose-built pronunciation scoring for
// language learners (per-word + per-phoneme accuracy, fluency, completeness,
// miscue detection against a reference sentence) instead of our homemade
// Levenshtein word-matcher. Free F0 tier = 5 audio-hours/month; usage is
// hard-capped below so the default budget stays USD 0 — beyond the cap the
// caller falls back to the local scorer.
//
// Plain REST (no SDK): POST WAV PCM 16k mono (≤30s) to the short-audio
// endpoint with a Base64 JSON `Pronunciation-Assessment` header.
// Docs: learn.microsoft.com/azure/ai-services/speech-service/rest-speech-to-text-short

export const AZURE_PA_TIMEOUT_MS = 15000;
export const AZURE_PA_MONTHLY_FREE_SECONDS = 5 * 3600; // F0 tier: 5 audio hours
export const AZURE_PA_EST_SECONDS_PER_CALL = 30; // read steps cap at 30s

// Unscripted (no reference text) grading goes through the same short-audio
// REST endpoint, which caps at 30s. WAV PCM 16k mono is 32000 bytes/s.
export const AZURE_PA_UNSCRIPTED_MAX_WAV_BYTES = 30 * 32000 + 44;

export function azureSpeechConfigured(env = {}) {
  return Boolean(env.AZURE_SPEECH_KEY && env.AZURE_SPEECH_REGION);
}

export function azureUsageKey(now = new Date()) {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return `azure-pa-secs:${month}`;
}

export async function azureUnderFreeTier(kv, estSeconds = AZURE_PA_EST_SECONDS_PER_CALL, now = new Date()) {
  if (!kv) return false;
  try {
    const used = Number(await kv.get(azureUsageKey(now), { type: 'json' })) || 0;
    return used + estSeconds <= AZURE_PA_MONTHLY_FREE_SECONDS;
  } catch {
    return false; // if we cannot read the meter, do not spend
  }
}

export async function azureBumpUsage(kv, seconds = AZURE_PA_EST_SECONDS_PER_CALL, now = new Date()) {
  if (!kv) return;
  try {
    const key = azureUsageKey(now);
    const used = Number(await kv.get(key, { type: 'json' })) || 0;
    // 40-day TTL: the counter outlives its month, then expires on its own.
    await kv.put(key, JSON.stringify(used + seconds), { expirationTtl: 40 * 24 * 3600 });
  } catch {
    // metering is best-effort; a failed bump must never fail the check
  }
}

export async function assessPronunciationWithAzure({ env, audioBlob, referenceText, fetchFn = fetch }) {
  const region = String(env.AZURE_SPEECH_REGION || '').trim();
  const key = String(env.AZURE_SPEECH_KEY || '').trim();
  // Scripted mode compares against referenceText; unscripted mode (empty
  // referenceText) grades pronunciation of whatever was said — Microsoft's
  // "Speaking scenario". Miscue only makes sense with a reference.
  const paParams = {
    GradingSystem: 'HundredMark',
    Granularity: 'Phoneme',
    Dimension: 'Comprehensive',
  };
  if (referenceText) {
    paParams.ReferenceText = referenceText;
    paParams.EnableMiscue = true;
  } else {
    paParams.EnableMiscue = false;
  }
  const paJson = JSON.stringify(paParams);
  // btoa alone throws on non-Latin1 chars (curly quotes, Vietnamese
  // diacritics) — encode the UTF-8 bytes instead.
  const paHeader = btoa(String.fromCharCode(...new TextEncoder().encode(paJson)));
  const url = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;

  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
      'Pronunciation-Assessment': paHeader,
      Accept: 'application/json',
    },
    body: audioBlob,
    signal: AbortSignal.timeout(AZURE_PA_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = new Error('azure_pa_failed');
    error.status = response.status;
    try {
      error.detail = (await response.text()).slice(0, 300);
    } catch {
      // ignore
    }
    throw error;
  }

  const payload = await response.json();
  const best = payload && payload.RecognitionStatus === 'Success' && Array.isArray(payload.NBest)
    ? payload.NBest[0]
    : null;
  if (!best || !Number.isFinite(Number(best.PronScore))) {
    const error = new Error('azure_pa_no_result');
    error.detail = String(payload?.RecognitionStatus || 'no_nbest');
    throw error;
  }
  return best;
}

const EXACT_ACCURACY = 85;
const CLOSE_ACCURACY = 60;

// Maps Azure's NBest[0] assessment onto the exact response shape the client
// already renders for check_mode 'read' (same fields as the local scorer),
// so no client change is needed. Insertions are excluded from the counts —
// chips describe the expected sentence, not extra words.
export function mapAzureReadResult(best) {
  const words = Array.isArray(best.Words) ? best.Words : [];
  const wordsExact = [];
  const wordsClose = [];
  const wordsMissed = [];
  const wordFeedback = [];

  for (const w of words) {
    const errorType = String(w.ErrorType || 'None');
    if (errorType === 'Insertion') continue;
    const word = String(w.Word || '').toLowerCase();
    if (!word) continue;
    const accuracy = Number(w.AccuracyScore);

    let status;
    if (errorType === 'Omission') {
      status = 'missed';
    } else if (Number.isFinite(accuracy) && accuracy >= EXACT_ACCURACY) {
      status = 'exact';
    } else if (Number.isFinite(accuracy) && accuracy >= CLOSE_ACCURACY) {
      status = 'close';
    } else {
      status = 'missed';
    }

    if (status === 'exact') wordsExact.push(word);
    else if (status === 'close') wordsClose.push(word);
    else wordsMissed.push(word);

    wordFeedback.push({
      expected: word,
      spoken: status === 'missed' && errorType === 'Omission' ? null : word,
      status,
      similarity: Number.isFinite(accuracy) ? Math.round(accuracy) / 100 : 0,
      feedback_vi: status === 'exact'
        ? `Con đọc "${word}" rõ rồi.`
        : `Con luyện thêm từ "${word}" nhé.`,
    });
  }

  const total = wordFeedback.length;
  return {
    transcript: String(best.Display || '').trim(),
    score_percent: Math.round(Number(best.PronScore)),
    accuracy_percent: Number.isFinite(Number(best.AccuracyScore)) ? Math.round(Number(best.AccuracyScore)) : null,
    fluency_percent: Number.isFinite(Number(best.FluencyScore)) ? Math.round(Number(best.FluencyScore)) : null,
    completeness_percent: Number.isFinite(Number(best.CompletenessScore)) ? Math.round(Number(best.CompletenessScore)) : null,
    scorer: 'azure_pronunciation',
    exact_count: wordsExact.length,
    close_count: wordsClose.length,
    correct_count: wordsExact.length + wordsClose.length,
    total_count: total,
    words_exact: wordsExact,
    words_close: wordsClose,
    words_missed: wordsMissed,
    word_feedback: wordFeedback,
  };
}

// Maps Azure's unscripted assessment onto the open-result client contract
// (feedback_vi and check_mode are composed by the caller).
export function mapAzureOpenResult(best) {
  const round = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
  return {
    transcript: String(best.Display || '').trim(),
    score_percent: round(best.PronScore) ?? 0,
    accuracy_percent: round(best.AccuracyScore),
    fluency_percent: round(best.FluencyScore),
    scorer: 'azure_pronunciation_unscripted',
    correct_count: 0,
    total_count: 1,
    words_missed: [],
    words_close: [],
    words_matched: [],
  };
}
