// V1.3 homework feedback sandwich (Wave D Set 2 mock, screens 1-2:
// design_handoff_speakup_v1/SpeakUp V1 Homework Feedback v2.dc.html,
// approved 2026-07-10; founder gate: Phương ack via AskUserQuestion,
// CONTROL.md task speakup-v1-3-feedback-sandwich).
//
// Same repo convention as tests/speakup-chips-ui.test.mjs and
// tests/speakup-fixit-ui.test.mjs (no jsdom available): the pure, DOM-free
// renderCoachSandwich() is extracted straight out of speak-up.astro's
// inline script (brace-matched slice) and evaluated via `new Function` for
// real behavioral coverage; the DOM-wiring/CSS pieces get string/region
// assertions on the raw source instead.

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

// renderCoachSandwich calls escapeHtml internally, so both must be present
// in the evaluated body (same pattern as loadPureHelpers() in the sibling
// test files).
function loadPureHelpers() {
  const pieces = [
    extractFunctionSrc(speakingPage, 'escapeHtml'),
    extractFunctionSrc(speakingPage, 'renderCoachSandwich'),
  ];
  const body = `${pieces.join('\n\n')}\n\nreturn { escapeHtml, renderCoachSandwich };`;
  // eslint-disable-next-line no-new-func -- see file header: pure, DOM-free source extracted from the page itself
  return new Function(body)();
}

const { renderCoachSandwich } = loadPureHelpers();

const FULL_COACH = {
  praise_vi: 'Con nói rất hay: "I went with my family" — nghe tự nhiên lắm!',
  focus_word: 'went',
  model_sentence_en: 'Last summer, I went to Đà Nẵng with my family.',
  tiny_challenge_vi: 'Thử thêm một câu tả cảm xúc của con nhé: "I felt excited!"',
};

// ---------------------------------------------------------------------------
// Absent/malformed coach -> byte-identical panel (silent omission)
// ---------------------------------------------------------------------------

test('renderCoachSandwich: absent result.coach renders nothing (byte-identical to the pre-V1.3 panel)', () => {
  assert.equal(renderCoachSandwich({ ok: true, score_percent: 80 }, true), '');
  assert.equal(renderCoachSandwich({ ok: true, coach: null }, true), '');
  assert.equal(renderCoachSandwich(null, true), '');
  assert.equal(renderCoachSandwich(undefined, false), '');
});

test('renderCoachSandwich: a malformed/partial coach object (any required field missing) renders nothing', () => {
  const base = FULL_COACH;
  assert.equal(renderCoachSandwich({ coach: { ...base, praise_vi: '' } }, true), '');
  assert.equal(renderCoachSandwich({ coach: { ...base, focus_word: '' } }, true), '');
  assert.equal(renderCoachSandwich({ coach: { ...base, model_sentence_en: '' } }, true), '');
  assert.equal(renderCoachSandwich({ coach: { ...base, tiny_challenge_vi: '' } }, true), '');
  assert.equal(renderCoachSandwich({ coach: 'not-an-object' }, true), '');
  assert.equal(renderCoachSandwich({ coach: 42 }, true), '');
});

// ---------------------------------------------------------------------------
// Full sandwich: fixed part order, verbatim structural copy, mood class
// ---------------------------------------------------------------------------

test('renderCoachSandwich: renders all four parts in fixed order (eyebrow -> praise -> focus word -> model sentence -> tiny challenge)', () => {
  const html = renderCoachSandwich({ coach: FULL_COACH }, true);
  const idx = (needle) => html.indexOf(needle);
  assert.ok(idx('minny-feedback-sandwich__eyebrow') > -1);
  assert.ok(idx('💬 Minny nói thêm') < idx('minny-feedback-sandwich__praise'));
  assert.ok(idx('minny-feedback-sandwich__praise') < idx('minny-feedback-sandwich__focus-label'));
  assert.ok(idx('minny-feedback-sandwich__focus-label') < idx('minny-feedback-sandwich__model'));
  assert.ok(idx('minny-feedback-sandwich__model') < idx('minny-feedback-sandwich__challenge'));
});

test('renderCoachSandwich: celebrate mood -> is-celebrate; otherwise is-encourage (matches caller\'s existing score cutoff, never recomputed here)', () => {
  const celebrate = renderCoachSandwich({ coach: FULL_COACH }, true);
  assert.match(celebrate, /class="minny-feedback-sandwich is-celebrate"/);
  const encourage = renderCoachSandwich({ coach: FULL_COACH }, false);
  assert.match(encourage, /class="minny-feedback-sandwich is-encourage"/);
});

