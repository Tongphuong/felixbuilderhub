// Structural tests for the Shadowing page (speakup-shadowing-v1-p3-ui
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

// ---------------------------------------------------------------------------
// 1. DOM-contract ids (design_handoff_speakup_shadowing_v2/round2/README.md's
//    "mọi id vùng có sẵn trong markup các board" list, plus shd-player-overlay
//    which the wiring contract adds for the YouTube-chrome shield).
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

test('every DOM-contract id from the round2 README is present exactly once', () => {
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
  const reducedBlock = shdSection.slice(reducedBlockStart, reducedBlockStart + 500);
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
// screen) — includes the founder-approved exact line for the third-miss
// give-up state (round2 README: "Đã dùng theo chỉ đạo... (verbatim founder)").
const CANONICAL_STRINGS = [
  'Mã của con là gì?',
  'VD: R2L-LINH-8F3KQ2',
  'Vào xem!',
  'Chọn phim cho hôm nay nhé!',
  'Chưa luyện',
  'Xem nhé… sắp đến lượt con!',
  'Minny cũng đang xem cùng con',
  'Bây giờ đến lượt con nói!',
  'Đang ghi âm… nói cả câu nhé!',
  'Nghe lại câu',
  'Tuyệt vời!',
  'Câu tiếp theo →',
  'Gần đúng rồi!',
  'Thử lại lần nữa nhé!',
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
  // legitimately a bare access-code pattern, not Vietnamese prose.
  const NO_DIACRITIC_EXPECTED = new Set(['VD: R2L-LINH-8F3KQ2']);
  for (const str of CANONICAL_STRINGS) {
    if (NO_DIACRITIC_EXPECTED.has(str)) continue;
    assert.match(str, VN_DIACRITIC_RE, `expected "${str}" to carry at least one Vietnamese diacritic`);
  }
});

// ---------------------------------------------------------------------------
// 6. Buffet-A fix round (first review pass on ae6a104)
// ---------------------------------------------------------------------------

// Same source-extraction convention as tests/speakup-fixit-ui.test.mjs's
// loadPureHelpers(): milestoneBulbStates() is page-local presentation math
// (NOT engine logic, so it stays out of src/lib per the packet's file-set
// boundary) but it's still pure and worth unit-testing directly rather than
// trusting a string match alone.
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

test('a thrown fetch (res === null) routes to the gentle-wait path, same as a 429/asr_outage, never a scored attempt', () => {
  assert.match(
    page,
    /if\s*\(\s*!res\s*\|\|\s*res\.status === 429\s*\|\|\s*\(data && data\.ok === false && data\.asr_outage\)\s*\)\s*{\s*\n\s*showWait\(\);/,
    'expected !res to short-circuit into showWait() before any scorePercent/reduce SPEECH_SCORED call',
  );
});

test('dev-draft ribbon: the picker references content_status and renders the BẢN NHÁP ribbon string', () => {
  assert.ok(page.includes('content_status'), 'expected the picker to read video.content_status');
  assert.ok(page.includes('BẢN NHÁP'), 'expected the dev-draft ribbon copy "BẢN NHÁP" verbatim');
  // Missing-field-defaults-to-draft is the safe default (never silently
  // presented as approved) -- assert the comparison is the inclusive one,
  // not an opt-in "=== 'dev_draft'" that would treat an absent field as approved.
  assert.match(page, /content_status\s*!==\s*'approved'/, "expected a missing content_status to default to draft (checked via !== 'approved', not === 'dev_draft')");
});

test('the 11-item recorded-deviations list is retrievable as a comment block in shadowing.astro', () => {
  assert.ok(page.includes('RECORDED MOCK DEVIATIONS'), 'expected the deviations block header comment');
  assert.ok(page.includes('Buffet-A fix round'), 'expected the fix-round note appended to the deviations block');
});

test('the auto-advance-through-consecutive-watch-segments path carries an honest, non-behavior-changing comment', () => {
  assert.ok(page.includes('flagged for real-device verification'), 'expected the rule-20 real-device-verification flag comment near showWatchAndPlay()');
});
