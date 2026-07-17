// SpeakUp diamond HUD + celebration UI (Task 1-2, 2026-07-17 packet):
//   1. stable per-session completion_id on the three minny-practice-log
//      POST call sites (client half of Mark's anti-farming idempotency
//      guard — see tests/speakup-diamond-award.test.mjs for the backend
//      dedup behavior this id feeds).
//   2. kid diamond HUD pill + celebration on a real award, reusing the R2L
//      confetti juice (lesson-juice.ts / canvas-confetti) rather than a new
//      dependency.
//
// Same repo convention as tests/speakup-chips-ui.test.mjs / tests/speakup-
// feedback-ui.test.mjs (no jsdom available): the pure, DOM-free
// getOrCreateCompletionId() is extracted straight out of speak-up.astro's
// inline script (brace-matched slice) and evaluated via `new Function` for
// real behavioral coverage; the DOM-wiring/fetch-chaining pieces get
// string/region assertions on the raw source instead.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const speakingPage = readFileSync('src/pages/speak-up.astro', 'utf-8');
const speakupCss = readFileSync('src/styles/speakup-app.css', 'utf-8');

function extractFunctionSrc(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `function ${name} not found in speak-up.astro`);
  const parenStart = source.indexOf('(', start);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) { parenEnd = i; break; }
    }
  }
  assert.notEqual(parenEnd, -1, `could not find end of parameter list for function ${name}`);
  const braceStart = source.indexOf('{', parenEnd);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.notEqual(end, -1, `could not find closing brace of function ${name}`);
  return source.slice(start, end);
}

function loadPureHelpers() {
  const body = `${extractFunctionSrc(speakingPage, 'getOrCreateCompletionId')}\n\nreturn { getOrCreateCompletionId };`;
  // eslint-disable-next-line no-new-func -- see file header: pure, DOM-free source extracted from the page itself
  return new Function(body)();
}

const { getOrCreateCompletionId } = loadPureHelpers();

// ---------------------------------------------------------------------------
// getOrCreateCompletionId: the CRITICAL correctness fix (Task 1)
// ---------------------------------------------------------------------------

test('getOrCreateCompletionId: generates a non-empty id when none exists yet', () => {
  const state = { homeworkCompletionId: null };
  const id = getOrCreateCompletionId(state, 'homeworkCompletionId');
  assert.equal(typeof id, 'string');
  assert.ok(id.length > 0);
  assert.equal(state.homeworkCompletionId, id, 'the generated id must be persisted back onto the store');
});

test('getOrCreateCompletionId: two calls for the SAME completion (same store/key, not reset in between) reuse the SAME id', () => {
  const state = { homeworkCompletionId: null };
  const first = getOrCreateCompletionId(state, 'homeworkCompletionId');
  const second = getOrCreateCompletionId(state, 'homeworkCompletionId');
  const third = getOrCreateCompletionId(state, 'homeworkCompletionId');
  assert.equal(second, first, 'a retry/re-post of the same completion must reuse the same id');
  assert.equal(third, first, 'a third read within the same completion must still reuse it');
});

test('getOrCreateCompletionId: a NEW completion (store[key] reset to null) produces a DIFFERENT id', () => {
  const state = { homeworkCompletionId: null };
  const sessionOneId = getOrCreateCompletionId(state, 'homeworkCompletionId');

  // Mirrors what enterPracticeMode() / the "done -> back to modes" handler
  // do between two real homework sessions.
  state.homeworkCompletionId = null;
  const sessionTwoId = getOrCreateCompletionId(state, 'homeworkCompletionId');

  assert.notEqual(sessionTwoId, sessionOneId, 'a fresh session must never reuse the previous session\'s id');
});

test('getOrCreateCompletionId: independent stores (homework state vs. free-talk ft) never collide', () => {
  const state = { homeworkCompletionId: null };
  const ft = { completionId: null };
  const hwId = getOrCreateCompletionId(state, 'homeworkCompletionId');
  const ftId = getOrCreateCompletionId(ft, 'completionId');
  assert.notEqual(hwId, ftId);
  // Each store keeps reusing its OWN id independently.
  assert.equal(getOrCreateCompletionId(state, 'homeworkCompletionId'), hwId);
  assert.equal(getOrCreateCompletionId(ft, 'completionId'), ftId);
});

// ---------------------------------------------------------------------------
// Wiring: all three POST call sites send completion_id (source-level, same
// convention as the sibling *-ui.test.mjs files for DOM/fetch-adjacent code)
// ---------------------------------------------------------------------------

