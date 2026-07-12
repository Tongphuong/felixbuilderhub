// V1.2 packet 1 (Wave D Set 1 mock): L1-L2 choice-chip / sentence-frame /
// repair-choice / hands-free UI added to speak-up.astro's Free Talking view.
//
// This repo has no jsdom dependency (see tests/read2lead-book-reader-behaviour
// .test.mjs's header note), so DOM-mutating code in the page's inline
// <script> is verified the way the rest of this file's tests already do:
// string/region assertions on the raw source (see tests/minny-speaking
// .test.mjs, tests/r2l-recorder-engine.test.mjs).
//
// The actual chip-gating / sentence-frame / repair-choice DECISIONS, though,
// were written as pure, DOM-free functions specifically so they could get
// real behavioral coverage here -- this file extracts them straight out of
// the page's inline script (brace-matched slice, like the region checks in
// r2l-recorder-engine.test.mjs) and evaluates them via `new Function`. That
// is safe for exactly these functions because they take plain data in and
// return plain data out; nothing here touches `document`/`window`/network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const speakingPage = readFileSync('src/pages/speak-up.astro', 'utf-8');
// The free-talk styles MUST live in speakup-app.css -- the only stylesheet
// SpeakUpAppLayout imports. speakup-free-talk.css is an orphaned duplicate
// (imported nowhere); styles added there never reach the page (rule-20
// render check caught exactly this on 2026-07-11).
const freeTalkCss = readFileSync('src/styles/speakup-app.css', 'utf-8');

function extractFunctionSrc(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `function ${name} not found in speak-up.astro`);
  // Skip past the parameter list first (brace-depth counting from the first
  // "{" anywhere after `start` would stop early at a default-value object
  // literal like `opts = {}` in the signature) -- find the paren that closes
  // the params, then the function body's own opening brace after that.
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
  const re = new RegExp(`const ${name}\\s*=\\s*[^;]+;`);
  const m = source.match(re);
  assert.ok(m, `const ${name} not found in speak-up.astro`);
  return m[0];
}

// Pulls the pure V1.2-packet-1 helpers out of the page's inline script and
// returns them as real callables. Order matters only in that
// ftShowStarterHint needs its FT_STARTER_HINT_MAX_TURNS constant, and
// ftPlanScaffold calls the others -- all defined as plain `function`
// declarations (hoisted), so concatenation order is otherwise irrelevant.
function loadPureHelpers() {
  const pieces = [
    extractConstSrc(speakingPage, 'FT_STARTER_HINT_MAX_TURNS'),
    extractConstSrc(speakingPage, 'FT_REPAIR_TAGS'),
    extractFunctionSrc(speakingPage, 'ftNormalizeWord'),
    extractFunctionSrc(speakingPage, 'ftHasChips'),
    extractFunctionSrc(speakingPage, 'ftIsRepairChoiceState'),
    extractFunctionSrc(speakingPage, 'ftRepairTag'),
    extractFunctionSrc(speakingPage, 'ftBuildSentenceFrame'),
    extractFunctionSrc(speakingPage, 'ftShowStarterHint'),
    extractFunctionSrc(speakingPage, 'ftPlanScaffold'),
  ];
  const body = `${pieces.join('\n\n')}\n\nreturn { ftNormalizeWord, ftHasChips, ftIsRepairChoiceState, ftRepairTag, ftBuildSentenceFrame, ftShowStarterHint, ftPlanScaffold };`;
  // eslint-disable-next-line no-new-func -- see file header: pure, DOM-free source extracted from the page itself
  return new Function(body)();
}

const {
  ftNormalizeWord, ftHasChips, ftIsRepairChoiceState, ftRepairTag, ftBuildSentenceFrame, ftShowStarterHint, ftPlanScaffold,
} = loadPureHelpers();

