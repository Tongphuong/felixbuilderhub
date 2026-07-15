//
// Phase 6 guardrail layer -- pure functions only, no env/KV access. The
// caller (minny-conversation.js) wires these in order: kid transcript
// screen -> LLM call -> shape/deterministic checks -> Llama Guard -> TTS.
// The DETERMINISTIC layers (scanBannedTopics/screenTranscript,
// validateReplyShape, detectCharacterBreak) are the hard, always-on
// fail-closed safety gate. The ML backstop (screenWithLlamaGuard) is a
// resilient best-effort layer: it flags only a genuine "unsafe" verdict, and
// DEGRADES gracefully (does not flag) when the model itself can't run
// (missing binding / error / timeout / unparsable-empty response) -- because
// blocking every reply on a guard outage bricked the whole feature (see the
// 2026-07-09 preview incident). Approved posture: on guard infra-failure,
// rely on the deterministic gate that already passed.

import { BANNED_TOPICS } from './_minny-guardrail-wordlists.js';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Word-boundary-aware match (Unicode-safe, so Vietnamese diacritic letters
// count as word characters too) -- avoids the classic profanity-filter
// false-positive problem where a short banned word is also a substring of
// a completely innocent word (e.g. "ass" inside "class" or "assignment").
function containsWordBoundaryMatch(text, phrase) {
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'iu');
  return pattern.test(text);
}

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
      if (containsWordBoundaryMatch(normalized, word.toLowerCase())) {
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
//
// Returns { flagged, degraded, category, raw }:
//   - flagged:true  -> a genuine, parseable "unsafe" verdict (redirect the kid).
//   - degraded:true -> the guard could NOT produce a usable verdict (missing
//     binding, error, timeout, empty/unparsable response). Per the approved
//     "degrade gracefully" posture the caller then relies on the deterministic
//     word-list gate (which already passed) and lets the reply through, rather
//     than blocking every turn on a guard outage.
//   - both false    -> a clean "safe" verdict.
//
// Llama Guard classifies a CONVERSATION, so we pass the kid's turn plus the
// assistant reply being screened (not a lone assistant message).
//
// `waitUntil` (optional, 4th arg): the caller's Cloudflare Pages
// `context.waitUntil` (or an equivalent), plumbed through as a plain
// parameter -- never read from a global, so this file stays pure/env-free
// per the header comment. See the block comment below for why it exists.
//
// speakup-guard-limiter (2026-07-15, Fable re-plan after five failed
// promise-hygiene swings): every coached/free-talk request starts with a
// Llama Guard call (`ai.run('@cf/meta/llama-guard-3-8b', ...)`). Under
// degraded Workers-AI conditions that call can take 30s+ -- and no fix so
// far has ever actually TERMINATED it (the race abandoned it, waitUntil
// extended it, the detached job backgrounds it), so each in-flight guard
// call holds ONE of the isolate's 6 subrequest connection slots for its
// full latency the whole time it's pending. At typical request spacing,
// pending guard calls accumulate across requests until the isolate has no
// slots left for its own Whisper/Azure calls -> error 1102 -> every route
// on that isolate 503s.
//
// This module-level flag is the actual fix: cap the isolate at ONE
// in-flight `ai.run('@cf/meta/llama-guard-3-8b', ...)` call, full stop --
// shared by BOTH guard entry points below (the inline race-based
// screenWithLlamaGuard and the detached screenWithLlamaGuardDetached).
// Module state persists per isolate, which is the point: a second guard
// call arriving while one is already draining is skipped entirely (same
// fail-open degraded posture as every other guard-infra failure -- the
// deterministic word-list gate already passed) instead of piling up
// another slot-holding call. Deliberately a plain module-level `let`, not
// per-request state -- the isolate itself is the resource being protected.
let llamaGuardInFlight = false;

export async function screenWithLlamaGuard(ai, replyText, userText = '', waitUntil) {
  if (!ai || typeof ai.run !== 'function') {
    return { flagged: false, degraded: true, category: 'guard_unavailable', raw: null };
  }
  // speakup-guard-limiter (2026-07-15): a guard call is already draining on
  // this isolate -- do not start a second one. Same fail-open degraded
  // contract as every other cause below (timeout, error, empty response):
  // the deterministic gate already passed, so the caller relies on it and
  // ships the reply.
  if (llamaGuardInFlight) {
    return { flagged: false, degraded: true, category: 'guard_busy', raw: null };
  }
  // speakup-503-hunt revision 1 (2026-07-15): this setTimeout handle MUST be
  // cleared on every exit path below. The losing side of the race used to be
  // a bare, never-cancelled timer -- when ai.run() won (the common case, p50
  // 0.4-1.1s), the timer stayed armed and fired its reject() 3.5s later, into
  // a request whose I/O context Cloudflare Workers already considers torn
  // down. That was PART of what was killing the isolate with error 1102
  // ("Worker exceeded resource limits").
  //
  // speakup-503-hunt revision 2 (2026-07-15): revision 1 closed the TIMER
  // side, but Buffet's live reproducer against the revision-1 preview still
  // died 15/18 times with the identical error 1102 -- the MIRROR side of the
  // same race. When the TIMEOUT wins (Llama Guard genuinely slower than
  // 3.5s -- common under evening Workers-AI load), this function used to
  // return via `catch` immediately while ai.run()'s own promise was still
  // PENDING at that moment: nothing ever awaited, cancelled, or attached a
  // handler to it. A still-in-flight Workers AI binding call left dangling
  // past response teardown kills the isolate exactly like the orphaned timer
  // did. Fix: capture `guardPromise` BEFORE the race (so a reference to it
  // survives regardless of which side wins), attach a swallowing `.catch()`
  // immediately so a late rejection is never an unhandled rejection, and --
  // when the caller passed a `waitUntil` -- hand that same swallowed promise
  // to it on any exit through `catch`. `ctx.waitUntil()` is the sanctioned
  // Workers mechanism for letting I/O outlive the response: the platform
  // keeps the isolate alive until the handed-off promise settles instead of
  // tearing it down mid-flight.
  let timeoutHandle;
  let guardPromise;
  try {
    const messages = [];
    if (userText) messages.push({ role: 'user', content: String(userText) });
    messages.push({ role: 'assistant', content: String(replyText || '') });
    // Wrapped in Promise.resolve() so `.catch()` below is always safe to call
    // even if a binding ever returned a bare non-promise value.
    guardPromise = Promise.resolve(ai.run('@cf/meta/llama-guard-3-8b', { messages }));
    guardPromise.catch(() => {});
    // speakup-guard-limiter (2026-07-15): the in-flight flag tracks
    // ai.run()'s REAL lifetime (the thing actually holding the subrequest
    // slot), not this function's own 3.5s race -- release it only when
    // guardPromise itself settles, which on the timeout side of the race
    // below can be well after this function has already returned.
    llamaGuardInFlight = true;
    // `.finally()` returns a NEW promise that adopts guardPromise's eventual
    // rejection -- nothing else references or awaits that returned promise,
    // so without this trailing `.catch(() => {})` it becomes its own
    // unhandled rejection on the exact same error guardPromise's own
    // `.catch()` above already swallowed.
    guardPromise.finally(() => { llamaGuardInFlight = false; }).catch(() => {});
    const result = await Promise.race([
      guardPromise,
      // 3.5s (was 6s, tuned 2026-07-10): the two-phase turn awaits ONLY the
      // guard before showing the reply, so this timeout directly caps the
      // kid's time-to-text. Guard p50 is 0.4-1.1s live; a verdict slower than
      // 3.5s means Workers AI is degraded, and waiting the extra 2.5s buys the
      // same outcome the timeout already gives: the degraded path (the
      // deterministic gate already passed; degradation is logged to the flag
      // ring). Safety order and flag semantics unchanged.
      new Promise((_, reject) => { timeoutHandle = setTimeout(() => reject(new Error('llama_guard_timeout')), 3500); }),
    ]);
    clearTimeout(timeoutHandle);
    const raw = typeof result === 'string' ? result : (result?.response ?? result?.text ?? '');
    const normalized = String(raw ?? '').trim().toLowerCase();
    if (!normalized) {
      return { flagged: false, degraded: true, category: 'guard_empty_response', raw };
    }
    if (normalized.startsWith('safe')) {
      return { flagged: false, degraded: false, category: null, raw };
    }
    // A genuine unsafe verdict: Llama Guard emits "unsafe" and/or an sN code.
    const categoryMatch = normalized.match(/s\d+/);
    if (normalized.includes('unsafe') || categoryMatch) {
      return { flagged: true, degraded: false, category: categoryMatch ? categoryMatch[0] : 'unsafe', raw };
    }
    // Non-empty but neither a clear "safe" nor a clear "unsafe" verdict -- we
    // can't trust it, so degrade to the deterministic gate rather than block.
    return { flagged: false, degraded: true, category: 'guard_unparsed', raw };
  } catch {
    // The timeout branch of the race rejecting lands here too -- clear it
    // regardless of which side of the race threw.
    clearTimeout(timeoutHandle);
    // Mirror-side fix: guardPromise may still be pending (timeout won) or
    // may already be settled (ai.run() itself rejected/threw) -- either way,
    // handing it to waitUntil is safe (an already-settled promise resolves
    // waitUntil's wait near-instantly) and closes the orphan-past-teardown
    // gap for the pending case, which is the one that actually kills isolates.
    if (typeof waitUntil === 'function' && guardPromise) {
      waitUntil(guardPromise.catch(() => {}));
    }
    return { flagged: false, degraded: true, category: 'guard_error', raw: null };
  }
}

// Layer: DETACHED variant of screenWithLlamaGuard for callers who have
// ALREADY delivered the content being screened and want the ML backstop to
// run entirely AFTER the response, inside the caller's ctx.waitUntil --
// never gating delivery, never racing a timer against the response's own
// I/O teardown.
//
// Founder ruling (2026-07-15, speakup-guard-redesign): the coach note ships
// the instant the DETERMINISTIC guards (validateReplyShape/
// detectCharacterBreak/scanBannedTopics -- unchanged, inline, always
// gating) pass. This function screens that same text afterward; on a
// genuine flag it calls `onFlagged` so the caller can retract whatever it
// persisted (e.g. rewrite a KV record so a retracted note can't be
// tapped-to-hear again) and logs the flag loudly so it's findable in CF
// logs. Safety-floor rationale: screenWithLlamaGuard above ALREADY ships
// the reply on `degraded` (guard slow/errored/unparsable) -- backgrounding
// the ML backstop entirely does not lower that floor, it removes the
// inline `await` of the guard call that was the actual isolate-killer
// (error 1102, ~83% of live requests even after both hygiene fixes above --
// see speakup-503-hunt history). There is no race and no timer here: a
// plain `await ai.run(...)`, and `waitUntil`'s own contract is what keeps
// this call alive past the response -- nothing to leak.
//
// This intentionally duplicates screenWithLlamaGuard's small verdict-parse
// step (safe/unsafe/degraded classification) rather than sharing code with
// it -- screenWithLlamaGuard is still the fail-closed-on-flag path for
// minny-conversation.js's live turn reply and has already been through two
// rounds of live-reproducer review; touching it to share code here is not
// worth the risk to a call site this function does not serve.
//
// Never throws, never rejects -- fully try/catch-wrapped so a background
// failure can never surface as an unhandled rejection inside waitUntil.
// Returns the job promise so a caller/test can await it directly in
// addition to (or instead of) handing it to waitUntil.
export function screenWithLlamaGuardDetached({ ai, replyText, userText = '', accessCode = '', onFlagged } = {}) {
  return (async () => {
    try {
      if (!ai || typeof ai.run !== 'function') {
        console.error('[GUARD-DEGRADED]', accessCode, 'guard_unavailable');
        return;
      }
      // speakup-guard-limiter (2026-07-15): a guard call is already
      // draining on this isolate (inline or another detached job) -- skip
      // rather than start a second one. The deterministic guards already
      // gated this content and the coach note already shipped (this job
      // only ever runs after delivery, see the block comment above), so
      // this is the same fail-open degraded semantics as every other guard
      // outage here -- just with nothing to retract on this turn.
      if (llamaGuardInFlight) {
        console.error('[GUARD-SKIPPED-BUSY]', accessCode);
        return;
      }
      const messages = [];
      if (userText) messages.push({ role: 'user', content: String(userText) });
      messages.push({ role: 'assistant', content: String(replyText || '') });
      llamaGuardInFlight = true;
      let result;
      try {
        result = await ai.run('@cf/meta/llama-guard-3-8b', { messages });
      } finally {
        llamaGuardInFlight = false;
      }
      const raw = typeof result === 'string' ? result : (result?.response ?? result?.text ?? '');
      const normalized = String(raw ?? '').trim().toLowerCase();
      if (!normalized) {
        console.error('[GUARD-DEGRADED]', accessCode, 'guard_empty_response');
        return;
      }
      if (normalized.startsWith('safe')) {
        return; // clean verdict -- nothing to retract
      }
      const categoryMatch = normalized.match(/s\d+/);
      if (normalized.includes('unsafe') || categoryMatch) {
        const category = categoryMatch ? categoryMatch[0] : 'unsafe';
        // Loud, findable in CF logs -- this is the only signal a retracted
        // coach note leaves once the response has already gone out.
        console.error('[GUARD-RETRACT]', accessCode, category, raw);
        if (typeof onFlagged === 'function') {
          try {
            await onFlagged({ category, raw });
          } catch (err) {
            console.error('[GUARD-RETRACT-FAILED]', accessCode, category, err?.message || err);
          }
        }
        return;
      }
      // Non-empty but neither a clear "safe" nor a clear "unsafe" verdict --
      // can't trust it, so degrade (no retraction), same posture as the
      // inline guard's guard_unparsed case.
      console.error('[GUARD-DEGRADED]', accessCode, 'guard_unparsed');
    } catch (err) {
      console.error('[GUARD-DEGRADED]', accessCode, 'guard_error', err?.message || err);
    }
  })();
}
