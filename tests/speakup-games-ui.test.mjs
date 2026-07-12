// V1.2 packet 2 (Wave D2 mock): L3-L5 topic-pick session start, 💡 hint
// on-demand states, game framing added to speak-up.astro's Free Talking view.
//
// Same repo convention as tests/speakup-chips-ui.test.mjs (no jsdom
// available — see that file's header): the pure, DOM-free decision
// functions are extracted straight out of the page's inline script
// (brace-matched slice) and evaluated via `new Function`; the DOM-writing
// functions and markup get string/region assertions on the raw source.
//
// Standing traps this packet was warned about (both already bit the team
// once): styles MUST live in src/styles/speakup-app.css --
// speakup-free-talk.css is an orphaned duplicate, imported nowhere (see
// tests/speakup-chips-ui.test.mjs); and Minny is the red robot -- any koala
// in a mock is a placeholder, so new markup uses /assets/minny/minny_*.png.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HUB_TOPICS } from '../src/pages/ho-so/ho-so-topics.ts';

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

// Pulls the pure V1.2-packet-2 helpers out of the page's inline script and
// returns them as real callables -- none of them depend on each other or on
// a shared const, unlike packet 1's loadPureHelpers, so concatenation order
// doesn't matter here.
function loadPureHelpers() {
  const pieces = [
    extractFunctionSrc(speakingPage, 'ftIsPickerLevel'),
    extractFunctionSrc(speakingPage, 'ftIsGameLevel'),
    extractFunctionSrc(speakingPage, 'ftHintAvailable'),
    extractFunctionSrc(speakingPage, 'ftHintType'),
    extractFunctionSrc(speakingPage, 'ftGameFramingClass'),
  ];
  const body = `${pieces.join('\n\n')}\n\nreturn { ftIsPickerLevel, ftIsGameLevel, ftHintAvailable, ftHintType, ftGameFramingClass };`;
  // eslint-disable-next-line no-new-func -- see file header: pure, DOM-free source extracted from the page itself
  return new Function(body)();
}

const {
  ftIsPickerLevel, ftIsGameLevel, ftHintAvailable, ftHintType, ftGameFramingClass,
} = loadPureHelpers();

// ---------------------------------------------------------------------------
// Picker gating: the ONE place a client-side level value legitimately gates
// UI (it must decide before any turn response exists) -- L3+ yes, L0-L2 no.
// ---------------------------------------------------------------------------

test('ftIsPickerLevel: L3/L4/L5 only', () => {
  assert.equal(ftIsPickerLevel('L3'), true);
  assert.equal(ftIsPickerLevel('L4'), true);
  assert.equal(ftIsPickerLevel('L5'), true);
  assert.equal(ftIsPickerLevel('L0'), false);
  assert.equal(ftIsPickerLevel('L1'), false);
  assert.equal(ftIsPickerLevel('L2'), false);
  assert.equal(ftIsPickerLevel(undefined), false);
  assert.equal(ftIsPickerLevel(''), false);
});

test('ftIsGameLevel: L4/L5 only (game cards never show at L3)', () => {
  assert.equal(ftIsGameLevel('L4'), true);
  assert.equal(ftIsGameLevel('L5'), true);
  assert.equal(ftIsGameLevel('L3'), false);
  assert.equal(ftIsGameLevel('L2'), false);
  assert.equal(ftIsGameLevel(undefined), false);
});

test('enterFreeTalking branches on ftIsPickerLevel(state.level): picker for L3+, straight to start otherwise', () => {
  const src = extractFunctionSrc(speakingPage, 'enterFreeTalking');
  assert.match(src, /if \(ftIsPickerLevel\(state\.level\)\)/);
  assert.match(src, /ftShowTopicPicker\(\)/);
  assert.match(src, /\}\s*else\s*\{\s*startFreeTalkSession\(\);/);
});

test('ftShowTopicPicker: game-card sections toggle on ftIsGameLevel(state.level), never a raw level string check', () => {
  const src = extractFunctionSrc(speakingPage, 'ftShowTopicPicker');
  assert.match(src, /ftIsGameLevel\(state\.level\)/);
  assert.match(src, /ft-picker-games-label/);
  assert.match(src, /ft-picker-game-cards/);
  assert.match(src, /ft-picker-topics-label/);
  assert.match(src, /startBtn\.disabled = true/, 'CTA starts disabled until a tile is picked (mock note)');
});

// ---------------------------------------------------------------------------
// Hint availability + type: keyed ONLY on the response field, never a
// client-side level lookup -- same principle as ftHasChips (packet 1).
// ---------------------------------------------------------------------------

