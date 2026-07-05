//
// Phase 6 guardrail layer -- pure functions only, no env/KV access. The
// caller (minny-conversation.js) wires these in order: kid transcript
// screen -> LLM call -> shape/deterministic checks -> Llama Guard -> TTS.
// Every function here is fail-closed: on any ambiguity or error, treat the
// content as flagged rather than pass it through.

import { BANNED_TOPICS } from './_minny-guardrail-wordlists.js';

const URL_PATTERN = /(https?:\/\/|www\.)\S+/i;
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
const PHONE_PATTERN = /(\+?\d[\d\s\-().]{7,}\d)/;
const MAX_REPLY_LENGTH = 220;

const CHARACTER_BREAK_MARKERS = [
  'as an ai', 'as a language model', 'i am an ai', "i'm an ai",
  'i am a bot', "i'm a bot", 'i am a program', 'language model',
  'openai', 'chatgpt', 'gpt-4', 'gpt-5', 'system prompt', 'my instructions',
  'i cannot fulfill', 'as an assistant',
];

// Layer: scan any text (kid transcript or model reply) for banned-topic
// substrings. Case-insensitive; returns the first category/word matched.
export function scanBannedTopics(text) {
  const normalized = typeof text === 'string' ? text.toLowerCase() : '';
  if (!normalized) return { flagged: false, category: null, matched: null };
  for (const [category, words] of Object.entries(BANNED_TOPICS)) {
    for (const word of words) {
      if (normalized.includes(word.toLowerCase())) {
        return { flagged: true, category, matched: word };
      }
    }
  }
  return { flagged: false, category: null, matched: null };
}

// Layer: screen the kid's own transcript before it ever reaches the LLM.
export function screenTranscript(text) {
  return scanBannedTopics(text);
}

// Layer: deterministic shape checks on the model's reply -- over-long,
// contains a URL/email/phone number. Independent of scanBannedTopics.
export function validateReplyShape(reply) {
  const text = typeof reply === 'string' ? reply : '';
  if (!text) return { flagged: true, reason: 'empty_reply' };
  if (text.length > MAX_REPLY_LENGTH) return { flagged: true, reason: 'over_long' };
  if (URL_PATTERN.test(text)) return { flagged: true, reason: 'contains_url' };
  if (EMAIL_PATTERN.test(text)) return { flagged: true, reason: 'contains_email' };
  if (PHONE_PATTERN.test(text)) return { flagged: true, reason: 'contains_phone' };
  return { flagged: false, reason: null };
}

// Layer: does the model's reply break character (reveal it's an AI/bot)?
export function detectCharacterBreak(reply) {
  const text = typeof reply === 'string' ? reply.toLowerCase() : '';
  const matched = CHARACTER_BREAK_MARKERS.find((marker) => text.includes(marker));
  return { flagged: Boolean(matched), marker: matched || null };
}

// Layer: ML backstop via Cloudflare Workers AI's Llama Guard model. Called
// only on the model's own reply, after the deterministic layers pass.
// Fail-closed: any error, timeout, missing binding, or unexpected/empty
// response is treated as flagged, never as a silent pass-through.
export async function screenWithLlamaGuard(ai, text) {
  if (!ai || typeof ai.run !== 'function') {
    return { flagged: true, category: 'guard_unavailable', raw: null };
  }
  try {
    const result = await Promise.race([
      ai.run('@cf/meta/llama-guard-3-8b', {
        messages: [{ role: 'assistant', content: String(text || '') }],
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('llama_guard_timeout')), 4000)),
    ]);
    const raw = typeof result === 'string' ? result : (result?.response || result?.text || '');
    const normalized = String(raw || '').trim().toLowerCase();
    if (!normalized) {
      return { flagged: true, category: 'guard_empty_response', raw };
    }
    if (normalized.startsWith('safe')) {
      return { flagged: false, category: null, raw };
    }
    const categoryMatch = normalized.match(/s\d+/);
    return { flagged: true, category: categoryMatch ? categoryMatch[0] : 'unsafe', raw };
  } catch {
    return { flagged: true, category: 'guard_error', raw: null };
  }
}
