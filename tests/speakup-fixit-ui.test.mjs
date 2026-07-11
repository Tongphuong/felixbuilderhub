// V1.4 fix-it round + listen-and-compare (Wave D Set 2 mock, screens 3-5:
// design_handoff_speakup_v1/SpeakUp V1 Homework Feedback v2.dc.html).
//
// Same repo convention as tests/speakup-chips-ui.test.mjs (no jsdom
// available — see that file's header): the pure, DOM-free decision
// functions are extracted straight out of speak-up.astro's inline script
// (brace-matched slice) and evaluated via `new Function` for real
// behavioral coverage; the DOM-wiring/CSS pieces get string/region
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

function extractConstSrc(source, name) {
  const re = new RegExp(`const ${name}\\s*=\\s*[^;]+;`);
  const m = source.match(re);
  assert.ok(m, `const ${name} not found in speak-up.astro`);
  return m[0];
}

// Pulls the pure V1.4 fix-it helpers out of the page's inline script. Order:
// the constants first (FIXIT_CELEBRATE_MIN/FIXIT_REP_CAP are referenced by
// the functions below them), then normalizePracticeWord (fixitDeriveRepWords
// dedupes through it), then the fix-it functions themselves.
function loadPureHelpers() {
  const pieces = [
    extractConstSrc(speakingPage, 'FIXIT_REP_CAP'),
    extractConstSrc(speakingPage, 'FIXIT_CELEBRATE_MIN'),
    extractFunctionSrc(speakingPage, 'normalizePracticeWord'),
    extractFunctionSrc(speakingPage, 'fixitDeriveRepWords'),
    extractFunctionSrc(speakingPage, 'fixitRepOutcome'),
    extractFunctionSrc(speakingPage, 'fixitAfterRep'),
    extractFunctionSrc(speakingPage, 'fixitReadCheckRequestFields'),
  ];
  const body = `${pieces.join('\n\n')}\n\nreturn { fixitDeriveRepWords, fixitRepOutcome, fixitAfterRep, fixitReadCheckRequestFields, FIXIT_REP_CAP, FIXIT_CELEBRATE_MIN };`;
  // eslint-disable-next-line no-new-func -- see file header: pure, DOM-free source extracted from the page itself
  return new Function(body)();
}

const {
  fixitDeriveRepWords, fixitRepOutcome, fixitAfterRep, fixitReadCheckRequestFields, FIXIT_REP_CAP, FIXIT_CELEBRATE_MIN,
} = loadPureHelpers();

// ---------------------------------------------------------------------------
// Rep-word derivation (read + frame shapes, max 3, dedupe)
// ---------------------------------------------------------------------------

test('fixitDeriveRepWords: read mode uses words_close then words_missed, same order renderResult already shows them', () => {
  const result = { ok: true, check_mode: 'read', words_close: ['went'], words_missed: ['excited', 'banana'] };
  assert.deepEqual(fixitDeriveRepWords(result), ['went', 'excited', 'banana']);
});

test('fixitDeriveRepWords: frame mode uses pronunciation.words[].word', () => {
  const result = {
    ok: true,
    check_mode: 'frame',
    pronunciation: { words: [{ word: 'went', accuracy_percent: 40 }, { word: 'excited', accuracy_percent: 55 }] },
  };
  assert.deepEqual(fixitDeriveRepWords(result), ['went', 'excited']);
});

test('fixitDeriveRepWords: caps at 3 even when the source list is longer', () => {
  const result = { ok: true, check_mode: 'read', words_close: [], words_missed: ['a', 'b', 'c', 'd', 'e'] };
  assert.deepEqual(fixitDeriveRepWords(result), ['a', 'b', 'c']);
});

test('fixitDeriveRepWords: dedupes via normalizePracticeWord (case/punctuation-insensitive), keeps first occurrence', () => {
  const result = { ok: true, check_mode: 'read', words_close: ['Went'], words_missed: ['went.', 'excited'] };
  assert.deepEqual(fixitDeriveRepWords(result), ['Went', 'excited']);
});

test('fixitDeriveRepWords: "open" check_mode never offers a fix-it round (words_matched only, no missed/close concept)', () => {
  const result = { ok: true, check_mode: 'open', words_matched: ['dog', 'cat'] };
  assert.deepEqual(fixitDeriveRepWords(result), []);
});

test('fixitDeriveRepWords: absent on a failed result, empty pronunciation, or no practice words at all', () => {
  assert.deepEqual(fixitDeriveRepWords({ ok: false, check_mode: 'read', words_missed: ['x'] }), []);
  assert.deepEqual(fixitDeriveRepWords({ ok: true, check_mode: 'frame', pronunciation: null }), []);
  assert.deepEqual(fixitDeriveRepWords({ ok: true, check_mode: 'read', words_close: [], words_missed: [] }), []);
  assert.deepEqual(fixitDeriveRepWords(null), []);
});