test('hint/game-framing helpers never reference a client-side level value', () => {
  const src = [
    extractFunctionSrc(speakingPage, 'ftHintAvailable'),
    extractFunctionSrc(speakingPage, 'ftApplyHint'),
    extractFunctionSrc(speakingPage, 'ftGameFramingClass'),
    extractFunctionSrc(speakingPage, 'ftApplyGameFraming'),
  ].join('\n');
  assert.doesNotMatch(src, /\blevel\b/i, 'hint/game-framing gating must key off response shape or client picker state, not a level lookup');
});

test('ftHintAvailable: true only for a turn response carrying a non-empty string hint', () => {
  assert.equal(ftHintAvailable({ hint: 'puppy' }), true);
  assert.equal(ftHintAvailable({ hint: 'What does Bun eat?' }), true);
  assert.equal(ftHintAvailable({ hint: '' }), false);
  assert.equal(ftHintAvailable({}), false);
  assert.equal(ftHintAvailable(null), false);
  assert.equal(ftHintAvailable(undefined), false);
  assert.equal(ftHintAvailable({ hint: 42 }), false);
});

test('ftHintType: one word -> "word"; a question mark or several words -> "question"', () => {
  assert.equal(ftHintType('puppy'), 'word');
  assert.equal(ftHintType('fetch'), 'word');
  assert.equal(ftHintType('What does Bun eat?'), 'question');
  assert.equal(ftHintType('Do you have a pet'), 'question');
  assert.equal(ftHintType(''), 'word');
});

// ---------------------------------------------------------------------------
// Game framing class per selected game (§C) -- build_a_story is the only one
// ftApplyGameFraming actually populates; see the TODO(elon) in the source.
// ---------------------------------------------------------------------------

test('ftGameFramingClass: maps each game id to its mock class, null otherwise', () => {
  assert.equal(ftGameFramingClass('build_a_story'), 'minny-story-strip');
  assert.equal(ftGameFramingClass('debate'), 'minny-debate-banner');
  assert.equal(ftGameFramingClass('would_you_rather'), 'minny-wyr-cards');
  assert.equal(ftGameFramingClass(null), null);
  assert.equal(ftGameFramingClass(undefined), null);
  assert.equal(ftGameFramingClass('not_a_game'), null);
});

test('ftApplyGameFraming: build_a_story and debate are populated with content; would_you_rather (C3) stays dormant, no invented copy', () => {
  const src = extractFunctionSrc(speakingPage, 'ftApplyGameFraming');
  assert.match(src, /ft\.game === 'build_a_story'/);
  assert.match(src, /ft\.game === 'debate'/);
  assert.match(src, /ftClearGameFraming\(\)/, 'every other case (including no game, or would_you_rather) falls through to clearing/hiding the container');
  assert.doesNotMatch(src, /'would_you_rather'/, 'no branch renders content for would_you_rather (C3) yet -- Elon\'s ruling, TODO backlog');
});

// Micro-round (Elon, 2026-07-12): C2 debate banner unblocked -- start now
// echoes the server-picked debate_topic (own micro-diff, tested at
// tests/minny-conversation.test.mjs "start: game \"debate\" ... always
// assigns a debate_topic"), so the client only displays it, never invents it.

test('ftApplyGameFraming: debate branch renders Minny\'s position from ft.debateTopic (server-echoed) when present', () => {
  const src = extractFunctionSrc(speakingPage, 'ftApplyGameFraming');
  assert.match(src, /ft\.game === 'debate' && ft\.debateTopic/, 'requires BOTH the debate game AND a topic actually being present');
  assert.match(src, /minny-debate-banner__text">\$\{escapeHtml\(ft\.debateTopic\)\}/, 'renders the server-echoed string verbatim (escaped), never an invented flourish');
  assert.match(src, /Minny nghĩ/);
});

test('ftApplyGameFraming: absent debate_topic (e.g. non-debate game, or start response omitted it) never renders a blank/empty banner -- falls through to clearing', () => {
  const src = extractFunctionSrc(speakingPage, 'ftApplyGameFraming');
  const debateBranchStart = src.indexOf("if (ft.game === 'debate'");
  assert.notEqual(debateBranchStart, -1);
  const afterDebateBranch = src.slice(debateBranchStart);
  assert.match(afterDebateBranch, /ftClearGameFraming\(\);\s*\}\s*$/, 'the debate branch is a guarded early-return; every other path reaches the trailing ftClearGameFraming()');
});