test('appendHomeworkSummary POST body carries completion_id via getOrCreateCompletionId(state, ...)', () => {
  assert.match(
    speakingPage,
    /prompt_id:\s*'homework_summary',\s*\n\s*mode_id:\s*'homework',\s*\n\s*completion_id:\s*getOrCreateCompletionId\(state,\s*'homeworkCompletionId'\)/,
  );
});

test('logPractice (per-step log) POST body carries a completion_id — homework mode reuses the session id, other modes get a fresh one per call', () => {
  const src = extractFunctionSrc(speakingPage, 'logPractice');
  assert.match(src, /getOrCreateCompletionId\(state,\s*'homeworkCompletionId'\)/);
  assert.match(src, /crypto\.randomUUID\(\)/);
  assert.match(src, /completion_id:\s*completionId/);
});

test('ftShowSummary (free_talk_summary) POST body carries completion_id via getOrCreateCompletionId(ft, ...)', () => {
  assert.match(
    speakingPage,
    /prompt_id:\s*'free_talk_summary',\s*\n\s*mode_id:\s*'free_talk',\s*\n\s*completion_id:\s*getOrCreateCompletionId\(ft,\s*'completionId'\)/,
  );
});

test('no fetch call site regenerates a UUID inline per attempt (the exact anti-pattern Buffet flagged) — crypto.randomUUID() is only reached via getOrCreateCompletionId\'s guarded first-call path, or logPractice\'s explicit non-homework fallback', () => {
  // Every literal crypto.randomUUID() call site must be inside either
  // getOrCreateCompletionId's `if (!store[key])` guard, or logPractice's
  // documented non-homework branch — never directly inline in a fetch body.
  const randomUuidSites = [...speakingPage.matchAll(/crypto\.randomUUID\(\)/g)];
  assert.ok(randomUuidSites.length >= 2, 'expected at least the guarded getOrCreateCompletionId call plus logPractice\'s fallback');
  const getOrCreateSrc = extractFunctionSrc(speakingPage, 'getOrCreateCompletionId');
  assert.match(getOrCreateSrc, /if\s*\(!store\[key\]\)\s*store\[key\]\s*=\s*crypto\.randomUUID\(\);/);
});

// ---------------------------------------------------------------------------
// Session-reset points: a NEW session must get a fresh id (source-level)
// ---------------------------------------------------------------------------

test('enterPracticeMode resets homeworkCompletionId to null (a freshly entered homework session gets a new id)', () => {
  const src = extractFunctionSrc(speakingPage, 'enterPracticeMode');
  assert.match(src, /state\.homeworkResults\s*=\s*\[\];\s*\n\s*state\.homeworkComplete\s*=\s*false;\s*\n\s*state\.homeworkCompletionId\s*=\s*null;/);
});

test('the "done -> back to modes" handler resets homeworkCompletionId to null alongside homeworkComplete/homeworkResults', () => {
  const idx = speakingPage.indexOf("if (state.activeModeId === 'homework' && state.homeworkComplete)");
  assert.ok(idx > -1);
  const region = speakingPage.slice(idx, idx + 400);
  assert.match(region, /state\.homeworkComplete\s*=\s*false;/);
  assert.match(region, /state\.homeworkResults\s*=\s*\[\];/);
  assert.match(region, /state\.homeworkCompletionId\s*=\s*null;/);
});

test('ftReset() resets ft.completionId to null (a freshly entered free-talk session gets a new id)', () => {
  const src = extractFunctionSrc(speakingPage, 'ftReset');
  assert.match(src, /ft\.completionId\s*=\s*null;/);
});

// ---------------------------------------------------------------------------
// Task 2: kid diamond HUD markup + seeding
// ---------------------------------------------------------------------------

test('header markup: a diamond pill exists, starts hidden, with the ids the script wires', () => {
  assert.match(
    speakingPage,
    /<div class="spk-appbar__diamonds hidden" id="appbar-diamonds" role="status" aria-label="[^"]+">\s*<span class="spk-appbar__diamonds-icon" aria-hidden="true">💎<\/span>\s*<span class="spk-appbar__diamonds-value" id="appbar-diamonds-value">0<\/span>\s*<\/div>/,
  );
});

test('loadSession() seeds the diamond pill from minny-speaking-context\'s diamond_balance and reveals it', () => {
  const src = extractFunctionSrc(speakingPage, 'loadSession');
  const idx = src.indexOf("document.getElementById('appbar-diamonds')");
  assert.ok(idx > -1, 'loadSession must look up the diamond pill element');
  const region = src.slice(idx, idx + 200);
  assert.match(region, /updateDiamondPill\(data\.diamond_balance\)/);
  assert.match(region, /diamondsWrap\.classList\.remove\('hidden'\)/);
});

