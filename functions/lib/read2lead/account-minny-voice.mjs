import { prepareMinnyVoice, renderMinnyVoice } from '../../api/minny-voice.js';

const json = (error, status = 503) => Response.json({ ok: false, error }, {
  status, headers: { 'Cache-Control': 'no-store' },
});
const cacheKey = key => /^tts:[a-z0-9-]+:[a-z0-9-]+:[a-f0-9]{64}$/.test(key);

/** Reuse original tap-to-hear behavior without holding a staged account save
 * across external synthesis. No provider retry or legacy account fallback.
 * An explicit host-supplied read-only speech cache may retain old recordings. */
// Phase callbacks are trusted server imports, never request-supplied options.
export async function accountMinnyVoice({ request, infrastructure, run, legacySpeechCache, prepare = prepareMinnyVoice, render = renderMinnyVoice }) {
  const voiceEnv = { AI: infrastructure.AI, OPENAI_API_KEY: infrastructure.OPENAI_API_KEY,
    READ2LEAD_OPENAI_API_KEY: infrastructure.READ2LEAD_OPENAI_API_KEY };
  let prepared;
  const check = async () => run(async accountEnv => {
    const result = await prepare({ request: request.clone(), env: { ...voiceEnv, ...accountEnv } });
    if (result instanceof Response) return result;
    if (prepared && (result.accessCode !== prepared.accessCode || result.text !== prepared.text)) {
      return json('voice_permission_changed', 409);
    }
    prepared = result;
    return new Response(null, { status: 204 });
  });
  const initial = await check();
  if (initial.status !== 204) return initial;

  // Expose only the original speech cache. The provider helper cannot write
  // accounts or use an obsolete account transaction after its await.
  const cache = {
    async get(key, options) {
      if (!cacheKey(key) || options?.type !== 'json') throw Error('voice_cache_key_refused');
      const response = await run(async env => Response.json({ value: await env.READ2LEAD_CODES.get(key, options) }));
      if (!response.ok) throw Error('voice_cache_unavailable');
      const value = (await response.json()).value;
      // Only this validated cache key may reach the retained store. An absent
      // or failing account read above must never fall back to legacy accounts.
      return value == null && legacySpeechCache ? legacySpeechCache.get(key, { type: 'json' }) : value;
    },
    async put(key, value) {
      if (!cacheKey(key) || typeof value !== 'string') throw Error('voice_cache_key_refused');
      const response = await run(async env => {
        await env.READ2LEAD_CODES.put(key, value);
        return new Response(null, { status: 204 });
      });
      if (response.status !== 204) throw Error('voice_cache_unavailable');
    },
  };
  const response = await render({ ...voiceEnv, READ2LEAD_CODES: cache }, prepared.text);
  if (!response.ok) return response;
  // An account, homework, or expiring coach allowance can change during TTS.
  // Validate against current state before releasing any audio to this caller.
  const final = await check();
  return final.status === 204 ? response : final;
}
