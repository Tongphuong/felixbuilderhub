// Structural tests for the Shadowing page (speakup-shadowing-v1-p5-reskin
// packet). Same repo convention as tests/speakup-fixit-ui.test.mjs (no
// jsdom available): string/region assertions on the raw .astro/.css source
// rather than a DOM render. This file checks the DOM-wiring contract, the
// server-call field shapes, the economy fence, and copy fidelity — NOT the
// pure engine logic (tests/shadowing-engine.test.mjs already covers that).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/shadowing.astro', 'utf-8');
const css = readFileSync('src/styles/speakup-app.css', 'utf-8');
const layout = readFileSync('src/layouts/SpeakUpAppLayout.astro', 'utf-8');

// ---------------------------------------------------------------------------
// 1. DOM-contract ids (design_handoff_speakup_shadowing/README.md's
//    "Build contract" region-id list, plus shd-player-overlay which the
//    wiring contract adds for the YouTube-chrome shield).
// ---------------------------------------------------------------------------

const REQUIRED_IDS = [
  'shd-code-card',
  'shd-code-input',
  'shd-video-picker',
  'shd-player-host',
  'shd-player-overlay',
  'shd-words',
  'shd-mic-btn',
  'shd-replay-btn',
  'shd-next-btn',
  'shd-question-card',
  'shd-stars',
  'shd-streak',
  'shd-progress',
  'shd-summary',
];

