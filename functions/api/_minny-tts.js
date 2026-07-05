export function resolveOpenAiApiKey(env = {}) {
  return String(env.OPENAI_API_KEY || env.READ2LEAD_OPENAI_API_KEY || '').trim();
}

export const TTS_TIMEOUT_MS = 8000;
export const TTS_MODEL = 'tts-1-hd';
export const TTS_VOICE = 'nova';

export async function ttsCacheKey(text, voice = TTS_VOICE) {
  const enc = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', enc);
  const hex = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `tts:${voice}:${hex}`;
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

export async function synthesizeWithOpenAI(text, apiKey, fetchFn = fetch, voice = TTS_VOICE) {
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

export async function getOrSynthesize(kv, text, apiKey, fetchFn = fetch, voice = TTS_VOICE) {
  const key = await ttsCacheKey(text, voice);
  const cached = await kv.get(key, { type: 'json' });
  if (cached && cached.audio_b64) {
    return cached;
  }

  const result = await synthesizeWithOpenAI(text, apiKey, fetchFn, voice);
  await kv.put(key, JSON.stringify(result));
  return result;
}
