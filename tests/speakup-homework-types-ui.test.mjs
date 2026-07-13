// Schema v3 (homework-tasks-contract.md §8, 2026-07-13): the kid-facing UI
// for the three NEW homework task types (story/picture/build) plus qa
// riding the existing frame path, added to speak-up.astro's existing
// homework step screen (no new page shape, per the founder's "reuse the
// existing homework layout" decision).
//
// This repo has no jsdom (see tests/speakup-chips-ui.test.mjs's header
// note), so this file follows that same convention: string/region
// assertions on the raw source, plus `new Function`-extracted pure helpers
// for the one genuinely algorithmic piece (build's sentence assembly).

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

function extractConstSrc(source, name) {
  const re = new RegExp(`const ${name}\\s*=\\s*\\{[\\s\\S]*?\\n    \\};`);
  const m = source.match(re);
  assert.ok(m, `const ${name} not found in speak-up.astro`);
  return m[0];
}

// buildAssembleSentence closes over the page's module-level `state` object
// (state.buildSelections) -- exposed here as a function parameter so tests
// can supply their own selections without a DOM.
function makeBuildAssembler() {
  const src = extractFunctionSrc(speakingPage, 'buildAssembleSentence');
  // buildAssembleSentence reads two module-level regexes (BUILD_CLAUSE_START
  // for clause commas, BUILD_BLANK_MARKER for the ___/… placeholder position),
  // so the extracted source needs both in scope.
  const clauseRe = speakingPage.match(/const BUILD_CLAUSE_START = .*;/);
  assert.ok(clauseRe, 'BUILD_CLAUSE_START not found in speak-up.astro');
  const markerRe = speakingPage.match(/const BUILD_BLANK_MARKER = .*;/);
  assert.ok(markerRe, 'BUILD_BLANK_MARKER not found in speak-up.astro');
  // eslint-disable-next-line no-new-func -- see file header: pure source extracted from the page itself
  return new Function('state', `${clauseRe[0]}\n${markerRe[0]}\n${src}\nreturn buildAssembleSentence;`);
}

const buildAssemblerFactory = makeBuildAssembler();
function assembleWith(buildSelections, step) {
  return buildAssemblerFactory({ buildSelections })(step);
}

// ---------------------------------------------------------------------------
// build task_type: sentence assembly (the one genuinely algorithmic piece
// Steve had discretion over -- see dispatch report)
// ---------------------------------------------------------------------------

const BUILD_STEP = {
  task_type: 'build',
  columns: [
    { id: 'c1', label_en: 'We…', options: ['play football', 'draw pictures'] },
    { id: 'c2', label_en: 'At…', options: ['school', 'the park'] },
  ],
};

test('buildAssembleSentence: strips the trailing ellipsis, lowercases continuation labels, capitalizes and punctuates', () => {
  const sentence = assembleWith({ c1: 'play football', c2: 'school' }, BUILD_STEP);
  // NOT "We play football At school." — the assembled string is both shown to
  // the child to read aloud AND sent as expected_text for word-level scoring,
  // so a mid-sentence capital would be wrong on both counts.
  assert.equal(sentence, 'We play football at school.');
});

// Phương's real Stage 4 lesson: "We… / At… / We feel… / Because…". A naive
// space-join produced the run-on "We play football At school We feel happy
// Because it is fun." — a new clause ("we feel…") must take a comma.
test('buildAssembleSentence: real 4-column lesson assembles into natural English', () => {
  const step = {
    task_type: 'build',
    columns: [
      { id: 'c1', label_en: 'We…', options: ['play football'] },
      { id: 'c2', label_en: 'At…', options: ['school'] },
      { id: 'c3', label_en: 'We feel…', options: ['happy'] },
      { id: 'c4', label_en: 'Because…', options: ['it is fun'] },
    ],
  };
  const sentence = assembleWith(
    { c1: 'play football', c2: 'school', c3: 'happy', c4: 'it is fun' },
    step,
  );
  assert.equal(sentence, 'We play football at school, we feel happy because it is fun.');
});

test('buildAssembleSentence: returns null until every column has a pick', () => {
  assert.equal(assembleWith({}, BUILD_STEP), null);
  assert.equal(assembleWith({ c1: 'play football' }, BUILD_STEP), null, 'one of two columns picked is not enough');
});

test('buildAssembleSentence: does not double-punctuate a pick that already ends in punctuation', () => {
  const step = { task_type: 'build', columns: [{ id: 'c1', label_en: 'We feel', options: ['happy!'] }] };
  assert.equal(assembleWith({ c1: 'happy!' }, step), 'We feel happy!');
});