// ---------------------------------------------------------------------------
// Level gating: chips/frame/repair-choices render ONLY off the response
// shape (`options`/`repair`/`repair_step`), never a client-side level lookup
// -- assert the behavior AND that no such lookup exists in the source.
// ---------------------------------------------------------------------------

test('level gating: chip helpers never reference a client-side level value', () => {
  const src = [
    extractFunctionSrc(speakingPage, 'ftHasChips'),
    extractFunctionSrc(speakingPage, 'ftIsRepairChoiceState'),
    extractFunctionSrc(speakingPage, 'ftPlanScaffold'),
  ].join('\n');
  assert.doesNotMatch(src, /\blevel\b/i, 'gating must key off the response shape only, per the packet\'s acceptance criteria');
});

test('ftHasChips: true only for a turn response carrying 1+ options', () => {
  assert.equal(ftHasChips({ options: ['Dogs!', 'Cats!'] }), true);
  assert.equal(ftHasChips({ options: [] }), false, 'empty options array is not chip-bearing');
  assert.equal(ftHasChips({}), false);
  assert.equal(ftHasChips({ options: 'not-an-array' }), false);
  assert.equal(ftHasChips(null), false);
  assert.equal(ftHasChips(undefined), false);
});

test('ftIsRepairChoiceState: keyed on repair_step === "choices" (2026-07-11 round 2), not raw options-presence', () => {
  assert.equal(ftIsRepairChoiceState({ repair: true, repair_step: 'choices', options: ['A dog!', 'A cat!'] }), true);
  assert.equal(
    ftIsRepairChoiceState({ repair: true, repair_step: 'rephrase', options: ['A dog!', 'A cat!'] }),
    false,
    'rephrase carries options too, but renders as NORMAL chips (screen 4), not the oversized buttons',
  );
  assert.equal(ftIsRepairChoiceState({ repair: true, repair_step: 'model' }), false);
  assert.equal(ftIsRepairChoiceState({ repair: true, repair_step: 'move_on' }), false);
  assert.equal(ftIsRepairChoiceState({ repair: true, repair_step: 'choices' }), false, 'defensive: still requires options to actually be present');
  assert.equal(ftIsRepairChoiceState({}), false);
});

test('ftRepairTag: approved mock copy for rephrase/choices/model; no tag for move_on/vn_nudge', () => {
  assert.equal(ftRepairTag('rephrase'), 'Câu hỏi đơn giản hơn');
  assert.equal(ftRepairTag('choices'), 'Xác nhận lại');
  assert.equal(ftRepairTag('model'), 'Minny mẫu câu trả lời');
  assert.equal(ftRepairTag('move_on'), null);
  assert.equal(ftRepairTag('vn_nudge'), null);
  assert.equal(ftRepairTag(undefined), null);
});

// ---------------------------------------------------------------------------
// Sentence-frame construction (drives what the kid is told to say aloud)
// ---------------------------------------------------------------------------

test('ftBuildSentenceFrame: picks the longest expected[] variant containing the tapped option\'s word', () => {
  const expected = ['dog', 'dogs', 'a dog', 'i like dogs', 'cat', 'cats', 'a cat', 'i like cats'];
  const dogs = ftBuildSentenceFrame('Dogs!', expected);
  assert.equal(dogs.sentence, 'I like dogs');
  assert.equal(dogs.blank, 'dogs');

  const cats = ftBuildSentenceFrame('Cats!', expected);
  assert.equal(cats.sentence, 'I like cats');
});

test('ftBuildSentenceFrame: picks the LONGEST match, not just any match', () => {
  const expected = ['big', 'small', 'it is big', 'it is small', 'my cat is big', 'my cat is small'];
  const big = ftBuildSentenceFrame('Big!', expected);
  assert.equal(big.sentence, 'My cat is big');
  assert.equal(big.blank, 'big');
});

