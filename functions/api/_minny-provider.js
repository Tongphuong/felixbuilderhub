// Shared SpeakUp routing. Story mode uses the same destinations and model.
export const CONVO_MODEL = 'meta-llama/llama-3.3-70b-instruct';
export const CONVO_PROVIDER = { sort: 'throughput', require_parameters: true };
export const CONVO_FALLBACK_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export async function requestMinnyReply(env, messages, {
  fetchFn = fetch, maxTokens = 150, temperature = 0.8, strict = false, signal, onAttempt = () => {}, cloudflareTimeoutMs = 4000,
} = {}) {
  if (![4000,10000].includes(cloudflareTimeoutMs)) throw Error('minny_timeout_limit');
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > 1536) throw Error('minny_token_limit');
  if (strict && (!Array.isArray(messages) || new TextEncoder().encode(JSON.stringify(messages)).length > 24000)) throw Error('minny_prompt_limit');
  let rawReply = null, llmAttempts = 0, llmSource = 'none';
  const before = source => { if (signal?.aborted) throw Error('minny_interrupted'); onAttempt(source); llmAttempts++; };
  const boundedText = text => typeof text === 'string' && text.length <= 16000 ? text : null;
  if (env.OPENROUTER_API_KEY) {
    for (let attempt = 0; attempt < 2 && !rawReply; attempt++) {
      before('openrouter');
      try {
        const timeout = AbortSignal.timeout(4000);
        const response = await fetchFn('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST', headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: CONVO_MODEL, provider: CONVO_PROVIDER, messages,
            response_format: { type: 'json_object' }, max_tokens: maxTokens, temperature }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (response.ok) {
          const data = await response.json(), choice = data?.choices?.[0];
          if (!strict || (choice?.finish_reason === 'stop' && !choice.message?.tool_calls?.length)) {
            rawReply = strict ? boundedText(choice?.message?.content) : choice?.message?.content || null;
            if (rawReply) llmSource = 'openrouter';
          }
        }
      } catch { /* Preserve one retry, then the existing Cloudflare fallback. */ }
    }
  }
  if (!rawReply && env.AI) {
    for (const input of [{ messages, max_tokens: maxTokens, response_format: { type: 'json_object' } }, { messages, max_tokens: maxTokens }]) {
      if (rawReply) break;
      before('llama_fallback');
      let timer;
      try {
        const pending = env.AI.run(CONVO_FALLBACK_MODEL, input);
        const result = strict ? await Promise.race([pending, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('minny_timeout')), cloudflareTimeoutMs);
        })]) : await pending;
        // Current Workers AI returns OpenAI-shaped choices and may put an
        // already-parsed object in response. Prefer the completed choice;
        // never fall through to response when its completion is truncated.
        let text = typeof result === 'string' ? result : result?.response || result?.text || null;
        if (strict && Array.isArray(result?.choices)) {
          const choice = result.choices.length === 1 ? result.choices[0] : null;
          text = choice?.finish_reason === 'stop' && !choice.message?.tool_calls?.length && !choice.message?.refusal
            ? choice.message?.content : null;
        }
        rawReply = strict ? boundedText(text) : text;
        if (rawReply) llmSource = 'llama_fallback';
      } catch { /* Try the existing plain-shape fallback. */ }
      finally { clearTimeout(timer); }
    }
  }
  if (signal?.aborted) throw Error('minny_interrupted');
  return { rawReply, llmAttempts, llmSource };
}