test('buildAssembleSentence: a label with no options text still falls back to something (no columns -> null)', () => {
  assert.equal(assembleWith({}, { task_type: 'build', columns: [] }), null);
});

// ---------------------------------------------------------------------------
// Rubric copy follows task_type (packet C)
// ---------------------------------------------------------------------------

test('FRAME_RUBRIC_ROW1_VI: per-task_type rubric row 1 copy, present unchanged', () => {
  const src = extractConstSrc(speakingPage, 'FRAME_RUBRIC_ROW1_VI');
  // eslint-disable-next-line no-new-func
  const map = new Function(`${src}\nreturn FRAME_RUBRIC_ROW1_VI;`)();
  assert.equal(map.present, 'Nói đủ các câu trong khung', 'present keeps the pre-existing copy byte-identical');
  assert.equal(map.story, 'Con dùng đủ từ thầy dặn?');
  assert.equal(typeof map.picture, 'string');
  assert.equal(typeof map.qa, 'string');
});

test('renderFrameResult picks the rubric row-1 label from the CURRENT step\'s task_type, falling back to present', () => {
  const src = extractFunctionSrc(speakingPage, 'renderFrameResult');
  assert.match(src, /FRAME_RUBRIC_ROW1_VI\[taskType\] \|\| FRAME_RUBRIC_ROW1_VI\.present/);
  assert.match(src, /currentStep\(\)\?\.task_type/);
});

// ---------------------------------------------------------------------------
// story: must_use[] words are SHOWN (never hidden) -- contrast with picture
// ---------------------------------------------------------------------------

test('markup: story must-use chips container and build columns/reveal containers exist inside the story card', () => {
  assert.match(speakingPage, /id="story-must-use" class="spk-must-use hidden"/);
  assert.match(speakingPage, /id="story-must-use-chips"/);
  assert.match(speakingPage, /id="build-columns" class="spk-build-columns hidden"/);
  assert.match(speakingPage, /id="build-reveal" class="hidden"/);
});

test('renderStoryMustUse renders step.must_use, never touches anchor_words', () => {
  const src = extractFunctionSrc(speakingPage, 'renderStoryMustUse');
  assert.match(src, /step\?\.task_type === 'story'/);
  assert.match(src, /step\.must_use/);
  assert.doesNotMatch(src, /anchor_words/, 'must_use is the explicitly-shown field; anchor_words must never be read here');
});

// ---------------------------------------------------------------------------
// picture: anchors must NEVER reach the DOM (contract #8's hard rule)
// ---------------------------------------------------------------------------

test('renderFrameStems never reads stems[].anchor_words -- only text_en, and skips the redundant list for story', () => {
  const src = extractFunctionSrc(speakingPage, 'renderFrameStems');
  // Live-code check (comments legitimately mention anchor_words to explain
  // why it's NOT read here -- the standalone whole-script test below strips
  // comments before asserting; this one just checks the actual rendering
  // never touches stem.anchor_words / s.anchor_words as a property access).
  assert.doesNotMatch(src, /\bstem\.anchor_words\b|\bs\.anchor_words\b/, 'the frame-stems list must only ever render stem.text_en');
  assert.match(src, /task_type !== 'story'/);
  assert.match(src, /hasText/, 'an all-empty-text stem list (picture-with-anchors) must not render a bare numbered bullet');
});

test('no rendering function in the whole page ever reads .anchor_words except the documented comments explaining why not to', () => {
  // Every literal occurrence of "anchor_words" in the script must be inside
  // a comment (// or /* */), never live code that reads the field.
  const scriptStart = speakingPage.indexOf('<script>');
  const scriptEnd = speakingPage.indexOf('</script>');
  const script = speakingPage.slice(scriptStart, scriptEnd);
  const lines = script.split('\n');
  for (const line of lines) {
    if (!line.includes('anchor_words')) continue;
    const trimmed = line.trim();
    const isComment = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
    assert.ok(isComment, `live (non-comment) reference to anchor_words found: "${trimmed}"`);
  }
});

// ---------------------------------------------------------------------------
// build: tapping a chip never submits/skips speaking -- it only reveals the
// sentence and arms the mic (contract's explicit "reuse the Free Talk chip
// pattern" instruction)
// ---------------------------------------------------------------------------