test('ftBuildSentenceFrame: falls back to the option text itself when nothing matches (always renders something)', () => {
  const frame = ftBuildSentenceFrame('Pizza!', ['dog', 'cat']);
  assert.equal(frame.sentence, 'Pizza!');
  assert.equal(frame.blank, 'Pizza!');
});

test('ftBuildSentenceFrame: word-boundary safe, mirrors the server-side "catapult" fix (_minny-repair.js)', () => {
  const frame = ftBuildSentenceFrame('Cat!', ['catapult', 'a cat']);
  assert.equal(frame.sentence, 'A cat', '"cat" must not match inside "catapult"');
});

// ---------------------------------------------------------------------------
// Sentence-starter hint fade (screen 1 shows it, screen 3 -- later in the
// same L1-L2 range -- does not)
// ---------------------------------------------------------------------------

test('ftShowStarterHint: shown on the session\'s first chip turns, fades after', () => {
  assert.equal(ftShowStarterHint(1), true);
  assert.equal(ftShowStarterHint(2), true);
  assert.equal(ftShowStarterHint(3), false);
  assert.equal(ftShowStarterHint(10), false);
});

// ---------------------------------------------------------------------------
// The overall per-turn plan (what ftApplyScaffold paints)
// ---------------------------------------------------------------------------

test('ftPlanScaffold: a normal (non-repair) turn with options plans chip mode with the hint on early turns, no tag', () => {
  const data = { options: ['Dogs!', 'Cats!'], expected: ['dog', 'cat'] };
  const early = ftPlanScaffold(data, 1);
  assert.equal(early.mode, 'chips');
  assert.equal(early.showHint, true);
  assert.equal(early.tag, null);
  assert.deepEqual(early.options, ['Dogs!', 'Cats!']);

  const later = ftPlanScaffold(data, 5);
  assert.equal(later.mode, 'chips');
  assert.equal(later.showHint, false, 'hint fades with in-range progress (mock screen 3)');
});

test('ftPlanScaffold: absent without options (a normal turn with no options plans nothing)', () => {
  assert.deepEqual(ftPlanScaffold({ reply_en: 'Tell me more!', mood: 'idle' }, 1), { mode: 'none', tag: null });
});

test('ftPlanScaffold: repair_step "rephrase" plans NORMAL chips (screen 4), always with the hint, tagged', () => {
  const data = { repair: true, repair_step: 'rephrase', options: ['A dog!', 'A cat!'], expected: ['dog', 'cat'] };
  const plan = ftPlanScaffold(data, 99); // even far past the normal fade window
  assert.equal(plan.mode, 'chips');
  assert.equal(plan.showHint, true, 'rephrase always re-shows the hint -- a struggling kid needs more scaffolding, not less');
  assert.equal(plan.tag, 'Câu hỏi đơn giản hơn');
  assert.deepEqual(plan.options, ['A dog!', 'A cat!']);
});

test('ftPlanScaffold: repair_step "choices" plans the oversized two-choice buttons, capped at 2, tagged', () => {
  const plan = ftPlanScaffold({ repair: true, repair_step: 'choices', options: ['A dog!', 'A cat!', 'A bird!'] }, 0);
  assert.equal(plan.mode, 'repair-choices');
  assert.deepEqual(plan.options, ['A dog!', 'A cat!'], 'repair_choices only ever fills two slots (a/b) server-side');
  assert.equal(plan.tag, 'Xác nhận lại');
});

test('ftPlanScaffold: repair_step "model" plans plain chrome but STILL shows its tag', () => {
  const plan = ftPlanScaffold({ repair: true, repair_step: 'model', reply_en: 'You can say: I have a cat!' }, 0);
  assert.equal(plan.mode, 'none');
  assert.equal(plan.tag, 'Minny mẫu câu trả lời');
});