// ---------------------------------------------------------------------------
// Improvement -> celebrate / still-low -> encourage (never negative)
// ---------------------------------------------------------------------------

test('fixitRepOutcome: a single-word read-check scores 100/50/0 (scoreTranscript); only >=70 (exact match) celebrates', () => {
  assert.equal(fixitRepOutcome(100), 'celebrate', 'exact match');
  assert.equal(fixitRepOutcome(70), 'celebrate', 'the cutoff itself');
  assert.equal(fixitRepOutcome(50), 'encourage', 'close match — never negative, just encourage');
  assert.equal(fixitRepOutcome(0), 'encourage', 'missed — still never negative, just encourage');
  assert.equal(fixitRepOutcome(undefined), 'encourage', 'non-finite defaults to encourage, never celebrate');
  assert.equal(fixitRepOutcome(NaN), 'encourage');
});

test('FIXIT_CELEBRATE_MIN reuses the frame panel\'s existing celebrate cutoff (70), not a new number', () => {
  assert.equal(FIXIT_CELEBRATE_MIN, 70);
});

// ---------------------------------------------------------------------------
// The 3-rep hard cap — the Azure cost fence (CONTROL.md speakup-v1-4-fixit
// -round: "the 3-rep hard cap IS the fence — assert it in tests")
// ---------------------------------------------------------------------------

test('FIXIT_REP_CAP is 3 (<=3 scored reps total per homework attempt, not per word)', () => {
  assert.equal(FIXIT_REP_CAP, 3);
});

test('fixitAfterRep: celebrate with words left in the invite -> advance to the next word', () => {
  const fx = { wordIndex: 0, words: ['went', 'excited'], repsUsed: 0 };
  assert.deepEqual(fixitAfterRep(fx, 'celebrate'), { action: 'next-word', repsUsed: 1 });
});

test('fixitAfterRep: celebrate on the last word -> finish (closing celebrate screen)', () => {
  const fx = { wordIndex: 1, words: ['went', 'excited'], repsUsed: 0 };
  assert.deepEqual(fixitAfterRep(fx, 'celebrate'), { action: 'finish', repsUsed: 1 });
});

test('fixitAfterRep: encourage with reps remaining -> offer another try on the SAME word', () => {
  const fx = { wordIndex: 0, words: ['went', 'excited'], repsUsed: 0 };
  assert.deepEqual(fixitAfterRep(fx, 'encourage'), { action: 'retry-word', repsUsed: 1 });
});

test('fixitAfterRep: the cap is a TOTAL across the whole round, not per word — hitting it always finishes, even mid-celebrate with words left', () => {
  const fx = { wordIndex: 0, words: ['went', 'excited', 'banana'], repsUsed: 2 };
  // This is the 3rd rep (repsUsed 2 -> 3): finish regardless of outcome or
  // whether more words were queued up.
  assert.deepEqual(fixitAfterRep(fx, 'celebrate'), { action: 'finish', repsUsed: 3 });
  assert.deepEqual(fixitAfterRep({ ...fx }, 'encourage'), { action: 'finish', repsUsed: 3 });
});

test('fixitAfterRep: never exceeds the cap even if called again after it was already reached', () => {
  const fx = { wordIndex: 0, words: ['went'], repsUsed: 3 };
  const result = fixitAfterRep(fx, 'encourage');
  assert.equal(result.action, 'finish');
  assert.ok(result.repsUsed >= FIXIT_REP_CAP);
});

// ---------------------------------------------------------------------------
// One-word re-record request shape (existing endpoint, zero backend change)
// ---------------------------------------------------------------------------

test('fixitReadCheckRequestFields: check_mode "read", expected_text = the word, practice_mode "1"', () => {
  assert.deepEqual(fixitReadCheckRequestFields('went'), { check_mode: 'read', expected_text: 'went', practice_mode: '1' });
  assert.deepEqual(fixitReadCheckRequestFields(''), { check_mode: 'read', expected_text: '', practice_mode: '1' });
});

// ---------------------------------------------------------------------------
// DOM wiring: structural / string-presence checks (repo convention for
// files with no jsdom — see tests/speakup-chips-ui.test.mjs).
// ---------------------------------------------------------------------------