test('renderCoachSandwich: focus word renders as a real minny-word button (existing tap-to-hear delegate), not a static span', () => {
  const html = renderCoachSandwich({ coach: FULL_COACH }, true);
  assert.match(html, /<button type="button" class="minny-word minny-word--close minny-word--focus" data-word="went">went<\/button>/);
});

test('renderCoachSandwich: model sentence renders with a tap-to-hear play button (speakup-grading-honesty-ui, 2026-07-14)', () => {
  const html = renderCoachSandwich({ coach: FULL_COACH }, true);
  assert.match(html, /<p class="minny-feedback-sandwich__model-en">"Last summer, I went to Đà Nẵng with my family\."<\/p>/);
  assert.match(
    html,
    /<button type="button" class="minny-word minny-word--close minny-model-play" data-sentence="Last summer, I went to Đà Nẵng with my family\.">🔊 Nghe mẫu<\/button>/,
  );
});

test('renderCoachSandwich: recast_en (optional field) has no slot in the approved mock and is never rendered', () => {
  const html = renderCoachSandwich({ coach: { ...FULL_COACH, recast_en: 'I went to Da Nang.' } }, true);
  assert.doesNotMatch(html, /I went to Da Nang\./);
});

// ---------------------------------------------------------------------------
// Every coach string is escaped (LLM-originated content)
// ---------------------------------------------------------------------------

test('renderCoachSandwich: escapes HTML in every coach-provided field (praise_vi, focus_word, model_sentence_en, tiny_challenge_vi)', () => {
  const hostile = {
    praise_vi: '<img src=x onerror=alert(1)>',
    focus_word: '<script>bad</script>',
    model_sentence_en: '<b>bold</b>',
    tiny_challenge_vi: '"><svg onload=alert(2)>',
  };
  const html = renderCoachSandwich({ coach: hostile }, true);
  assert.doesNotMatch(html, /<img /);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<b>bold<\/b>/);
  assert.doesNotMatch(html, /<svg /);
  assert.match(html, /&lt;script&gt;/);
});

test('renderCoachSandwich source calls escapeHtml on all four coach fields (source-level guard against a future un-escaped field)', () => {
  const src = extractFunctionSrc(speakingPage, 'renderCoachSandwich');
  assert.match(src, /escapeHtml\(praise_vi\)/);
  assert.match(src, /escapeHtml\(focus_word\)/);
  assert.match(src, /escapeHtml\(model_sentence_en\)/);
  assert.match(src, /escapeHtml\(tiny_challenge_vi\)/);
});

// ---------------------------------------------------------------------------
// Verbatim mock copy
// ---------------------------------------------------------------------------

test('mock copy verbatim: eyebrow, focus label, row icons', () => {
  assert.ok(speakingPage.includes('💬 Minny nói thêm'));
  assert.ok(speakingPage.includes('Từ để luyện thêm'));
  assert.ok(speakingPage.includes('>🌟</span>'));
  assert.ok(speakingPage.includes('>🎯</span>'));
  assert.ok(speakingPage.includes('>📘</span>'));
  assert.ok(speakingPage.includes('>✨</span>'));
});

// ---------------------------------------------------------------------------
// Wiring: renders UNDER the existing deterministic panel, before actions/
// fix-it invite -- order preserved, never touching the deterministic fields.
// ---------------------------------------------------------------------------

test('renderFrameResult: coach sandwich is appended after the smile chip, inside the same innerHTML write, before actionsEl/maybeShowFixitInvite', () => {
  const src = extractFunctionSrc(speakingPage, 'renderFrameResult');
  const smileIdx = src.indexOf('minny-frame-smile-chip');
  const coachIdx = src.indexOf('renderCoachSandwich(result, celebrate)');
  const actionsIdx = src.indexOf("actionsEl.classList.remove('hidden')");
  const fixitIdx = src.indexOf('maybeShowFixitInvite(result)');
  assert.ok(smileIdx > -1 && coachIdx > -1 && actionsIdx > -1 && fixitIdx > -1);
  assert.ok(smileIdx < coachIdx, 'coach sandwich must render after (below) the score/rubric/smile-chip panel');
  assert.ok(coachIdx < actionsIdx, 'coach sandwich must be part of the resultEl write, before the actions row is revealed');
  assert.ok(actionsIdx < fixitIdx, 'fix-it invite must still come after the actions row, never reordered');
});