test('ftPlanScaffold: repair_step "move_on" and "vn_nudge" plan plain chrome with NO tag, even if they happen to carry options', () => {
  const moveOn = ftPlanScaffold({ repair: true, repair_step: 'move_on', reply_en: 'Good try!' }, 0);
  assert.deepEqual(moveOn, { mode: 'none', tag: null });

  // vn_nudge can carry the same options/expected as the abandoned question
  // (server keeps re-sending them at step 1) -- per Elon's round-2 call,
  // "everything else" besides rephrase/choices is plain chrome regardless.
  const vnNudge = ftPlanScaffold({ repair: true, repair_step: 'vn_nudge', options: ['A dog!', 'A cat!'] }, 0);
  assert.equal(vnNudge.mode, 'none', 'vn_nudge never renders chips even when options happen to be present');
  assert.equal(vnNudge.tag, null);
});

// ---------------------------------------------------------------------------
// DOM-side wiring: structural / string-presence checks (repo convention for
// this file -- see tests/minny-speaking.test.mjs, tests/r2l-recorder-engine
// .test.mjs -- no jsdom available to execute these against a real DOM).
// ---------------------------------------------------------------------------

test('new markup: scaffold container, hands-free toggle, and listening indicator exist', () => {
  assert.match(speakingPage, /id="ft-scaffold" class="ft-scaffold"/);
  assert.match(speakingPage, /id="ft-handsfree-toggle"/);
  assert.match(speakingPage, /class="minny-handsfree"/);
  assert.match(speakingPage, /id="ft-listening-indicator" class="minny-listening-indicator hidden"/);
  assert.match(speakingPage, /Minny đang nghe…/);
  assert.match(speakingPage, /🎙️ Tự động nghe/);
});

