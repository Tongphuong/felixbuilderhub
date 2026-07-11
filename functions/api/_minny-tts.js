export function resolveOpenAiApiKey(env = {}) {
  return String(env.OPENAI_API_KEY || env.READ2LEAD_OPENAI_API_KEY || '').trim();
}

// Minny's voice runs on Cloudflare Workers AI via the `env.AI` binding — the
// same binding Whisper transcription and the Llama fallback already use. No
// API key, no per-environment secret, so the preview can never silently fall
// back to the browser robot voice again (the 2026-07-06 failure: tts-1-hd
// behind an OpenAI key that the Preview environment never had).
//
// Chain: Aura-2 (primary) → MeloTTS (free fallback) → OpenAI (only when the
// AI binding is absent, e.g. plain node tests). Engine/voice live in the two
// constants below — switching Minny's voice is a one-line change.
export const TTS_ENGINE = 'aura2';
export const TTS_VOICE = 'luna'; // Aura-2 speaker; 40 options, see model docs

export const AURA2_MODEL = '@cf/deepgram/aura-2-en';
export const MELOTTS_MODEL = '@cf/myshell-ai/melotts';

export const TTS_TIMEOUT_MS = 8000;
export const TTS_MODEL = 'tts-1-hd'; // OpenAI last-resort path only
export const OPENAI_TTS_VOICE = 'nova';

export async function ttsCacheKey(text, voice = TTS_VOICE, engine = TTS_ENGINE) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `tts:${engine}:${voice}:${hex}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(label);
      err.code = 'tts_timeout';
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function synthesizeWithAura2(ai, text, voice = TTS_VOICE) {
  const stream = await withTimeout(
    ai.run(AURA2_MODEL, { text, speaker: voice, encoding: 'mp3' }),
    TTS_TIMEOUT_MS,
    'aura2_tts_timeout',
  );
  const buffer = await new Response(stream).arrayBuffer();
  if (!buffer || buffer.byteLength === 0) {
    throw new Error('aura2_tts_empty');
  }
  return { audio_b64: arrayBufferToBase64(buffer), content_type: 'audio/mpeg' };
}

export async function synthesizeWithMeloTTS(ai, text) {
  const result = await withTimeout(
    ai.run(MELOTTS_MODEL, { prompt: text, lang: 'en' }),
    TTS_TIMEOUT_MS,
    'melotts_timeout',
  );
  const audio = result && result.audio;
  if (!audio) throw new Error('melotts_empty');
  return { audio_b64: audio, content_type: 'audio/mpeg' };
}

export async function synthesizeWithOpenAI(text, apiKey, fetchFn = fetch, voice = OPENAI_TTS_VOICE) {
  const url = 'https://api.openai.com/v1/audio/speech';
  const body = JSON.stringify({
    model: TTS_MODEL,
    voice,
    input: text,
    response_format: 'mp3',
  });

  let response;
  try {
    response = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      const timeoutErr = new Error('openai_tts_timeout');
      timeoutErr.code = 'tts_timeout';
      throw timeoutErr;
    }
    throw err;
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch (_) {
      // ignore
    }
    console.error(`[minny-tts] ${response.status}${detail ? ' ' + detail : ''}`);
    const failedErr = new Error('openai_tts_failed');
    failedErr.status = response.status;
    throw failedErr;
  }

  const buffer = await response.arrayBuffer();
  const audio_b64 = arrayBufferToBase64(buffer);
  return { audio_b64, content_type: 'audio/mpeg' };
}

async function synthesize(env, text, { fetchFn = fetch, voice = TTS_VOICE } = {}) {
  if (env && env.AI) {
    try {
      return {
        engine: TTS_ENGINE,
        voice,
        ...(await synthesizeWithAura2(env.AI, text, voice)),
      };
    } catch (err) {
      console.error(`[minny-tts] aura2 failed (${err?.message}); trying melotts`);
    }
    return {
      engine: 'melotts',
      voice: 'melotts',
      ...(await synthesizeWithMeloTTS(env.AI, text)),
    };
  }
  const apiKey = resolveOpenAiApiKey(env);
  if (!apiKey) {
    const err = new Error('tts_unavailable');
    err.code = 'tts_unavailable';
    throw err;
  }
  return {
    engine: 'openai',
    voice: OPENAI_TTS_VOICE,
    ...(await synthesizeWithOpenAI(text, apiKey, fetchFn)),
  };
}

export async function getOrSynthesize(env, text, { fetchFn = fetch, voice = TTS_VOICE } = {}) {
  const kv = env && env.READ2LEAD_CODES;
  const engine = env && env.AI ? TTS_ENGINE : 'openai';
  const cacheVoice = engine === 'openai' ? OPENAI_TTS_VOICE : voice;
  const key = await ttsCacheKey(text, cacheVoice, engine);

  if (kv) {
    const cached = await kv.get(key, { type: 'json' });
    if (cached && cached.audio_b64) {
      return cached;
    }
  }

  const result = await synthesize(env, text, { fetchFn, voice });
  const payload = { audio_b64: result.audio_b64, content_type: result.content_type };
  if (kv && result.engine === engine) {
    // Cache only when the primary engine answered — a fallback result under
    // the primary's key would pin the wrong voice until the cache is purged.
    await kv.put(key, JSON.stringify(payload));
  }
  return payload;
}