test('renderResult (read/open): coach sandwich is appended after the rubric card, before actionsEl/maybeShowFixitInvite', () => {
  const src = extractFunctionSrc(speakingPage, 'renderResult');
  const rubricIdx = src.indexOf('minny-frame-rubric-card');
  const coachIdx = src.indexOf('renderCoachSandwich(result, passed)');
  // Two "actionsEl.classList.remove('hidden')" occurrences exist: the
  // early-return (!result?.ok) branch above, and the main success path
  // below the coach sandwich -- search from coachIdx to anchor the latter.
  const actionsIdx = src.indexOf("actionsEl.classList.remove('hidden')", coachIdx);
  const fixitIdx = src.indexOf('maybeShowFixitInvite(result);');
  assert.ok(rubricIdx > -1 && coachIdx > -1 && actionsIdx > -1 && fixitIdx > -1);
  assert.ok(rubricIdx < coachIdx);
  assert.ok(coachIdx < actionsIdx);
  assert.ok(actionsIdx < fixitIdx);
});

test('shipped deterministic panel untouched: score card, rubric card, smile chip, and the early-return failure branch all still present verbatim', () => {
  assert.match(speakingPage, /class="minny-frame-score-card"/);
  assert.match(speakingPage, /class="minny-frame-rubric-card"/);
  assert.match(speakingPage, /class="minny-frame-smile-chip"/);
  // renderResult's !result.ok early return must still bail out before ever
  // touching result.coach — a failed attempt never renders a sandwich.
  const renderResultSrc = extractFunctionSrc(speakingPage, 'renderResult');
  const earlyReturnIdx = renderResultSrc.indexOf('if (!result?.ok)');
  const coachCallIdx = renderResultSrc.indexOf('renderCoachSandwich(result, passed)');
  assert.ok(earlyReturnIdx > -1 && earlyReturnIdx < coachCallIdx);
});

// ---------------------------------------------------------------------------
// CSS: classes exist, values match the approved mock 1:1
// ---------------------------------------------------------------------------

test('.minny-feedback-sandwich CSS block and mood modifiers exist, copied from the approved mock', () => {
  assert.match(speakupCss, /\.minny-feedback-sandwich\s*\{[^}]*border-radius:\s*20px/s);
  assert.match(speakupCss, /\.minny-feedback-sandwich\.is-celebrate\s*\{/);
  assert.match(speakupCss, /\.minny-feedback-sandwich\.is-encourage\s*\{/);
  assert.match(speakupCss, /\.minny-feedback-sandwich__eyebrow\s*\{/);
  assert.match(speakupCss, /\.minny-feedback-sandwich__row\s*\{/);
  assert.match(speakupCss, /\.minny-feedback-sandwich__praise\s*\{/);
  assert.match(speakupCss, /\.minny-feedback-sandwich__focus-label\s*\{/);
  assert.match(speakupCss, /\.minny-feedback-sandwich__model-en\s*\{/);
  assert.match(speakupCss, /\.minny-feedback-sandwich__challenge\s*\{/);
  assert.match(speakupCss, /\.minny-word--focus\s*\{[^}]*font-size:\s*16px/s);
});

// ---------------------------------------------------------------------------
// 44px floor + reduced motion — reused via the existing .minny-word base
// rule (no new touch-target or animation code needed for the focus chip).
// ---------------------------------------------------------------------------

test('focus chip meets the 44px floor by reusing the existing .minny-word base rule (the --focus modifier only changes size/padding/radius)', () => {
  assert.match(speakupCss, /\.minny-word\s*\{[^}]*min-height:\s*44px/s);
  const focusRule = speakupCss.match(/\.minny-word--focus\s*\{([^}]*)\}/s)[1];
  assert.doesNotMatch(focusRule, /min-height/, 'the modifier must not override the base 44px floor');
});

test('reduced-motion still disables the shared .minny-word.is-loading tap-to-hear pulse (focus chip uses the same class, no new animation introduced)', () => {
  const rule = /@media \(prefers-reduced-motion: reduce\)[^@]*?\.minny-word\.is-loading\s*\{[^}]*animation:\s*none/s;
  assert.match(speakupCss, rule);
});