test('chip tap never submits/skips speaking: ftOnChipTap only mutates the DOM, no network call', () => {
  const src = extractFunctionSrc(speakingPage, 'ftOnChipTap');
  assert.doesNotMatch(src, /fetch\(/, 'chip tap must not fire a network call (mock: "UI-state change only")');
  assert.doesNotMatch(src, /ftSubmitAudio|ftSubmitTranscript/, 'chip tap must never submit a turn on the kid\'s behalf');
  assert.match(src, /minny-sentence-frame/, 'chip tap reveals the sentence frame');
  assert.match(src, /Mic đã sẵn sàng/, 'chip tap shows the mic-armed confirmation line (mock screen 2)');
});

test('repair-choice tap (step b) DOES resolve the turn by sending the tapped text as the transcript', () => {
  const src = extractFunctionSrc(speakingPage, 'ftApplyScaffold');
  const repairBranch = src.slice(src.indexOf("plan.mode === 'repair-choices'"));
  assert.match(repairBranch, /ftSubmitTranscript\(optionText\)/, 'the ladder\'s one tap-alone-answers exception');

  const submitSrc = extractFunctionSrc(speakingPage, 'ftSubmitTranscript');
  assert.match(submitSrc, /action:\s*'turn'/);
  assert.match(submitSrc, /transcript:\s*text/, 'sends the tapped option text as the transcript, per the legacy JSON turn path');
  assert.match(submitSrc, /session_id:\s*ft\.sessionId/);
});

test('ftApplyScaffold renders the repair-tag label independently of the mode (even mode "none")', () => {
  const src = extractFunctionSrc(speakingPage, 'ftApplyScaffold');
  const tagBranch = src.slice(0, src.indexOf("plan.mode === 'none'"));
  assert.match(tagBranch, /minny-repair-tag/, 'the tag must render BEFORE the mode-\'none\' early return, so e.g. repair_step "model" still shows its label');
  assert.match(tagBranch, /if \(plan\.tag\)/);
});

test('ftHandleTurnResponse renders the scaffold + subtitle_vi for every non-ended turn, and clears both on ended/reset', () => {
  const handleSrc = extractFunctionSrc(speakingPage, 'ftHandleTurnResponse');
  assert.match(handleSrc, /ftApplyScaffold\(ftPlanScaffold\(data, ft\.chipTurnsSeen\)\)/);
  assert.match(handleSrc, /ftRenderSubtitle\(data\.subtitle_vi\)/);
  assert.match(handleSrc, /ftApplyScaffold\(\{ mode: 'none' \}\)/, 'the ended-session branch clears any chips before wrap-up');

  const resetSrc = extractFunctionSrc(speakingPage, 'ftReset');
  assert.match(resetSrc, /ftClearScaffold\(\)/, 'chips must not survive a session reset');
  assert.match(resetSrc, /chipTurnsSeen = 0/);
});

test('hands-free toggle reflects and writes the r2l_ft_handsfree flag; listening indicator ties to the armed VAD state', () => {
  assert.match(speakingPage, /getElementById\('ft-handsfree-toggle'\)\?\.addEventListener\('click'/);
  assert.match(speakingPage, /localStorage\.setItem\('r2l_ft_handsfree', next\)/);

  const updateSrc = extractFunctionSrc(speakingPage, 'ftUpdateHandsFreeToggle');
  assert.match(updateSrc, /ftHandsFreeOn\(\)/, 'reads the SAME flag ftMaybeAutoArm/ftStartRecording already use, not a second source of truth');
  assert.match(updateSrc, /classList\.toggle\('is-on', on\)/);

  const startVadSrc = extractFunctionSrc(speakingPage, 'ftStartVad');
  assert.match(startVadSrc, /ftShowListening\(\)/, 'listening indicator appears once VAD actually starts watching the mic');
  const stopVadSrc = extractFunctionSrc(speakingPage, 'ftStopVad');
  assert.match(stopVadSrc, /ftHideListening\(\)/, 'every VAD-stop path (turn sent, cap reached, tab hidden, hands-free off) hides it again');
});

// ---------------------------------------------------------------------------
// 44px targets + reduced motion (per the mock's own accessibility notes)
// ---------------------------------------------------------------------------

test('.minny-repair-tag CSS exists (approved mock copy pill for rephrase/choices/model)', () => {
  assert.match(freeTalkCss, /\.minny-repair-tag\s*\{/);
});

test('new tappable targets meet the 44px floor', () => {
  assert.match(freeTalkCss, /\.minny-option-chip\s*\{[^}]*min-height:\s*44px/s);
  assert.match(freeTalkCss, /\.minny-handsfree\s*\{[^}]*min-height:\s*44px/s);
  assert.match(freeTalkCss, /\.minny-repair-choice-btn\s*\{[^}]*min-height:\s*56px/s, 'well over the 44px floor, per the mock\'s own note');
});

// speakup-word-level-feedback (V1, 2026-07-12): word chips upgraded from
// spans to real buttons so they meet the same 44px floor.
test('.minny-word chip buttons meet the 44px floor and reuse an existing pulse animation for the tap-to-hear loading state', () => {
  assert.match(freeTalkCss, /\.minny-word\s*\{[^}]*min-height:\s*44px/s);
  assert.match(freeTalkCss, /\.minny-word\.is-loading\s*\{[^}]*animation:\s*minny-listen-pulse/s, 'reuses the listening-indicator pulse keyframe rather than defining a new one');
});

test('reduced-motion disables the .minny-word loading pulse', () => {
  const rule = /@media \(prefers-reduced-motion: reduce\)[^@]*?\.minny-word\.is-loading\s*\{[^}]*animation:\s*none/s;
  assert.match(freeTalkCss, rule);
});

test('reduced-motion disables the new listening-indicator pulse (this file\'s per-selector convention, not the mock\'s blanket *-rule)', () => {
  // speakup-app.css legitimately has more than one reduced-motion media
  // block (the pre-existing one plus the V1.2 additions) -- assert the rule
  // lives inside ANY of them, not just the first.
  const rule = /@media \(prefers-reduced-motion: reduce\)[^@]*?\.minny-listening-indicator__dot\s*\{[^}]*animation:\s*none/s;
  assert.match(freeTalkCss, rule);
});
