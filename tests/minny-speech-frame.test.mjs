import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreSpeechFrame, runSpeakingCheck } from '../functions/api/read2lead-speaking-check.js';
import { azureUsageKey } from '../functions/api/_azure-pronunciation.js';

const stemsFixture = [
  { id: 'f1', text_en: 'Last summer, I went to ___.', anchor_words: ['last','summer','i','went','to'] },
  { id: 'f2', text_en: 'I saw ___.', anchor_words: ['i','saw'] },
  { id: 'f3', text_en: 'The weather was ___.', anchor_words: ['the','weather','was'] },
  { id: 'f4', text_en: 'I ate ___.', anchor_words: ['i','ate'] },
  { id: 'f5', text_en: 'I felt ___.', anchor_words: ['i','felt'] },
  { id: 'f6', text_en: 'It was a great trip.', anchor_words: ['it','was','a','great','trip'] },
];

test('scoreSpeechFrame full coverage, on-target duration', () => {
  const transcript = 'Last summer I went to Da Nang. I saw many beautiful beaches. The weather was sunny. I ate delicious seafood. I felt happy. It was a great trip.';
  const result = scoreSpeechFrame(transcript, stemsFixture, 60, { peak_level: '0.8', duration_seconds: 58 });
  assert.ok(result.matchPct >= 90);
  assert.equal(result.rubric.spokeAllStems, true);
  assert.equal(result.rubric.durationOnTarget, true);
  assert.equal(result.rubric.spokeClearly, true);
  assert.equal(result.stems.length, 6);
  assert.ok(result.wordCount > 10);
  assert.equal(result.durationSec, 58);
});

test('scoreSpeechFrame partial coverage, short duration', () => {
  const transcript = 'I went to Da Nang. I saw beaches.';
  const result = scoreSpeechFrame(transcript, stemsFixture, 60, { peak_level: '0.3', duration_seconds: 12 });
  assert.ok(result.matchPct < 70);
  assert.equal(result.rubric.spokeAllStems, false);
  assert.equal(result.rubric.durationOnTarget, false);
  assert.equal(result.rubric.spokeClearly, true);
  const matchedCount = result.stems.filter(s => s.matched).length;
  assert.ok(matchedCount >= 1 && matchedCount < stemsFixture.length);
});

test('scoreSpeechFrame empty transcript', () => {
  const result = scoreSpeechFrame('', stemsFixture, 60, {});
  assert.equal(result.matchPct, 0);
  assert.equal(result.rubric.spokeAllStems, false);
  assert.equal(result.rubric.durationOnTarget, false);
  assert.equal(result.rubric.spokeClearly, true);
  assert.equal(result.wordCount, 0);
  assert.equal(result.durationSec, 0);
});

test('scoreSpeechFrame duration far outside tolerance', () => {
  const transcript = 'Last summer I went to Da Nang. I saw many beautiful beaches. The weather was sunny. I ate delicious seafood. I felt happy. It was a great trip.';
  const result = scoreSpeechFrame(transcript, stemsFixture, 60, { peak_level: '0.9', duration_seconds: 10 });
  assert.equal(result.rubric.durationOnTarget, false);
  assert.ok(result.matchPct >= 90);
  assert.equal(result.rubric.spokeAllStems, true);
});

test('scoreSpeechFrame spokeClearly false when peak_level zero', () => {
  const transcript = 'I went to Da Nang.';
  const result = scoreSpeechFrame(transcript, stemsFixture, 60, { peak_level: '0', duration_seconds: 55 });
  assert.equal(result.rubric.spokeClearly, false);
});

test('scoreSpeechFrame spokeClearly true when peak_level missing', () => {
  const transcript = 'I went to Da Nang.';
  const result = scoreSpeechFrame(transcript, stemsFixture, 60, { duration_seconds: 55 });
  assert.equal(result.rubric.spokeClearly, true);
});

// ---------------------------------------------------------------------------
// speakup-azure-frame-grading (V1, 2026-07-11): frame steps additionally get
// Azure unscripted pronunciation grading on top of the deterministic
// scoreSpeechFrame result above (which stays the source of truth and is
// asserted unchanged throughout). Self-contained fixtures per this file's
// convention (no cross-import from tests/azure-pronunciation.test.mjs).
// ---------------------------------------------------------------------------

function makeFakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      const raw = store.get(key);
      if (!raw) return null;
      return opts?.type === 'json' ? JSON.parse(raw) : raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

const FRAME_AZURE_NBEST = {
  RecognitionStatus: 'Success',
  NBest: [{
    Display: 'Last summer I went to Da Nang.',
    PronScore: 88,
    AccuracyScore: 90,
    FluencyScore: 85,
  }],
};

function writeAscii(bytes, offset, str) {
  for (let i = 0; i < str.length; i += 1) bytes[offset + i] = str.charCodeAt(i);
}

function makeWavBlob(durationSeconds) {
  const sampleRate = 16000;
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = Math.round(byteRate * durationSeconds);
  const buffer = new ArrayBuffer(44 + dataSize);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  writeAscii(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(bytes, 8, 'WAVE');
  writeAscii(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(bytes, 36, 'data');
  view.setUint32(40, dataSize, true);
  return new Blob([bytes], { type: 'audio/wav' });
}

const FRAME_TRANSCRIPT = 'Last summer I went to Da Nang. I saw many beautiful beaches. The weather was sunny. I ate delicious seafood. I felt happy. It was a great trip.';
const frameFakeAi = { async run() { return { text: FRAME_TRANSCRIPT }; } };

test('runSpeakingCheck frame mode: Azure configured + WAV attaches an optional pronunciation block; scoreSpeechFrame fields untouched', async () => {
  const kv = makeFakeKv();
  let azureCalls = 0;
  const fetchFn = async (url, init) => {
    azureCalls += 1;
    const params = JSON.parse(Buffer.from(init.headers['Pronunciation-Assessment'], 'base64').toString('utf8'));
    assert.equal('ReferenceText' in params, false, 'frame Azure call is unscripted, same as photo_talk');
    return new Response(JSON.stringify(FRAME_AZURE_NBEST), { status: 200 });
  };

  const result = await runSpeakingCheck({
    audioBlob: makeWavBlob(20),
    expectedText: '',
    checkMode: 'frame',
    ai: frameFakeAi,
    stems: stemsFixture,
    durationTargetSec: 60,
    telemetry: { peak_level: '0.8', duration_seconds: 58 },
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });

  assert.equal(azureCalls, 1);
  assert.equal(result.check_mode, 'frame');
  // Deterministic scoreSpeechFrame fields are exactly as scoreSpeechFrame
  // itself would compute — untouched by the additive Azure block.
  const deterministic = scoreSpeechFrame(FRAME_TRANSCRIPT, stemsFixture, 60, { peak_level: '0.8', duration_seconds: 58 });
  assert.equal(result.matchPct, deterministic.matchPct);
  assert.deepEqual(result.rubric, deterministic.rubric);
  assert.deepEqual(result.stems, deterministic.stems);
  assert.equal(result.wordCount, deterministic.wordCount);
  assert.equal(result.durationSec, deterministic.durationSec);

  assert.ok(result.pronunciation, 'optional pronunciation block attached');
  assert.equal(result.pronunciation.accuracy_percent, 90);
  assert.equal(result.pronunciation.fluency_percent, 85);
  assert.equal(result.pronunciation.scorer, 'azure_pronunciation_unscripted');
  assert.ok(Math.abs(result.pronunciation.sampled_seconds - 20) < 0.01, 'sampled_seconds ~= actual short-clip duration');

  const meterKey = [...kv.store.keys()].find((k) => k.startsWith('azure-pa-secs:'));
  assert.ok(meterKey, 'usage meter written');
  const bumped = JSON.parse(kv.store.get(meterKey));
  assert.ok(Math.abs(bumped - 20) < 0.01, 'meter bumped by the MEASURED sampled seconds (~20s), not the flat 30s estimate');
});

test('runSpeakingCheck frame mode: a clip over 30s is sampled down (not skipped) and the meter reflects ~30s, not the full length', async () => {
  const kv = makeFakeKv();
  let azureCalls = 0;
  const fetchFn = async () => {
    azureCalls += 1;
    return new Response(JSON.stringify(FRAME_AZURE_NBEST), { status: 200 });
  };

  const result = await runSpeakingCheck({
    audioBlob: makeWavBlob(75), // matches hw_frame's real max_seconds shape (duration_s 60 + 15)
    expectedText: '',
    checkMode: 'frame',
    ai: frameFakeAi,
    stems: stemsFixture,
    durationTargetSec: 60,
    telemetry: { peak_level: '0.8', duration_seconds: 70 },
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });

  assert.equal(azureCalls, 1, 'Azure still runs — the recording is sampled, not rejected outright');
  assert.ok(result.pronunciation);
  assert.equal(result.pronunciation.sampled_seconds, 30, 'capped at Azure\'s 30s short-audio limit');

  const meterKey = [...kv.store.keys()].find((k) => k.startsWith('azure-pa-secs:'));
  assert.equal(JSON.parse(kv.store.get(meterKey)), 30);
});

test('runSpeakingCheck frame mode: ANY Azure failure leaves the frame result byte-identical to today (deep-equal, no pronunciation key at all)', async () => {
  const stems = stemsFixture;
  const telemetry = { peak_level: '0.8', duration_seconds: 58 };

  const baseline = await runSpeakingCheck({
    audioBlob: new Blob(['not-wav-audio'], { type: 'audio/webm' }), // Azure never attempted
    expectedText: '',
    checkMode: 'frame',
    ai: frameFakeAi,
    stems,
    durationTargetSec: 60,
    telemetry,
  });

  const fetchFn = async () => new Response('boom', { status: 500 });
  const failKv = makeFakeKv();
  const withAzureFailing = await runSpeakingCheck({
    audioBlob: makeWavBlob(20),
    expectedText: '',
    checkMode: 'frame',
    ai: frameFakeAi,
    stems,
    durationTargetSec: 60,
    telemetry,
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: failKv },
    fetchFn,
  });

  assert.deepEqual(withAzureFailing, baseline, 'a failed Azure call must add nothing and change nothing');
  assert.equal('pronunciation' in withAzureFailing, false);
  // Buffet nit (2026-07-11): the meter must NOT be charged for a failed call --
  // azureBumpUsage sits after the await that threw, so the usage key stays absent.
  assert.equal(await failKv.get(azureUsageKey(), { type: 'json' }), null, 'meter untouched when the Azure call fails');
});

test('runSpeakingCheck frame mode: non-WAV audio never attempts Azure', async () => {
  const kv = makeFakeKv();
  let azureCalls = 0;
  const fetchFn = async () => {
    azureCalls += 1;
    return new Response(JSON.stringify(FRAME_AZURE_NBEST), { status: 200 });
  };
  const result = await runSpeakingCheck({
    audioBlob: new Blob(['webm-bytes'], { type: 'audio/webm' }),
    expectedText: '',
    checkMode: 'frame',
    ai: frameFakeAi,
    stems: stemsFixture,
    durationTargetSec: 60,
    telemetry: { peak_level: '0.8', duration_seconds: 58 },
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });
  assert.equal(azureCalls, 0);
  assert.equal(result.pronunciation, undefined);
});

test('runSpeakingCheck frame mode: over the free-tier meter skips Azure, frame result still returned', async () => {
  const kv = makeFakeKv();
  // runSpeakingCheck's frame branch calls azureUnderFreeTier(kv, sampledSeconds)
  // without a fixed `now`, so it keys off the real current month -- compute
  // the same key azureUsageKey() would, rather than hardcoding a month.
  await kv.put(azureUsageKey(), JSON.stringify(5 * 3600 - 5)); // 5 seconds of headroom left this month
  let azureCalls = 0;
  const fetchFn = async () => {
    azureCalls += 1;
    return new Response(JSON.stringify(FRAME_AZURE_NBEST), { status: 200 });
  };
  const result = await runSpeakingCheck({
    audioBlob: makeWavBlob(20), // needs ~20s, more than the 5s headroom
    expectedText: '',
    checkMode: 'frame',
    ai: frameFakeAi,
    stems: stemsFixture,
    durationTargetSec: 60,
    telemetry: { peak_level: '0.8', duration_seconds: 58 },
    env: { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'southeastasia', READ2LEAD_CODES: kv },
    fetchFn,
  });
  assert.equal(azureCalls, 0, 'over tier — Azure never called');
  assert.equal(result.pronunciation, undefined);
  assert.ok(result.matchPct >= 0, 'deterministic scoring still runs normally');
});

// ---------------------------------------------------------------------------
// UI: the warm pronunciation row in speak-up.astro's frame results panel
// (Task 4/5 of the packet). No jsdom in this repo (see tests/minny-speaking
// .test.mjs, tests/speakup-chips-ui.test.mjs) -- pure row-building logic is
// extracted straight out of the page's inline script and executed via
// `new Function`, exactly like tests/speakup-chips-ui.test.mjs's convention;
// DOM-touching wiring is checked structurally instead.
// ---------------------------------------------------------------------------

const speakingPage = readFileSync('src/pages/speak-up.astro', 'utf-8');

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

function loadPronunciationRow() {
  // Also pulls in wordChips + practiceWordsRow (speakup-word-level-feedback,
  // V1, 2026-07-12): practiceWordsRow calls wordChips, which calls
  // escapeHtml, so all three travel together for the `new Function` eval.
  const body = [
    extractFunctionSrc(speakingPage, 'escapeHtml'),
    extractFunctionSrc(speakingPage, 'wordChips'),
    extractFunctionSrc(speakingPage, 'pronunciationRow'),
    extractFunctionSrc(speakingPage, 'practiceWordsRow'),
    'return { wordChips, pronunciationRow, practiceWordsRow };',
  ].join('\n\n');
  // eslint-disable-next-line no-new-func -- see file header: pure, DOM-free source extracted from the page itself
  return new Function(body)();
}

const { wordChips, pronunciationRow, practiceWordsRow } = loadPronunciationRow();

test('pronunciationRow: absent block renders nothing (frame panel stays byte-identical to today)', () => {
  assert.equal(pronunciationRow(null), '');
  assert.equal(pronunciationRow(undefined), '');
});

test('pronunciationRow: >=50% accuracy shows the warm percent value, always the green "is-ok" mark, never "is-miss"', () => {
  const html = pronunciationRow({ accuracy_percent: 86 });
  assert.match(html, /Phát âm rõ ràng/);
  assert.match(html, /86% 🌟/);
  assert.match(html, /minny-frame-rubric-row__mark is-ok/);
  assert.doesNotMatch(html, /is-miss/);
});

test('pronunciationRow: <50% accuracy shows the Lead-authored encouragement copy verbatim instead of the number, still "is-ok"', () => {
  const html = pronunciationRow({ accuracy_percent: 40 });
  assert.match(html, /Con nói to rõ hơn nhé! 💪/);
  assert.doesNotMatch(html, /40%/);
  assert.match(html, /minny-frame-rubric-row__mark is-ok/);
  assert.doesNotMatch(html, /is-miss/);
});

test('renderFrameResult wires pronunciationRow into the rubric card off result.pronunciation', () => {
  const src = extractFunctionSrc(speakingPage, 'renderFrameResult');
  assert.match(src, /pronunciationRow\(result\.pronunciation\)/);
});

test('client recorder condition: frame steps record WAV, alongside read and hw_photo_talk (Task 1)', () => {
  assert.match(
    speakingPage,
    /recStep\.check_mode === 'read' \|\| recStep\.id === 'hw_photo_talk' \|\| recStep\.check_mode === 'frame'/,
  );
});

// ---------------------------------------------------------------------------
// speakup-word-level-feedback (V1, 2026-07-12): per-word chips for
// presentations ("Từ cần luyện:") + tap-to-hear-Minny on every word chip.
// ---------------------------------------------------------------------------

test('wordChips: renders real buttons (not spans) carrying the word in data-word, escaped', () => {
  const html = wordChips(['dog', 'a "quoted" word'], 'miss');
  assert.match(html, /<button type="button" class="minny-word minny-word--miss" data-word="dog">dog<\/button>/);
  assert.match(html, /data-word="a &quot;quoted&quot; word"/, 'attribute value is HTML-escaped');
});

test('wordChips: absent/empty words -> empty string (unchanged)', () => {
  assert.equal(wordChips(null, 'miss'), '');
  assert.equal(wordChips([], 'miss'), '');
});

test('practiceWordsRow: absent/empty pronunciation.words -> nothing (frame panel stays byte-identical without this data)', () => {
  assert.equal(practiceWordsRow(null), '');
  assert.equal(practiceWordsRow(undefined), '');
  assert.equal(practiceWordsRow({ accuracy_percent: 80 }), ''); // no words[] at all
  assert.equal(practiceWordsRow({ words: [] }), '');
});

test('practiceWordsRow: renders the Lead-authored "Từ cần luyện:" label with the plain word strings via wordChips(...,\'miss\')', () => {
  const html = practiceWordsRow({ words: [{ word: 'apples', accuracy_percent: 40 }, { word: 'run', accuracy_percent: 55 }] });
  assert.match(html, /Từ cần luyện:/);
  assert.match(html, /minny-word--miss/);
  assert.match(html, /data-word="apples"/);
  assert.match(html, /data-word="run"/);
  // Maps to plain word strings first -- accuracy_percent must not leak into the chip markup.
  assert.doesNotMatch(html, /40/);
  assert.doesNotMatch(html, /55/);
});

test('renderFrameResult wires practiceWordsRow into the rubric card, right after pronunciationRow', () => {
  const src = extractFunctionSrc(speakingPage, 'renderFrameResult');
  assert.match(src, /pronunciationRow\(result\.pronunciation\)[\s\S]*practiceWordsRow\(result\.pronunciation\)/);
});

test('tap-to-hear: one delegated click handler on #speaking-result covers every .minny-word chip', () => {
  const idx = speakingPage.indexOf("getElementById('speaking-result')?.addEventListener('click'");
  assert.notEqual(idx, -1, 'delegated click handler registered on the results container');
  const handlerSrc = speakingPage.slice(idx, speakingPage.indexOf('});', idx) + 3);
  assert.match(handlerSrc, /closest\('\.minny-word'\)/, 'delegation targets any chip rendered by wordChips (read-step + frame)');
  assert.match(handlerSrc, /normalizePracticeWord\(chip\.dataset\.word\)/, 'normalizes the chip word before sending -- must match what the server allowlisted');
  assert.match(handlerSrc, /playMinnyVoice\(\{\s*word\s*\}\s*,\s*''\s*\)/, 'reuses the page\'s existing fetch-then-play helper, no new Audio pattern');
  assert.doesNotMatch(handlerSrc, /new Audio\(/, 'must not add a second Audio-playing pattern');
  assert.match(handlerSrc, /is-loading/, 'pressed/pulse state while the request is in flight');
});

test('tap-to-hear handler comment documents that "Con nhắc tới:" (words_matched) taps are expected to no-op (Elon ruling 2026-07-12, accepted as-built)', () => {
  const idx = speakingPage.indexOf("getElementById('speaking-result')?.addEventListener('click'");
  const commentStart = speakingPage.lastIndexOf('// Tap-to-hear', idx);
  assert.notEqual(commentStart, -1);
  const comment = speakingPage.slice(commentStart, idx);
  assert.match(comment, /words_matched/);
  assert.match(comment, /no-op/i);
});

test('normalizePracticeWord (client): mirrors the server\'s normalizePracticeWord exactly -- strips outside [a-z\'-] after lowercasing', () => {
  const body = `${extractFunctionSrc(speakingPage, 'normalizePracticeWord')}\n\nreturn { normalizePracticeWord };`;
  // eslint-disable-next-line no-new-func -- see file header: pure, DOM-free source extracted from the page itself
  const { normalizePracticeWord } = new Function(body)();
  assert.equal(normalizePracticeWord('banana.'), 'banana');
  assert.equal(normalizePracticeWord('DOG!'), 'dog');
  assert.equal(normalizePracticeWord("don't"), "don't");
  assert.equal(normalizePracticeWord('...'), '', 'a chip that somehow normalizes to nothing never fires a request (early return on falsy word)');
});

test('playMinnyVoice posts { access_code, word } and falls back to a silent no-op (not speechSynthesis) on 403/error', () => {
  const src = extractFunctionSrc(speakingPage, 'playMinnyVoice');
  assert.match(src, /'\/api\/minny-voice'/);
  assert.match(src, /\.\.\.payload/, 'spreads the caller\'s payload (word/text/phrase_id) alongside access_code');
  // speakEnglish('') is a no-op (see its own guard: `if (!line ...) return;`),
  // so passing an empty fallbackText for the word-chip call site is how tap-
  // to-hear stays silent on failure without a second failure-handling path.
  const speakEnglishSrc = extractFunctionSrc(speakingPage, 'speakEnglish');
  assert.match(speakEnglishSrc, /if \(!line \|\| !window\.speechSynthesis\) return;/);
});