test('new markup: #fixit-round container exists, initially hidden, placed after the existing #speaking-actions', () => {
  assert.match(speakingPage, /id="speaking-actions" class="spk-actions hidden"/);
  assert.match(speakingPage, /id="fixit-round" class="hidden"/);
  const actionsIdx = speakingPage.indexOf('id="speaking-actions"');
  const fixitIdx = speakingPage.indexOf('id="fixit-round"');
  assert.ok(actionsIdx > -1 && fixitIdx > actionsIdx, 'fixit-round must render after (below) speaking-actions, additive per the README framing');
});

test('maybeShowFixitInvite is wired in after both renderResult (read/open) and renderFrameResult, never before finalizeHomeworkStep/logPractice', () => {
  const renderResultSrc = extractFunctionSrc(speakingPage, 'renderResult');
  const frameResultSrc = extractFunctionSrc(speakingPage, 'renderFrameResult');
  assert.match(renderResultSrc, /finalizeHomeworkStep\(result, isLast\);\s*\n\s*logPractice\(result\);\s*\n\s*maybeShowFixitInvite\(result\);/);
  assert.match(frameResultSrc, /maybeShowFixitInvite\(result\);/);
});

test('renderStep and back-to-modes both reset the fix-it round (never survives a step change or leaving practice)', () => {
  const renderStepSrc = extractFunctionSrc(speakingPage, 'renderStep');
  assert.match(renderStepSrc, /fixitReset\(\);/);
  const backToModesIdx = speakingPage.indexOf("document.getElementById('back-to-modes')?.addEventListener('click'");
  assert.notEqual(backToModesIdx, -1);
  const backToModesBlock = speakingPage.slice(backToModesIdx, backToModesIdx + 400);
  assert.match(backToModesBlock, /fixitReset\(\);/);
});

test('skip is a real button, always available on the invitation, and closes the round without any further screen (never blocks "next step")', () => {
  const inviteSrc = extractFunctionSrc(speakingPage, 'renderFixitInvite');
  assert.match(inviteSrc, /id="fixit-skip-btn">Bỏ qua, làm sau</);
  assert.match(inviteSrc, /getElementById\('fixit-skip-btn'\)\?\.addEventListener\('click', fixitReset\)/);

  const resetSrc = extractFunctionSrc(speakingPage, 'fixitReset');
  assert.match(resetSrc, /classList\.add\('hidden'\)/);
  assert.match(resetSrc, /state\.fixit = null/);
});

test('mock copy verbatim: invitation title/CTA, rep progress/compare buttons/re-record label, celebrate title/sub', () => {
  assert.ok(speakingPage.includes('Mình luyện lại ${words.length} từ này nhé!'));
  assert.ok(speakingPage.includes('Bắt đầu luyện 🎯'));
  assert.ok(speakingPage.includes('Bỏ qua, làm sau'));
  assert.ok(speakingPage.includes('Từ ${fx.wordIndex + 1} / ${fx.words.length}'));
  assert.ok(speakingPage.includes('🔊 Nghe Minny'));
  assert.ok(speakingPage.includes('▶️ Nghe con nói'));
  assert.ok(speakingPage.includes('Nhấn để thu âm lại'));
  assert.ok(speakingPage.includes('Tuyệt vời! Con đã luyện xong ${count} từ rồi 🎉'));
  assert.ok(speakingPage.includes('Thầy Phương sẽ thấy con tiến bộ nhiều lắm.'));
  assert.ok(speakingPage.includes('Về trang cá nhân'));
  assert.ok(speakingPage.includes('Xong 🎯'));
});