// ---------------------------------------------------------------------------
// Task 2: celebration wiring — defensive, byte-identical-safe, reuses R2L juice
// ---------------------------------------------------------------------------

test('the page imports the R2L confetti juice directly (not window.__r2lJuice, which is not mounted on this page) — no new confetti dependency', () => {
  assert.match(speakingPage, /import\s*\{\s*fireLessonPassConfetti,\s*fireStreakConfetti\s*\}\s*from\s*'\.\.\/lib\/lesson-juice';/);
  assert.doesNotMatch(speakingPage, /import\s+confetti\s+from\s+['"]canvas-confetti['"]/, 'must reuse lesson-juice.ts, not import canvas-confetti directly (would bypass the reduced-motion guard already in fireStreakConfetti/fireLessonPassConfetti)');
});

test('celebrateDiamonds: updates the pill unconditionally (even on a zero/failed award) but only tickers+confetti on a real award, and scales the burst by size', () => {
  const src = extractFunctionSrc(speakingPage, 'celebrateDiamonds');
  const pillIdx = src.indexOf('updateDiamondPill(payload?.diamond_balance)');
  const guardIdx = src.indexOf('if (!Number.isFinite(awarded) || awarded <= 0) return;');
  const tickerIdx = src.indexOf('showDiamondTicker(awarded)');
  const burstIdx = src.indexOf("awarded >= 20 ? fireLessonPassConfetti() : fireStreakConfetti()");
  assert.ok(pillIdx > -1 && guardIdx > -1 && tickerIdx > -1 && burstIdx > -1);
  assert.ok(pillIdx < guardIdx, 'the pill balance must update even when nothing was awarded this call');
  assert.ok(guardIdx < tickerIdx && tickerIdx < burstIdx);
});

test('updateDiamondPill and showDiamondTicker are defensive: never throw on a missing element or a non-finite amount', () => {
  const pillSrc = extractFunctionSrc(speakingPage, 'updateDiamondPill');
  assert.match(pillSrc, /Number\.isFinite\(n\)/);
  const tickerSrc = extractFunctionSrc(speakingPage, 'showDiamondTicker');
  assert.match(tickerSrc, /!anchor \|\| !Number\.isFinite\(amount\) \|\| amount <= 0/);
});

test('appendHomeworkSummary and ftShowSummary read the practice-log response and drive the celebration only when ok, staying fire-and-forget (.catch still present)', () => {
  for (const fnName of ['appendHomeworkSummary', 'ftShowSummary']) {
    const src = extractFunctionSrc(speakingPage, fnName);
    assert.match(src, /\.then\(\(res\)\s*=>\s*res\.json\(\)\)/, `${fnName} must read the response body`);
    assert.match(src, /\.then\(\(data\)\s*=>\s*\{\s*if\s*\(data\?\.ok\)\s*celebrateDiamonds\(data\);\s*\}\)/, `${fnName} must gate the celebration on data.ok`);
    assert.match(src, /\.catch\(\(\)\s*=>\s*\{\}\)/, `${fnName} must remain fire-and-forget (a failed/edge response must never break the session flow)`);
  }
});

// ---------------------------------------------------------------------------
// CSS: pill + ticker exist, reduced-motion respected
// ---------------------------------------------------------------------------

test('.spk-appbar__diamonds and .spk-diamond-ticker CSS exist, and stay visible at 390px (unlike .spk-appbar__sub)', () => {
  assert.match(speakupCss, /\.spk-appbar__diamonds\s*\{/);
  assert.match(speakupCss, /\.spk-appbar__diamonds\.hidden\s*\{\s*display:\s*none;\s*\}/);
  assert.match(speakupCss, /\.spk-diamond-ticker\s*\{/);
  assert.match(speakupCss, /\.spk-diamond-ticker\[data-visible="true"\]\s*\{/);
  // The 480px query hides .spk-appbar__sub only -- must not also catch the diamond pill.
  const smallQueryMatch = speakupCss.match(/@media \(max-width: 480px\)\s*\{([^}]*)\}/s);
  assert.ok(smallQueryMatch);
  assert.doesNotMatch(smallQueryMatch[1], /\.spk-appbar__diamonds/);
});

test('reduced-motion disables the ticker\'s rise transform (matches the repo convention for W2/SpeakUp juice)', () => {
  const rule = /@media \(prefers-reduced-motion: reduce\)[^@]*?\.spk-diamond-ticker\[data-visible="true"\]\s*\{[^}]*transform:\s*translate\(-50%,\s*0\)/s;
  assert.match(speakupCss, rule);
});
