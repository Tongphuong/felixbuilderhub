// functions/api/_minny-repair.js
//
// V1.1 (2026-07-11) — deterministic repair ladder + Vietnamese/low-content
// heuristic (spec V1-D2). Pure functions only, no env/KV access, so plain
// `node --test` covers all of it (repo convention). Called by
// minny-conversation.js BEFORE any LLM spend, right after the existing
// guardrail transcript screen.
//
// This module deliberately does NOT import `transcribeAudio`,
// `wordSimilarity`, or `normalizeWord` implementations wholesale from the
// PROTECTED read2lead-speaking-check.js — normalizeWord is imported as-is
// (import is allowed, modification is not), wordSimilarity is taken as an
// injected argument to matchesExpected() so this module never needs to
// import the whole file just to compare two strings, and the Vietnamese
// diacritics char-class is copied (not imported) per the packet's
// instruction to "reuse the pattern, do not import the protected file".

import { normalizeWord } from './read2lead-speaking-check.js';
// isBeginnerLevel is the single source of truth for the L1-L2-vs-L3+ split
// (it also maps R2L's L0 -- START_LEVEL, most pilot kids -- onto the L1
// branch). Using it here instead of a local `level === 'L1' || level ===
// 'L2'` check keeps this module in sync with buildSystemPrompt/
// gateReplyForLevel: an L0 code must get the choices/repair_choices ladder,
// not silently fall through to the L3+ (no-chips) ladder.
import { isBeginnerLevel } from './_minny-convo.js';

// Same char class as read2lead-speaking-check.js's VIETNAMESE_DIACRITICS_RE
// (copied, not imported -- see module note above).
const VIETNAMESE_DIACRITICS_RE = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i;

export function isVietnamese(transcript) {
  return VIETNAMESE_DIACRITICS_RE.test(String(transcript || ''));
}

export function isLowContent(transcript) {
  const trimmed = String(transcript || '').trim();
  if (trimmed.length < 6) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length < 2;
}

function tokenizeWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

// True if ANY expected variant fuzzy-matches the transcript: normalize both
// sides (per-word, via normalizeWord -- lowercased, alpha-only), then either
// (a) the normalized transcript phrase directly contains the normalized
// expected phrase, or (b) every word of the expected phrase has some
// transcript word at wordSimilarity >= 0.75 (garbled-but-near speech).
export function matchesExpected(transcript, expected, wordSimilarity) {
  const variants = Array.isArray(expected) ? expected : [expected];
  const transcriptWords = tokenizeWords(transcript).map(normalizeWord).filter(Boolean);
  if (!transcriptWords.length) return false;
  const transcriptNorm = transcriptWords.join(' ');

  for (const variant of variants) {
    const variantWords = tokenizeWords(variant).map(normalizeWord).filter(Boolean);
    if (!variantWords.length) continue;
    const variantNorm = variantWords.join(' ');
    // Space-padded so a short variant can't false-positive as a substring of
    // a longer, unrelated word joined across the space (e.g. "cat" must not
    // match inside "catapult" -- SHOULD-FIX 3, Elon review 2026-07-11).
    if (` ${transcriptNorm} `.includes(` ${variantNorm} `)) return true;
    const allWordsMatch = variantWords.every((vw) => (
      transcriptWords.some((tw) => wordSimilarity(tw, vw) >= 0.75)
    ));
    if (allWordsMatch) return true;
  }
  return false;
}

// Pure repair-ladder state machine. `session` carries { repair: {step,
// active}, last_options, last_expected, last_hint } (session bookkeeping the
// endpoint updates every turn -- separate from the kid-visible history,
// which still records only reply_en/mood per spec). `opts.vietnamese` is the
// trigger reason decided by the caller (isVietnamese(transcript)); everything
// else about WHETHER to call this at all is also the caller's job (the
// trigger condition lives in the endpoint, per the spec: "evaluated in the
// endpoint BEFORE the LLM call, AFTER the guardrail transcript screen").
//
// Returns { phraseId, vars, repair } where `repair` is the new
// session.repair value to persist. Max 2 repair turns per stall: once the
// ladder has already used step 1 and step 2, the next trigger returns
// repair_move_on and resets to { step: 0, active: false } so the following
// turn is a normal LLM turn again.
export function nextRepairStep(session, level, opts = {}) {
  const isBeginner = isBeginnerLevel(level);

  if (opts.vietnamese) {
    // Vietnamese trigger fires at any level and consumes repair step 1 (per
    // spec), regardless of where the ladder currently stood.
    let model = 'i like it';
    if (isBeginner) {
      const expected = Array.isArray(session?.last_expected) ? session.last_expected : [];
      model = expected[0] || model;
    } else {
      const hint = session?.last_hint;
      if (typeof hint === 'string' && hint && !hint.includes('?') && !hint.includes(' ')) {
        model = hint;
      }
    }
    return { phraseId: 'vn_nudge', vars: { model }, repair: { step: 1, active: true } };
  }

  const currentStep = Number(session?.repair?.step) || 0;
  const nextStepNum = currentStep + 1;

  if (nextStepNum >= 3) {
    // Two repair turns already spent on this stall -- move on and reset.
    return { phraseId: 'repair_move_on', vars: {}, repair: { step: 0, active: false } };
  }

  if (nextStepNum === 1) {
    return { phraseId: 'repair_rephrase', vars: {}, repair: { step: 1, active: true } };
  }

  // nextStepNum === 2
  if (isBeginner) {
    const options = Array.isArray(session?.last_options) ? session.last_options : [];
    if (options.length >= 2) {
      return { phraseId: 'repair_choices', vars: { a: options[0], b: options[1] }, repair: { step: 2, active: true } };
    }
    // Defensive fallback if a prior turn didn't carry 2 options (e.g. it
    // wasn't a question turn) -- model the answer instead of a choices line
    // with nothing to fill.
    const expected = Array.isArray(session?.last_expected) ? session.last_expected : [];
    return { phraseId: 'repair_model', vars: { model: expected[0] || 'i like it' }, repair: { step: 2, active: true } };
  }

  // L3+ step 2 SKIPS the two-choice step per spec -- straight to repair_model,
  // filled with the last hint word in a tiny sentence.
  const hint = session?.last_hint;
  const model = (typeof hint === 'string' && hint && !hint.includes('?')) ? `I like ${hint}` : 'I like it';
  return { phraseId: 'repair_model', vars: { model }, repair: { step: 2, active: true } };
}