test('build chip tap handler only mutates state + calls buildMaybeReveal, never fetches/submits', () => {
  const idx = speakingPage.indexOf("document.getElementById('build-columns')?.addEventListener('click'");
  assert.notEqual(idx, -1, 'build-columns click delegate not found');
  const region = speakingPage.slice(idx, idx + 800);
  assert.doesNotMatch(region, /fetch\(/, 'chip tap must not fire a network call');
  assert.doesNotMatch(region, /submitAudio/, 'chip tap must never submit a turn on the kid\'s behalf');
  assert.match(region, /buildMaybeReveal\(\)/);
});

test('buildMaybeReveal reuses the shipped Free Talk sentence-frame markup and mutates the step in place (no new submit plumbing needed)', () => {
  const src = extractFunctionSrc(speakingPage, 'buildMaybeReveal');
  assert.match(src, /minny-sentence-frame/);
  assert.match(src, /Mic đã sẵn sàng/);
  assert.match(src, /step\.expected_text = sentence/, 'mutates the CURRENT step object so submitAudio\'s existing expected_text plumbing needs no changes');
  assert.match(src, /state\.buildArmed = true/);
  assert.doesNotMatch(src, /fetch\(/);
});

test('renderBuildColumns resets selections/armed state per step and reuses .minny-options/.minny-option-chip', () => {
  const src = extractFunctionSrc(speakingPage, 'renderBuildColumns');
  assert.match(src, /state\.buildSelections = \{\}/);
  assert.match(src, /state\.buildArmed = false/);
  assert.match(src, /class="minny-options"/);
  assert.match(src, /class="minny-option-chip"/);
});

test('updateRecordUi disables the record button until every build column is picked, with a kid-facing hint', () => {
  const src = extractFunctionSrc(speakingPage, 'updateRecordUi');
  assert.match(src, /buildNotArmed = step\?\.task_type === 'build' && !state\.buildArmed/);
  assert.match(src, /btn\.disabled = !micReady\(\) \|\| micBlocked \|\| buildNotArmed/);
  assert.match(src, /Con chọn một ô ở mỗi cột trước nhé!/);
});

// ---------------------------------------------------------------------------
// Photo visibility: per-step show_photo, backward-compatible default
// ---------------------------------------------------------------------------

test('renderStep gates the homework photo thumbnail on step.show_photo, defaulting to shown when the step predates the field', () => {
  const src = extractFunctionSrc(speakingPage, 'renderStep');
  assert.match(src, /step\.show_photo === undefined \? true : !!step\.show_photo/);
});

// ---------------------------------------------------------------------------
// 44px targets (kid-facing; picture/build/story additions)
// ---------------------------------------------------------------------------

test('new kid-facing CSS exists and reuses/keeps the 44px tap-target floor', () => {
  assert.match(speakupCss, /\.spk-must-use-chip\s*\{/);
  assert.match(speakupCss, /\.spk-build-columns\s*\{/);
  assert.match(speakupCss, /\.spk-build-column__label\s*\{/);
  // .minny-option-chip (reused verbatim for build) already carries the
  // 44px floor -- covered by tests/speakup-chips-ui.test.mjs; re-asserted
  // here so this file stands alone as evidence for the build task type.
  assert.match(speakupCss, /\.minny-option-chip\s*\{[^}]*min-height:\s*44px/s);
});

// --- Buffet red-team fix (2026-07-13): the ellipsis is a PLACEHOLDER POSITION ---
// Elon's first fix stripped a trailing "…" only. A label with punctuation AFTER
// the marker ("Do you like...?") was left unstripped, producing the ungradeable
// "Do you like...? pizza yes, because it is tasty." — and that string is BOTH
// read aloud by the child AND scored word-by-word.
test('buildAssembleSentence: substitutes AT a mid-label blank marker (Buffet repro)', () => {
  const step = {
    task_type: 'build',
    columns: [
      { id: 'c1', label_en: 'Do you like...?', options: ['pizza'] },
      { id: 'c2', label_en: 'Yes, because...', options: ['it is tasty'] },
    ],
  };
  const sentence = assembleWith({ c1: 'pizza', c2: 'it is tasty' }, step);
  assert.equal(sentence, 'Do you like pizza? yes, because it is tasty.');
  assert.ok(!sentence.includes('...'), 'the blank marker must never survive into the spoken sentence');
});

test('buildAssembleSentence: a label with no blank marker still appends', () => {
  const step = {
    task_type: 'build',
    columns: [{ id: 'c1', label_en: 'We', options: ['play football'] }],
  };
  assert.equal(assembleWith({ c1: 'play football' }, step), 'We play football.');
});

test('buildAssembleSentence: an empty label just uses the option', () => {
  const step = {
    task_type: 'build',
    columns: [{ id: 'c1', label_en: '', options: ['play football'] }],
  };
  assert.equal(assembleWith({ c1: 'play football' }, step), 'Play football.');
});