test('hear-Minny reuses the shipped playMinnyVoice word branch (no new fetch pattern in the render function itself)', () => {
  const repSrc = extractFunctionSrc(speakingPage, 'renderFixitRep');
  assert.match(repSrc, /playMinnyVoice\(\{ word \}, ''\)/);
  assert.doesNotMatch(repSrc, /fetch\(/, 'renderFixitRep must not fetch directly — only wire the click handlers');
});

test('hear-yourself: no compare-kid button until this rep has its own recording; plays back a client-side blob URL only, uploads nothing', () => {
  const repSrc = extractFunctionSrc(speakingPage, 'renderFixitRep');
  assert.match(repSrc, /hasKidAudio \? '<button type="button" class="minny-compare-btn minny-compare-btn--kid"/);
  assert.match(repSrc, /new Audio\(fx\.kidAudioUrl\)/);
  assert.doesNotMatch(repSrc, /fetch\(/);
});

test('re-record reuses window.R2LRecorder primitives with the WAV engine, same sequence as the main startRecording (no new recording machinery)', () => {
  const startSrc = extractFunctionSrc(speakingPage, 'fixitStartRecording');
  assert.match(startSrc, /window\.R2LRecorder\?\.getStream/);
  assert.match(startSrc, /window\.R2LRecorder\?\.createRecorder/);
  assert.match(startSrc, /createRecorder\(stream, \{ engine: 'wav' \}\)/);
  assert.match(startSrc, /window\.R2LRecorder\?\.startMonitor/);
});

test('fixitSubmit posts to the EXISTING /api/read2lead-speaking-check endpoint with fixitReadCheckRequestFields\' exact shape, and always resolves the rep via fixitAfterRep', () => {
  const submitSrc = extractFunctionSrc(speakingPage, 'fixitSubmit');
  assert.match(submitSrc, /fetch\('\/api\/read2lead-speaking-check', \{ method: 'POST', body: formData \}\)/);
  assert.match(submitSrc, /fixitReadCheckRequestFields\(word\)/);
  assert.match(submitSrc, /formData\.append\('check_mode', fields\.check_mode\)/);
  assert.match(submitSrc, /formData\.append\('expected_text', fields\.expected_text\)/);
  assert.match(submitSrc, /formData\.append\('practice_mode', fields\.practice_mode\)/);
  assert.match(submitSrc, /fixitAfterRep\(fx, outcome\)/);
  // Never negative even on a network/parse failure — falls back to
  // 'encourage', not an error state, and still counts toward the cap.
  assert.match(submitSrc, /const outcome = data\?\.ok \? fixitRepOutcome\(data\.score_percent\) : 'encourage';/);
});

test('fixitSubmit reuses the server\'s existing feedback_vi copy (feedbackVi/feedbackOpenVi — never negative even at 0%) rather than inventing new per-word copy', () => {
  const submitSrc = extractFunctionSrc(speakingPage, 'fixitSubmit');
  assert.match(submitSrc, /data\?\.ok && data\.feedback_vi/);
});

test('renderFixitCelebrate: green celebrate family (7a precedent), no scores shown, "Xong" closes via fixitReset', () => {
  const celebrateSrc = extractFunctionSrc(speakingPage, 'renderFixitCelebrate');
  assert.match(celebrateSrc, /minny-fixit-celebrate/);
  assert.match(celebrateSrc, /spk-btn spk-btn--green" id="fixit-done-btn">Xong 🎯</);
  assert.match(celebrateSrc, /getElementById\('fixit-done-btn'\)\?\.addEventListener\('click', fixitReset\)/);
  assert.doesNotMatch(celebrateSrc, /score_percent|matchPct|%/, 'celebrate screen is encouragement-only, no scoring per the mock');
});

// ---------------------------------------------------------------------------
// Preserve everything shipped: zero functions/ diff is asserted by the
// dispatch contract itself (this file only touches speak-up.astro/
// speakup-app.css); this test guards that the shipped tap-to-hear chip
// delegate and flagged-word chip renderer are untouched call sites.
// ---------------------------------------------------------------------------

test('shipped machinery untouched: wordChips/practiceWordsRow/tap-to-hear delegate still present verbatim', () => {
  assert.match(speakingPage, /function wordChips\(words, tone\)/);
  assert.match(speakingPage, /function practiceWordsRow\(pronunciation\)/);
  assert.match(speakingPage, /getElementById\('speaking-result'\)\?\.addEventListener\('click', async \(event\) => \{/);
});

// ---------------------------------------------------------------------------
// 44px targets + reduced motion (per the mock's own accessibility notes)
// ---------------------------------------------------------------------------

test('fix-it tappable targets meet the 44px floor', () => {
  assert.match(speakupCss, /\.minny-fixit-invite__skip\s*\{[^}]*min-height:\s*44px/s);
  assert.match(speakupCss, /\.minny-compare-btn\s*\{[^}]*min-height:\s*48px/s);
  assert.match(speakupCss, /\.spk-rec-btn--sm\s*\{[^}]*width:\s*56px;\s*height:\s*56px/s);
});

test('reduced-motion disables the small re-record button\'s recording pulse (same convention as the main .spk-rec-btn rule)', () => {
  const rule = /@media \(prefers-reduced-motion: reduce\)[^@]*?\.spk-rec-btn--sm\.is-recording\s*\{[^}]*animation:\s*none/s;
  assert.match(speakupCss, rule);
});

test('#fixit-round.hidden and the three new card classes exist in speakup-app.css', () => {
  assert.match(speakupCss, /#fixit-round\.hidden\s*\{\s*display:\s*none;\s*\}/);
  assert.match(speakupCss, /\.minny-fixit-invite\s*\{/);
  assert.match(speakupCss, /\.minny-fixit-rep\s*\{/);
  assert.match(speakupCss, /\.minny-fixit-celebrate\s*\{/);
});