test('every DOM-contract id from the README is present exactly once', () => {
  for (const id of REQUIRED_IDS) {
    const re = new RegExp(`id="${id}"`, 'g');
    const matches = page.match(re) || [];
    assert.equal(matches.length, 1, `expected exactly one id="${id}" in shadowing.astro, found ${matches.length}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Imports all five shadowing-*.mjs modules; YouTube embed hardening
// ---------------------------------------------------------------------------

const SHADOWING_MODULES = [
  'shadowing-engine.mjs',
  'shadowing-player.mjs',
  'shadowing-speech.mjs',
  'shadowing-score.mjs',
  'shadowing-content.mjs',
];

test('imports all five shadowing-*.mjs wiring modules', () => {
  for (const mod of SHADOWING_MODULES) {
    assert.ok(page.includes(mod), `expected an import referencing ${mod}`);
  }
});

test('references the nocookie + inline-playback YouTube embed contract', () => {
  // The literal player config lives in shadowing-player.mjs (already covered
  // by shadowing-player.test.mjs); this page documents-and-relies-on it in
  // a comment next to where createSegmentPlayer() is wired up.
  assert.ok(page.includes('youtube-nocookie'), 'expected a reference to the youtube-nocookie.com embed host');
  assert.ok(page.includes('playsinline'), 'expected a reference to playsinline (iOS inline playback, never forced fullscreen)');
});

// ---------------------------------------------------------------------------
// 3. Server-call field shapes
// ---------------------------------------------------------------------------

test('the speaking-check call carries shadow_practice + pack_id=general + check_mode=read', () => {
  assert.ok(page.includes("formData.append('pack_id', 'general')"), 'expected pack_id literal \'general\'');
  assert.ok(page.includes("formData.append('check_mode', 'read')"), 'expected check_mode literal \'read\'');
  assert.ok(page.includes("formData.append('shadow_practice', '1')"), 'expected shadow_practice literal \'1\'');
  assert.ok(page.includes("formData.append('practice_mode', '1')"), 'expected practice_mode literal \'1\'');
  assert.ok(page.includes('/api/read2lead-speaking-check'), 'expected the shadow_practice bypass endpoint, not a different one');
});

test('the completion log uses the shadow_ prompt prefix and the general pack', () => {
  assert.ok(page.includes('shadow_${currentVideo.id}') || page.includes('shadow_\' + currentVideo.id'), 'expected prompt_id built from a shadow_ prefix + video.id');
  assert.ok(page.includes('/api/minny-practice-log'), 'expected the practice-log endpoint');
  assert.ok(/pack_id:\s*'general'/.test(page), "expected pack_id: 'general' on the practice-log POST body");
});

// ---------------------------------------------------------------------------
// 4. Economy fence (CI law, rule-of-record for this packet) — the shadow
//    engine must never brush against the diamond-paying homework/free-talk
//    completion path.
// ---------------------------------------------------------------------------

const FORBIDDEN_STRINGS = [
  'gradeRewards',
  'submit-read2lead-lesson',
  'daily-chest',
  'homework_summary',
  'free_talk_summary',
];

test('economy fence: page source contains none of the diamond-economy trigger strings', () => {
  for (const bad of FORBIDDEN_STRINGS) {
    assert.ok(!page.includes(bad), `page must NOT contain "${bad}" (diamond-economy trigger)`);
  }
});

// ---------------------------------------------------------------------------
// 5. Reduced motion + copy fidelity
// ---------------------------------------------------------------------------

test('the new shd- css section defines a reduced-motion override', () => {
  const marker = '===== Shadowing (shd-) =====';
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, 'expected the shd- delimited CSS section to exist');
  const shdSection = css.slice(start);
  assert.match(shdSection, /@media \(prefers-reduced-motion: reduce\)\s*{/, 'expected a reduced-motion block inside the shd- section');
  // Sanity: the block actually targets shd- selectors, not a copy-pasted
  // no-op left over from elsewhere in the file.
  const reducedBlockStart = shdSection.indexOf('@media (prefers-reduced-motion: reduce)');
  const reducedBlock = shdSection.slice(reducedBlockStart, reducedBlockStart + 700);
  assert.match(reducedBlock, /\.shd-/, 'expected the reduced-motion block to target shd- classes');
});

test('shd- CSS section is appended after the existing file content, never edited in place', () => {
  // The append-only contract: the marker must come AFTER the pre-existing
  // file's own last rule (the most recently landed section before this
  // packet), and that rule must still be present, untouched.
  const marker = '===== Shadowing (shd-) =====';
  const priorTail = '.minny-hint-btn.is-pulsing';
  const markerIdx = css.indexOf(marker);
  const priorTailIdx = css.indexOf(priorTail);
  assert.notEqual(priorTailIdx, -1, 'expected the pre-existing rewards-section rule to still be present, untouched');
  assert.ok(markerIdx > priorTailIdx, 'expected the shd- section to be appended AFTER the prior file content, not inserted earlier');
});

// Canonical Vietnamese strings, asserted VERBATIM (spot-check across every
// screen) — includes the 8 Elon-approved strings for this reskin packet
// (design_handoff_speakup_shadowing/README.md's "New copy for teacher
// review" list) plus the surviving strings from the prior build.
const CANONICAL_STRINGS = [
  // packet-specified, verbatim, non-negotiable
  'Tấm vé vào rạp của Minny đây!',
  'Nhập mã của con',
  'Chọn phim để luyện',
  'Chọn phim khác',
  '· con đã chọn',
  'Xem tiếp ▸',
  'Từ nào sáng rồi thì vẫn sáng mãi nha!',
  'Đến lượt con',
  // carried over from the working build (engine-facing copy, unchanged)
  'VD: R2L-LINH-8F3KQ2',
  'Vào xem!',
  'Chưa luyện',
  'Xem nhé… sắp đến lượt con!',
  'Minny cũng đang xem cùng con',
  'Bây giờ đến lượt con nói!',
  'Đang ghi âm… nói cả câu nhé!',
  'Nghe lại câu',
  'Tuyệt vời!',
  'Câu tiếp theo →',
  'Gần đúng rồi! Nghe lại nha',
  'Thử lại 🎤',
  'Nghe lại rồi mình qua câu tiếp nhé! 💛',
  'Con làm được rồi!',
  'Tổng sao',
  'Chuỗi dài nhất',
  'Xem trọn video',
  '← Chọn video khác',
  'Phim đang được chuẩn bị… quay lại sau nhé!',
  'Nghỉ một chút nhé!',
];

test('every canonical Vietnamese string from the approved boards appears verbatim', () => {
  for (const str of CANONICAL_STRINGS) {
    assert.ok(page.includes(str), `expected the exact string "${str}" in shadowing.astro`);
  }
});

const VN_DIACRITIC_RE = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;

test('every kid-facing canonical string carries full Vietnamese diacritics (no silently-stripped accents)', () => {
  // The sample-code placeholder is the one canonical string that is
  // legitimately a bare access-code pattern, not Vietnamese prose. The
  // "· con đã chọn" suffix and "Xem tiếp ▸" CTA carry diacritics too, so
  // they need no exemption.
  const NO_DIACRITIC_EXPECTED = new Set(['VD: R2L-LINH-8F3KQ2']);
  for (const str of CANONICAL_STRINGS) {
    if (NO_DIACRITIC_EXPECTED.has(str)) continue;
    assert.match(str, VN_DIACRITIC_RE, `expected "${str}" to carry at least one Vietnamese diacritic`);
  }
});

// ---------------------------------------------------------------------------
// 6. Fonts — Baloo 2 added to the shared app-shell font href (the packet's
//    only shared-file touch), Manrope/Inter still present as documented
//    fallbacks/body face.
// ---------------------------------------------------------------------------

test('SpeakUpAppLayout loads Baloo 2 (700;800) alongside the existing Inter/Manrope href', () => {
  assert.match(layout, /family=Baloo\+2:wght@700;800/, 'expected Baloo 2 weights 700;800 in the Google Fonts href');
  assert.ok(layout.includes('family=Inter'), 'expected the existing Inter family to still be requested');
  assert.ok(layout.includes('family=Manrope'), 'expected the existing Manrope family to still be requested');
  // Exactly one Google Fonts stylesheet link — Baloo 2 was added to the
  // EXISTING href, not a second parallel <link>.
  const linkMatches = layout.match(/<link[^>]*fonts\.googleapis\.com\/css2[^>]*>/g) || [];
  assert.equal(linkMatches.length, 1, 'expected exactly one fonts.googleapis.com/css2 stylesheet link');
});

test('the shd- CSS section uses Baloo 2 (with the Manrope fallback the README allows) for display/tile/button text', () => {
  const marker = '===== Shadowing (shd-) =====';
  const shdSection = css.slice(css.indexOf(marker));
  const baloo2Rules = (shdSection.match(/'Baloo 2', 'Manrope', sans-serif/g) || []).length;
  assert.ok(baloo2Rules >= 10, `expected Baloo 2 to be the declared display font across many shd- rules, found ${baloo2Rules}`);
});

// ---------------------------------------------------------------------------
// 7. Star layer + the single #f87171 danger color (README implementation
//    contract item 7: "Never introduce red for errors/streaks — only the
//    recording caption dot is #f87171").
// ---------------------------------------------------------------------------

test('a reusable star-layer class is present in both the markup and the shd- CSS', () => {
  assert.ok(page.includes('shd-starfield'), 'expected a .shd-starfield element in the markup');
  assert.ok(page.includes('class="shd-star '), 'expected individual .shd-star dots inside the field');
  const marker = '===== Shadowing (shd-) =====';
  const shdSection = css.slice(css.indexOf(marker));
  assert.match(shdSection, /\.shd-starfield\s*{/, 'expected a .shd-starfield rule in the shd- CSS section');
  assert.match(shdSection, /@keyframes shd-twinkle/, 'expected the twinkle keyframes for the star layer');
});

test('#f87171 occurs in the CSS ONLY on the recording-dot rule', () => {
  const marker = '===== Shadowing (shd-) =====';
  const shdSection = css.slice(css.indexOf(marker));
  const lines = shdSection.split('\n').filter((l) => l.includes('#f87171'));
  assert.ok(lines.length > 0, 'expected #f87171 to appear at least once (the recording dot)');
  for (const line of lines) {
    assert.ok(
      line.includes('--shd-rec:') || line.includes('.shd-recdot'),
      `expected every #f87171 occurrence to be the --shd-rec token declaration or the .shd-recdot rule, found: ${line.trim()}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 8. Question wrong-reveal HOLD state (packet item a): correct gold-outlined,
//    chosen dimmed with "· con đã chọn", no auto-advance timer on that path
//    — the kid must tap "Xem tiếp ▸" to proceed.
// ---------------------------------------------------------------------------

test('wrong-reveal is a held state: the correct-answer branch still auto-advances, but the wrong branch shows "Xem tiếp ▸" and waits for a click', () => {
  assert.ok(page.includes('shd-ticket--reveal-correct'), 'expected a reveal-correct class hook for the gold-outlined right answer');
  assert.ok(page.includes('shd-ticket--reveal-chosen'), 'expected a reveal-chosen class hook for the dimmed wrong pick');
  assert.ok(page.includes('shd-ticket--reveal-other'), 'expected a reveal-other class hook for the faded third option');
  assert.match(page, /els\.nextBtn\.onclick = onAdvanceAfterQuestion/, 'expected the wrong-reveal path to wire "Xem tiếp ▸" to an explicit advance handler');
  // The correct branch must NOT show the next button (it auto-advances on
  // its own short timer, matching the board's "no CTA" correct-selected frame).
  const onAnswerFn = page.match(/function onAnswerQuestion\([\s\S]*?\n {4}}\n/);
  assert.ok(onAnswerFn, 'expected to locate onAnswerQuestion()');
  // (p6) window.setTimeout's body now guards `if (session) renderStage();`
  // -- the header back-circle button can tear down the session during this
  // 900ms pause, so the callback must not resume into a null session.
  assert.match(onAnswerFn[0], /if \(isCorrect\) {[\s\S]*?window\.setTimeout\(\(\) => {[\s\S]*?if \(session\) renderStage\(\);[\s\S]*?}, 900\);\s*return;\s*}/, 'expected the correct branch to keep the short auto-advance timer (now session-guarded)');
});

test('no CSS rule styles .shd-ticket with red — the wrong-reveal states use gold/dim treatments only', () => {
  const marker = '===== Shadowing (shd-) =====';
  const shdSection = css.slice(css.indexOf(marker));
  const ticketRules = shdSection.match(/\.shd-ticket[a-zA-Z-]*\s*(?:,\s*\.shd-ticket[a-zA-Z-]*\s*)*{[^}]*}/g) || [];
  assert.ok(ticketRules.length > 0, 'expected at least one .shd-ticket rule');
  for (const rule of ticketRules) {
    assert.ok(!/#f87171|--shd-rec\b|red/i.test(rule), `expected no red/danger tone in a .shd-ticket rule, found: ${rule}`);
  }
});

// ---------------------------------------------------------------------------
// 9. Grading-wait blurred-card overlay (packet item b): Minny + 5-bar gold
//    equalizer + animated "Minny đang nghe…" dots, sitting over a blurred
//    (not torn-down) stage.
// ---------------------------------------------------------------------------

test('the listening overlay blurs the HUD + stage-cols rather than hiding them, and shows a 5-bar equalizer', () => {
  assert.match(page, /els\.hud\.classList\.toggle\('shd-blurred', listening\)/, 'expected the HUD to gain a blur class while listening, not disappear');
  assert.match(page, /els\.stageCols\.classList\.toggle\('shd-blurred', listening\)/, 'expected the stage columns (video + interaction) to blur while listening');
  const eqMatch = page.match(/<div class="shd-eq"[^>]*>((?:<i><\/i>)+)<\/div>/);
  assert.ok(eqMatch, 'expected a .shd-eq bar group in the listen card');
  const barCount = (eqMatch[1].match(/<i>/g) || []).length;
  assert.equal(barCount, 5, `expected exactly 5 equalizer bars (the board's 5-bar gold equalizer), found ${barCount}`);
  assert.ok(page.includes('Minny đang nghe'), 'expected the "Minny đang nghe…" caption verbatim');
});

// ---------------------------------------------------------------------------
// 10. 429 rest-state timer bar driven by the response's own Retry-After
//     (packet item c) — never a hardcoded guess when the header is present.
// ---------------------------------------------------------------------------

test('the 429/outage path reads Retry-After off the response and passes it into showWait(), falling back to 3s', () => {
  assert.match(
    page,
    /if\s*\(\s*!res\s*\|\|\s*res\.status === 429\s*\|\|\s*\(data && data\.ok === false && data\.asr_outage\)\s*\)\s*{\s*\n\s*const retryAfterHeader = res \? Number\(res\.headers\.get\('Retry-After'\)\) : NaN;\s*\n\s*showWait\(Number\.isFinite\(retryAfterHeader\) && retryAfterHeader > 0 \? retryAfterHeader : 3\);/,
    'expected the guard to read Retry-After from the response and pass a sane fallback into showWait(), before any scorePercent/reduce SPEECH_SCORED call',
  );
});

test('showWait() drives a passive CSS-transition timer bar sized to its seconds argument, clamped to a sane range', () => {
  const fnMatch = page.match(/function showWait\(seconds\)\s*{[\s\S]*?\n {4}}\n/);
  assert.ok(fnMatch, 'expected to locate showWait(seconds)');
  assert.match(fnMatch[0], /Math\.max\(1, Math\.min\(20, Number\(seconds\) \|\| 3\)\)/, 'expected the duration to be clamped between 1 and 20 seconds with a 3s fallback');
  assert.match(fnMatch[0], /els\.waitFill\.style\.width = '100%'/, 'expected the bar to animate to full width');
  assert.match(fnMatch[0], /window\.setTimeout\(\(\) => {\s*\n\s*if \(session && session\.phase === 'record'\) showRecordPanel\(null\);\s*\n\s*}, dur \* 1000\);/, 'expected the return-to-record timeout to use the SAME computed duration as the bar animation');
});

test('the rest-state card carries the 🌙 emoji and the exact heading text', () => {
  assert.match(page, /class="shd-wait-moon"[^>]*>🌙</, 'expected the 🌙 moon emoji in its own element');
  assert.ok(page.includes('Nghỉ một chút nhé!'), 'expected the rest-state heading verbatim');
});

// ---------------------------------------------------------------------------
// 11. Empty-picker + unplayable-video states as dedicated cards (packet
//     item d, board 01 side frames) — not bare paragraphs.
// ---------------------------------------------------------------------------

test('the empty-picker state is a Minny card, not a bare paragraph', () => {
  assert.match(page, /<div class="shd-card-shell shd-empty-card hidden" id="shd-picker-empty">/, 'expected the empty state to be a shd-card-shell card');
  assert.match(page, /id="shd-picker-empty">[\s\S]*?shd-minny[\s\S]*?Phim đang được chuẩn bị… quay lại sau nhé!/, 'expected a Minny avatar above the empty-state heading');
});

test('the unplayable-video state is a dedicated card with a video-frame placeholder, Minny, message, and a "Chọn phim khác" CTA', () => {
  assert.match(page, /<div class="shd-card-shell shd-notice-card hidden" id="shd-picker-notice">/, 'expected the unplayable state to be a shd-card-shell card');
  assert.ok(page.includes('shd-notice-frame'), 'expected a 16:9 video-frame placeholder in the unplayable card');
  assert.ok(page.includes('id="shd-picker-notice-msg"'), 'expected a dedicated message element (JS-writable, distinct from the card chrome)');
  assert.match(page, /id="shd-picker-notice-cta"[^>]*>Chọn phim khác</, 'expected the "Chọn phim khác" CTA button verbatim');
  assert.match(page, /els\.pickerNoticeCta\.addEventListener\('click'/, 'expected the CTA to be wired to a click handler');
});

// ---------------------------------------------------------------------------
// 12. Buffet-A fix round (prior pass) — milestone bulbs, MAX_SECONDS,
//     network-drop guard, dev-draft ribbon, deviations block, real-device
//     comment. All still apply; unchanged by this reskin.
// ---------------------------------------------------------------------------

function extractFunctionSrc(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `function ${name} not found in shadowing.astro`);
  const parenStart = source.indexOf('(', start);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < source.length; i += 1) {
    if (source[i] === '(') parenDepth += 1;
    else if (source[i] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  assert.notEqual(parenEnd, -1, `could not find end of parameter list for function ${name}`);
  const braceStart = source.indexOf('{', parenEnd);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `could not find closing brace of function ${name}`);
  return source.slice(start, end);
}

function loadMilestoneBulbStates() {
  const src = extractFunctionSrc(page, 'milestoneBulbStates');
  const body = `${src}\n\nreturn milestoneBulbStates;`;
  // eslint-disable-next-line no-new-func -- see file header: pure, DOM-free source extracted from the page itself
  return new Function(body)();
}

const milestoneBulbStates = loadMilestoneBulbStates();

test('milestoneBulbStates always returns exactly 12 entries, regardless of segment count', () => {
  for (const total of [1, 7, 12, 18, 124]) {
    const states = milestoneBulbStates(0, total);
    assert.equal(states.length, 12, `expected 12 bulbs for a ${total}-segment video, got ${states.length}`);
  }
});

test('milestoneBulbStates: a 12-segment video at segment 4 matches the approved board exactly (4 on, 1 now, 7 off)', () => {
  assert.deepEqual(
    milestoneBulbStates(4, 12),
    ['on', 'on', 'on', 'on', 'now', 'off', 'off', 'off', 'off', 'off', 'off', 'off'],
  );
});

test('milestoneBulbStates: a 124-segment book at segment 50 still yields a sane 12-bulb split', () => {
  const states = milestoneBulbStates(50, 124);
  const onCount = states.filter((s) => s === 'on').length;
  const nowCount = states.filter((s) => s === 'now').length;
  assert.equal(onCount, 4, 'expected 4 fully-passed milestones at 50/124');
  assert.equal(nowCount, 1, 'expected exactly one pulsing "now" milestone');
  assert.equal(states.slice(5).every((s) => s === 'off'), true, 'expected the remaining milestones off');
});

test('milestoneBulbStates: a 1-segment video is "now" until complete, then all 12 light', () => {
  assert.deepEqual(milestoneBulbStates(0, 1), ['now', ...new Array(11).fill('off')]);
  assert.deepEqual(milestoneBulbStates(1, 1), new Array(12).fill('on'), 'once completed>=total, every milestone is on');
});

test('MAX_SECONDS is 12 (Elon ruling, Buffet-confirmed) and is documented as such', () => {
  assert.match(page, /const MAX_SECONDS = 12;/);
});

test('dev-draft ribbon: the picker references content_status and renders the BẢN NHÁP ribbon string', () => {
  assert.ok(page.includes('content_status'), 'expected the picker to read video.content_status');
  assert.ok(page.includes('BẢN NHÁP'), 'expected the dev-draft ribbon copy "BẢN NHÁP" verbatim');
  // Missing-field-defaults-to-draft is the safe default (never silently
  // presented as approved) -- assert the comparison is the inclusive one,
  // not an opt-in "=== 'dev_draft'" that would treat an absent field as approved.
  assert.match(page, /content_status\s*!==\s*'approved'/, "expected a missing content_status to default to draft (checked via !== 'approved', not === 'dev_draft')");
});

test('the recorded-deviations list is retrievable as a comment block in shadowing.astro', () => {
  assert.ok(page.includes('RECORDED MOCK DEVIATIONS'), 'expected the deviations block header comment');
  assert.ok(page.includes('Buffet-A fix round'), 'expected the fix-round note appended to the deviations block');
});

test('the auto-advance-through-consecutive-watch-segments path carries an honest, non-behavior-changing comment', () => {
  assert.ok(page.includes('flagged for real-device verification'), 'expected the rule-20 real-device-verification flag comment near showWatchAndPlay()');
});

// ---------------------------------------------------------------------------
// 13. Ribbon geometry (packet: "adapt the ribbon-offset tripwire to the new
//     badge geometry — BẢN NHÁP now top-LEFT on the thumb per screen 01").
// ---------------------------------------------------------------------------

test('the dev-draft ribbon is anchored to the thumbnail (own positioning context), title column keeps full width', () => {
  assert.match(css, /\.shd-thumb\s*{[^}]*position:\s*relative/s, 'expected .shd-thumb to establish its own positioning context for the ribbon');
  // The ribbon markup must live INSIDE the thumbnail span, after the <img>,
  // not as a sibling of .shd-thumb/.shd-meta on the card.
  assert.match(page, /<img src="https:\/\/i\.ytimg\.com\/vi\/[^>]*>\s*\n\s*\$\{isDraft[^}]*shd-ribbon/, 'expected the ribbon markup nested inside the thumbnail, after its <img>');
});

test('the ribbon sits top-LEFT of the thumbnail (board 01: top:8px;left:8px), non-negative offsets so it never gets sheared by the clip', () => {
  // Buffet's original finding on b90b214 still applies in spirit: a
  // negative top/right (or top/left) offset on .shd-ribbon combined with
  // .shd-thumb's overflow:hidden clip shears the badge's own corner off.
  // This reskin also moves the anchor corner from top-right to top-left
  // per board 01's literal placement — assert BOTH: correct corner, and
  // still non-negative.
  const thumbBlockMatch = css.match(/\.shd-thumb\s*{([^}]*)}/);
  assert.ok(thumbBlockMatch, 'expected a .shd-thumb rule');
  assert.match(thumbBlockMatch[1], /overflow:\s*hidden/, 'expected .shd-thumb to still clip (rounded-corner image) -- if this ever changes, re-check the offset requirement below');

  const ribbonBlockMatch = css.match(/\.shd-ribbon\s*{([^}]*)}/s);
  assert.ok(ribbonBlockMatch, 'expected a .shd-ribbon rule');
  const topMatch = ribbonBlockMatch[1].match(/\btop:\s*(-?\d+(?:\.\d+)?)px/);
  const leftMatch = ribbonBlockMatch[1].match(/\bleft:\s*(-?\d+(?:\.\d+)?)px/);
  assert.ok(topMatch, 'expected an explicit top px offset on .shd-ribbon');
  assert.ok(leftMatch, 'expected an explicit LEFT px offset on .shd-ribbon (top-right "right:" geometry is retired this pass — board 01 anchors top-left)');
  assert.ok(!/\bright:\s*-?\d/.test(ribbonBlockMatch[1]), 'expected .shd-ribbon to no longer carry a right: offset now that it is anchored top-left');
  assert.ok(Number(topMatch[1]) >= 0, `expected .shd-ribbon's top offset to be non-negative (inside the clipped thumbnail), got ${topMatch[1]}px`);
  assert.ok(Number(leftMatch[1]) >= 0, `expected .shd-ribbon's left offset to be non-negative (inside the clipped thumbnail), got ${leftMatch[1]}px`);
});

// ---------------------------------------------------------------------------
// 14. Mic caption is state-truthful — idle copy is the markup default,
//     recording copy + the recording dot only appear once the mic actually
//     starts. Ported from r20 #3, adapted to the new #shd-miccap-text +
//     #shd-recdot split (the dot moved off the mic button onto the caption
//     line, matching the boards).
// ---------------------------------------------------------------------------

test('the mic caption is state-truthful: idle copy is the markup default; the recording dot starts hidden', () => {
  assert.ok(page.includes('Bấm micro rồi nói cả câu nhé!'), 'expected the idle/armed mic caption verbatim');
  assert.ok(page.includes('Đang ghi âm… nói cả câu nhé!'), 'expected the recording-in-progress mic caption verbatim (unchanged copy)');
  // The markup's initial #shd-miccap-text content must be the IDLE string,
  // not the recording one — this is the exact bug (idle mic claiming it was
  // recording) that r20 caught, now re-checked against the new nested-span
  // structure (a recdot span now precedes the text span).
  assert.match(page, /id="shd-miccap-text">Bấm micro rồi nói cả câu nhé!<\/span>/, 'expected the idle caption to be the DEFAULT text in the markup, not set only via JS');
  assert.match(page, /<span class="shd-recdot hidden" id="shd-recdot"/, 'expected the recording dot to start with the hidden class in markup');
  // And the recording string + dot-unhide must only happen AFTER
  // recorder.start(), not anywhere earlier in startRecording().
  const startFnMatch = page.match(/async function startRecording\(\)\s*{[\s\S]*?\n {4}}\n/);
  assert.ok(startFnMatch, 'expected to locate startRecording()');
  const recorderStartIdx = startFnMatch[0].indexOf('recorder.start();');
  const captionSetIdx = startFnMatch[0].indexOf('MIC_CAPTION_RECORDING');
  const dotShowIdx = startFnMatch[0].indexOf("els.recdot.classList.remove('hidden')");
  assert.ok(recorderStartIdx !== -1 && captionSetIdx !== -1 && captionSetIdx > recorderStartIdx, 'expected MIC_CAPTION_RECORDING to be assigned AFTER recorder.start(), never before');
  assert.ok(dotShowIdx !== -1 && dotShowIdx > recorderStartIdx, 'expected the recording dot to be unhidden AFTER recorder.start(), never before');
});

test('the mic coin is gold in every state — no red/orange tint on the idle or recording mic (only the caption dot is red)', () => {
  const marker = '===== Shadowing (shd-) =====';
  const shdSection = css.slice(css.indexOf(marker));
  const micRuleMatch = shdSection.match(/\n\.shd-mic\s*{([^}]*)}/);
  assert.ok(micRuleMatch, 'expected a .shd-mic rule');
  assert.ok(!/#f87171|--shd-rec\b/.test(micRuleMatch[1]), 'expected the base .shd-mic coin to carry no red/danger tone');
});

test('the boards\' exact --shd-cream-soft (#e8d9b8) is defined and used on the gate subtitle, watch caption, and replay pill (p6 Buffet finding)', () => {
  const marker = '===== Shadowing (shd-) =====';
  const shdSection = css.slice(css.indexOf(marker));
  assert.ok(/--shd-cream-soft:\s*#e8d9b8;/.test(shdSection), 'expected a --shd-cream-soft: #e8d9b8; token in the shd- section');

  const gatesubMatch = shdSection.match(/\n\.shd-gatesub\s*{([^}]*)}/);
  assert.ok(gatesubMatch, 'expected a .shd-gatesub rule');
  assert.ok(/var\(--shd-cream-soft\)/.test(gatesubMatch[1]), 'expected .shd-gatesub ("Tấm vé vào rạp của Minny đây!") to use var(--shd-cream-soft), not --cream-muted');

  const sublineMatch = shdSection.match(/\n\.shd-subline\s*{([^}]*)}/);
  assert.ok(sublineMatch, 'expected a .shd-subline rule');
  assert.ok(/var\(--shd-cream-soft\)/.test(sublineMatch[1]), 'expected .shd-subline ("Minny cũng đang xem cùng con") to use var(--shd-cream-soft), not --cream-muted');

  const replayMatch = shdSection.match(/\n\.shd-replay\s*{([^}]*)}/);
  assert.ok(replayMatch, 'expected a .shd-replay rule');
  assert.ok(/var\(--shd-cream-soft\)/.test(replayMatch[1]), 'expected .shd-replay ("🔊 Nghe lại câu") to use var(--shd-cream-soft), not --cream-muted');
});

// ---------------------------------------------------------------------------
// p6 final item: the stage-header round back-circle button (boards 02/03/04/06)
// ---------------------------------------------------------------------------

test('the round 44px back-circle button exists in the stage HUD with the boards\' "‹" glyph, aria-label, and --shd-cream-soft color', () => {
  const hudMatch = page.match(/<div class="shd-hud" id="shd-hud">[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(hudMatch, 'expected to locate the #shd-hud block');
  assert.match(hudMatch[0], /<button class="shd-stage-back" id="shd-stage-back-btn" type="button" aria-label="[^"]+">‹<\/button>/, 'expected #shd-stage-back-btn as a round back button carrying the literal "‹" glyph, inside #shd-hud');

  const marker = '===== Shadowing (shd-) =====';
  const shdSection = css.slice(css.indexOf(marker));
  const backRuleMatch = shdSection.match(/\n\.shd-stage-back\s*{([^}]*)}/);
  assert.ok(backRuleMatch, 'expected a .shd-stage-back rule');
  assert.ok(/width:\s*44px/.test(backRuleMatch[1]) && /height:\s*44px/.test(backRuleMatch[1]), 'expected the back-circle to be 44px (kid-facing touch-target minimum)');
  assert.ok(/border-radius:\s*50%/.test(backRuleMatch[1]), 'expected the back-circle to be round, per the boards');
  assert.ok(/var\(--shd-cream-soft\)/.test(backRuleMatch[1]), 'expected the "‹" glyph to use var(--shd-cream-soft), matching file 04\'s shipped recipe');
});

test('the back-circle is disabled during the grading-wait ("listen") subview, the same signal that already blurs the HUD', () => {
  const switchSubviewMatch = page.match(/function switchSubview\(name\)\s*{[\s\S]*?\n {4}}\n/);
  assert.ok(switchSubviewMatch, 'expected to locate switchSubview()');
  const body = switchSubviewMatch[0];
  assert.match(body, /els\.hud\.classList\.toggle\('shd-blurred',\s*listening\)/, 'expected the existing HUD-blur-during-listen line (the pattern to match)');
  assert.match(body, /els\.stageBackBtn\.disabled\s*=\s*listening/, 'expected els.stageBackBtn.disabled to be driven by the same `listening` flag as the HUD blur');
});

test('the back-circle is wired to goBackToPicker(), which saves the snapshot BEFORE teardownPlayer() nulls the session it reads', () => {
  assert.match(page, /els\.stageBackBtn\.addEventListener\('click',\s*goBackToPicker\)/, 'expected #shd-stage-back-btn to reuse the existing goBackToPicker() exit path');

  const fnMatch = page.match(/function goBackToPicker\(\)\s*{[\s\S]*?\n {4}}\n/);
  assert.ok(fnMatch, 'expected to locate goBackToPicker()');
  const body = fnMatch[0];
  const saveIdx = body.indexOf('saveSnapshot();');
  const teardownIdx = body.indexOf('teardownPlayer();');
  assert.ok(saveIdx !== -1, 'expected goBackToPicker() to call saveSnapshot()');
  assert.ok(teardownIdx !== -1 && saveIdx < teardownIdx, 'expected saveSnapshot() BEFORE teardownPlayer() -- teardownPlayer() nulls session/currentVideo, which saveSnapshot() reads');
});

test('showComplete() hides the back-circle (board 07 draws no such glyph); startVideo() resets it visible+enabled for a fresh video', () => {
  const completeMatch = page.match(/function showComplete\(\)\s*{[\s\S]*?\n {4}}\n/);
  assert.ok(completeMatch, 'expected to locate showComplete()');
  assert.match(completeMatch[0], /els\.stageBackBtn\.classList\.add\('hidden'\)/, 'expected showComplete() to hide the round back-circle');

  const startMatch = page.match(/async function startVideo\(video\)\s*{[\s\S]*?\n {4}}\n/);
  assert.ok(startMatch, 'expected to locate startVideo()');
  assert.match(startMatch[0], /els\.stageBackBtn\.classList\.remove\('hidden'\)/, 'expected startVideo() to unhide the round back-circle for a fresh video');
  assert.match(startMatch[0], /els\.stageBackBtn\.disabled\s*=\s*false/, 'expected startVideo() to re-enable the round back-circle for a fresh video');
});

test('the three async race points a mid-session back-tap makes reachable all check for a torn-down session before touching it (never lands a grade on an unmounted screen)', () => {
  const correctAdvanceMatch = page.match(/if \(isCorrect\) {[\s\S]*?window\.setTimeout\(\(\) => {[\s\S]*?}, 900\);/);
  assert.ok(correctAdvanceMatch, 'expected to locate the correct-answer 900ms auto-advance timeout');
  assert.match(correctAdvanceMatch[0], /if \(session\) renderStage\(\);/, 'expected the 900ms auto-advance timeout to check session before calling renderStage(), mirroring showWait()\'s own resume guard');

  const stopRecordingMatch = page.match(/async function stopRecording\(\)\s*{[\s\S]*?\n {4}}\n/);
  assert.ok(stopRecordingMatch, 'expected to locate stopRecording()');
  const stopBody = stopRecordingMatch[0];
  const sessionGuardIdx = stopBody.lastIndexOf('if (!session) return;');
  const submitCallIdx = stopBody.indexOf('await submitRecording(blob);');
  assert.ok(sessionGuardIdx !== -1 && submitCallIdx !== -1 && sessionGuardIdx < submitCallIdx, 'expected stopRecording() to check session is still live BEFORE calling submitRecording() (which reads session unconditionally as its first statement)');

  const submitMatch = page.match(/async function submitRecording\(blob\)\s*{[\s\S]*$/);
  assert.ok(submitMatch, 'expected to locate submitRecording()');
  assert.match(submitMatch[0], /if \(!session \|\| currentVideo !== videoAtStart\) return;/, 'expected submitRecording() to bail out if the kid exited while its fetch was in flight, before showWait/showCelebrate/showGiveUp can run on a null session');
});