test('startFreeTalkSession captures data.debate_topic into ft.debateTopic and applies framing once at start (banner persists for the whole game, not just one turn)', () => {
  const src = extractFunctionSrc(speakingPage, 'startFreeTalkSession');
  assert.match(src, /ft\.debateTopic = data\.debate_topic \|\| null/);
  assert.match(src, /ftApplyGameFraming\(null\)/);
});

test('ftReset clears ft.debateTopic (no stale debate position carried into a fresh session)', () => {
  const src = extractFunctionSrc(speakingPage, 'ftReset');
  assert.match(src, /ft\.debateTopic = null/);
});

// ---------------------------------------------------------------------------
// Topic picker markup (§A): 12 HUB_TOPICS tiles (imported from the source of
// truth, not re-derived) + the "Minny chọn 🎲" random tile.
// ---------------------------------------------------------------------------

test('topic grid is built from the imported HUB_TOPICS (not a duplicated array)', () => {
  assert.match(speakingPage, /import \{ HUB_TOPICS \} from '\.\/ho-so\/ho-so-topics\.ts';/);
  assert.match(speakingPage, /HUB_TOPICS\.map\(\(\[value, label, emoji\]\) => \(/);
  assert.equal(HUB_TOPICS.length, 12, 'sanity: the source of truth still has exactly 12 topics');
});

test('minny_choice random tile: dashed fx-topic--random modifier, dice emoji, "Minny chọn" label', () => {
  assert.match(speakingPage, /data-topic="minny_choice"/);
  assert.match(speakingPage, /class="fx-topic--random"/);
  assert.match(speakingPage, /emoji="🎲"/);
  assert.match(speakingPage, /label="Minny chọn"/);
});

test('game cards: exactly the 3 mock activities, real <button>s with data-game ids matching the server GAMES list', () => {
  assert.match(speakingPage, /data-game="build_a_story"/);
  assert.match(speakingPage, /data-game="debate"/);
  assert.match(speakingPage, /data-game="would_you_rather"/);
  assert.match(speakingPage, /Kể chuyện cùng Minny/);
  assert.match(speakingPage, /Tranh luận vui/);
  assert.match(speakingPage, /Con chọn gì\?/);
});

test('topic-pick prompt copy + start CTA match the approved mock verbatim', () => {
  assert.match(speakingPage, /Hôm nay con muốn nói về gì\?/);
  assert.match(speakingPage, /Bắt đầu nói chuyện 🚀/);
  assert.match(speakingPage, /id="ft-picker-start"[^>]*disabled/, 'CTA ships disabled until a tile is tapped, per the mock note');
});

test('Minny avatar in the picker is the red robot asset, never a koala placeholder', () => {
  const pickerSrc = speakingPage.slice(speakingPage.indexOf('id="ft-topic-picker"'), speakingPage.indexOf('id="ft-topic-picker"') + 1500);
  assert.match(pickerSrc, /\/assets\/minny\/minny_idle\.png/);
  assert.doesNotMatch(pickerSrc, /🐨/, 'the mock draws a koala placeholder -- Minny is the red robot (fix-it round precedent, d2a10a1)');
});

// ---------------------------------------------------------------------------
// Topic/game selection wiring: tap selects (never fires start by itself);
// CTA carries {topic, game} into the existing start flow.
// ---------------------------------------------------------------------------

test('topic tile tap only selects (single-select, toggles aria-pressed), never calls startFreeTalkSession', () => {
  const start = speakingPage.indexOf("getElementById('ft-picker-topic-grid')?.addEventListener('click'");
  assert.notEqual(start, -1);
  const region = speakingPage.slice(start, start + 700);
  assert.match(region, /fx-topic--selected/);
  assert.match(region, /aria-pressed/);
  assert.match(region, /ft\.pickerTopic = btn\.dataset\.topic/);
  assert.doesNotMatch(region, /startFreeTalkSession/);
});

test('game card tap is optional, single-select, toggles off on a second tap of the same card', () => {
  const start = speakingPage.indexOf("getElementById('ft-picker-game-cards')?.addEventListener('click'");
  assert.notEqual(start, -1);
  const region = speakingPage.slice(start, start + 900);
  assert.match(region, /alreadySelected/);
  assert.match(region, /ft\.pickerGame = null/);
  assert.match(region, /ft\.pickerGame = btn\.dataset\.game/);
});

test('CTA tap requires a topic, then calls startFreeTalkSession with { topic, game }', () => {
  const start = speakingPage.indexOf("getElementById('ft-picker-start')?.addEventListener('click'");
  assert.notEqual(start, -1);
  const region = speakingPage.slice(start, start + 400);
  assert.match(region, /if \(!ft\.pickerTopic\) return;/);
  assert.match(region, /startFreeTalkSession\(\{ topic, game \}\)/);
});

test('startFreeTalkSession: start request body carries topic/game only when present, and sets ft.game for framing', () => {
  const src = extractFunctionSrc(speakingPage, 'startFreeTalkSession');
  assert.match(src, /ft\.game = opts\?\.game \|\| null/);
  assert.match(src, /ft\.storyLines = \[\]/);
  assert.match(src, /\.\.\.\(opts\?\.topic \? \{ topic: opts\.topic \} : \{\}\)/);
  assert.match(src, /\.\.\.\(opts\?\.game \? \{ game: opts\.game \} : \{\}\)/);
});

// ---------------------------------------------------------------------------
// Hint state machine (§B): idle -> offered (stall) -> revealed -> re-hides.
// ---------------------------------------------------------------------------

test('ftApplyHint: re-evaluates fresh every turn (re-hides any previous reveal), row visibility keyed on ft.currentHint only', () => {
  const src = extractFunctionSrc(speakingPage, 'ftApplyHint');
  assert.match(src, /ft\.currentHint = ftHintAvailable\(data\) \? data\.hint : null/);
  assert.match(src, /ft\.hintRevealed = false/, 'every call re-hides a previous reveal -- the "re-hides on next turn" acceptance criterion');
  assert.match(src, /ftRenderHintCard\(\)/);
  assert.match(src, /ftHintRowEl\(\)\?\.classList\.toggle\('hidden', !ft\.currentHint\)/);
});

test('ftHandleTurnResponse calls ftApplyHint for every turn, including the ended branch (hint never lingers past session end)', () => {
  const src = extractFunctionSrc(speakingPage, 'ftHandleTurnResponse');
  assert.match(src, /ftApplyHint\(null\)/, 'ended branch clears the hint');
  assert.match(src, /ftApplyHint\(data\)/, 'normal branch re-derives from the fresh turn data');
  assert.match(src, /ftApplyGameFraming\(data\)/);
});

test('ftRevealHint/ftDismissHint both return to plain B1 idle (button reappears, not still pulsing)', () => {
  const reveal = extractFunctionSrc(speakingPage, 'ftRevealHint');
  assert.match(reveal, /if \(!ft\.currentHint\) return;/);
  assert.match(reveal, /ft\.hintRevealed = true/);
  assert.match(reveal, /ftHintOfferedSet\(false\)/);
  assert.match(reveal, /ftHintRowEl\(\)\?\.classList\.add\('hidden'\)/, 'B3: the button row hides while the card is open, per the mock');

  const dismiss = extractFunctionSrc(speakingPage, 'ftDismissHint');
  assert.match(dismiss, /ft\.hintRevealed = false/);
  assert.match(dismiss, /ftHintOfferedSet\(false\)/);
  assert.match(dismiss, /ftHintRowEl\(\)\?\.classList\.toggle\('hidden', !ft\.currentHint\)/, 'returns to B1 (button visible again) since this turn still has a hint');
});

test('ftRenderHintCard: exactly one hint per reveal (word OR question, never both), EN-only per the packet\'s own TODO(elon) instruction (no invented VN translation)', () => {
  const src = extractFunctionSrc(speakingPage, 'ftRenderHintCard');
  assert.match(src, /minny-hint-card__question/);
  assert.match(src, /minny-hint-card__word-en/);
  assert.match(src, /TODO\(elon\)/);
  assert.doesNotMatch(src, /class="minny-hint-card__word-vi"/, 'VN gloss line is explicitly deferred (never actually rendered), not invented -- only mentioned in the TODO(elon) comment above');
  assert.match(src, /Đóng gợi ý/);
});

test('hint button + affordance markup exist, hidden by default (L0-L2 never sees them -- no field, no row)', () => {
  assert.match(speakingPage, /id="ft-hint-row" class="minny-hint-row hidden"/);
  assert.match(speakingPage, /id="ft-hint-affordance" class="minny-hint-affordance hidden">Cần gợi ý không\?/);
  assert.match(speakingPage, /id="ft-hint-btn" type="button" class="minny-hint-btn">💡 Gợi ý/);
  assert.match(speakingPage, /id="ft-hint-card" class="minny-hint-card hidden"/);
});

test('hint-offer stall check reuses the existing VAD interval (no second timer) and fires at most once per recording attempt', () => {
  const src = extractFunctionSrc(speakingPage, 'ftStartVad');
  assert.match(src, /FT_HINT_STALL_MS/);
  assert.match(src, /let hintOfferFired = false;/);
  assert.match(src, /if \(!hintOfferFired && ft\.currentHint/);
  assert.match(src, /ftHintOfferedSet\(true\)/);
  // one setInterval in this function -- the stall check lives inside it,
  // not a second window.setInterval/setTimeout construct.
  assert.equal((src.match(/window\.setInterval/g) || []).length, 1);
});

test('ftStopVad always returns a still-offered hint to idle (every VAD-stop path)', () => {
  const src = extractFunctionSrc(speakingPage, 'ftStopVad');
  assert.match(src, /ftHintOfferedSet\(false\)/);
});

// ---------------------------------------------------------------------------
// ftReset clears all V1.2 packet 2 state -- no stale picker/hint/game
// framing carried into a fresh free-talk entry.
// ---------------------------------------------------------------------------

test('ftReset clears picker selection, hint, and game-framing state', () => {
  const src = extractFunctionSrc(speakingPage, 'ftReset');
  assert.match(src, /ft\.pickerTopic = null/);
  assert.match(src, /ft\.pickerGame = null/);
  assert.match(src, /ft\.game = null/);
  assert.match(src, /ft\.storyLines = \[\]/);
  assert.match(src, /ftApplyHint\(null\)/);
  assert.match(src, /ftClearGameFraming\(\)/);
  assert.match(src, /getElementById\('ft-topic-picker'\)\?\.classList\.add\('hidden'\)/);
});

// ---------------------------------------------------------------------------
// Build-a-story framing (§C, C1) -- the one game with a clean, already-
// tracked client-side data source (Minny's own reply_en lines).
// ---------------------------------------------------------------------------

test('ftApplyGameFraming: build_a_story keeps only the last two Minny lines, most recent bolded', () => {
  const src = extractFunctionSrc(speakingPage, 'ftApplyGameFraming');
  assert.match(src, /ft\.storyLines\.push\(data\.reply_en\)/);
  assert.match(src, /ft\.storyLines\.slice\(-2\)/);
  assert.match(src, /minny-story-strip__line--minny-last/);
  assert.match(src, /Câu chuyện của chúng ta/);
});

// ---------------------------------------------------------------------------
// 44px targets + reduced motion (per the mock's own accessibility notes)
// ---------------------------------------------------------------------------

test('new tappable targets meet the 44px floor', () => {
  assert.match(speakupCss, /\.minny-hint-btn\s*\{[^}]*min-height:\s*44px/s);
  assert.match(speakupCss, /\.minny-game-card\s*\{[^}]*min-height:\s*44px/s);
  assert.match(speakupCss, /\.minny-game-card__emoji\s*\{[^}]*width:\s*44px;\s*height:\s*44px/s);
});

test('hint-card dismiss: 28px visual circle (mock, unchanged) padded to a 44px hit area via an invisible ::before, per README open question #1', () => {
  assert.match(speakupCss, /\.minny-hint-card__dismiss\s*\{[^}]*width:\s*28px;\s*height:\s*28px/s);
  const before = speakupCss.match(/\.minny-hint-card__dismiss::before\s*\{([^}]*)\}/s);
  assert.ok(before, '.minny-hint-card__dismiss::before rule must exist');
  assert.match(before[1], /inset:\s*-8px/);
  // 28px visual box + 8px inset on every side = 44px effective hit area.
  assert.equal(28 + 8 * 2, 44);
});

test('reduced-motion disables the new .minny-hint-btn.is-pulsing animation (this file\'s per-selector convention -- speakup-app.css has more than one such block)', () => {
  const rule = /@media \(prefers-reduced-motion: reduce\)[^@]*?\.minny-hint-btn\.is-pulsing\s*\{[^}]*animation:\s*none/s;
  assert.match(speakupCss, rule);
});

// ---------------------------------------------------------------------------
// Standing traps this packet was explicitly warned about.
// ---------------------------------------------------------------------------

test('every new class this packet introduces lives in speakup-app.css, not the orphaned speakup-free-talk.css', () => {
  const newClasses = [
    'minny-topic-picker', 'fx-topic-grid', 'fx-topic--random', 'minny-game-cards',
    'minny-game-card', 'minny-hint-row', 'minny-hint-btn', 'minny-hint-affordance',
    'minny-hint-card', 'minny-story-strip', 'minny-debate-banner', 'minny-wyr-cards',
  ];
  for (const cls of newClasses) {
    assert.match(speakupCss, new RegExp(`\\.${cls}\\b`), `.${cls} must be defined in speakup-app.css`);
  }
});
