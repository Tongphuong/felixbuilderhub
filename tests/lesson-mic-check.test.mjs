import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const micScript = readFileSync('public/scripts/r2l-mic-check.js', 'utf-8');
const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const speakingPage = readFileSync('src/pages/speak-up.astro', 'utf-8');
const listenSpeak = readFileSync('src/components/read2lead/v2/ListenAndSpeak.astro', 'utf-8');
const micPanel = readFileSync('src/components/read2lead/v2/MicCheckPanel.astro', 'utf-8');

test('mic check script exposes mount API and OS help', () => {
  assert.match(micScript, /global\.R2LMicCheck/);
  assert.match(micScript, /mount\(root/);
  assert.match(micScript, /isInAppBrowser/);
  assert.match(micScript, /getMicStream/);
  assert.match(micScript, /MIC_WARMUP_SECONDS/);
  assert.match(micScript, /runMicWarmupCountdown/);
  assert.match(micPanel, /data-mic-skip-lesson/);
  assert.match(micPanel, /data-mic-skip-lesson hidden/);
  assert.match(micScript, /SKIP_AFTER_FAILURES = 2/);
  assert.doesNotMatch(micScript, /markParentSkip|data-mic-parent-skip/);
  assert.match(micScript, /Windows → Cài đặt → Quyền riêng tư và bảo mật → Microphone/);
  assert.match(micScript, /Mac → Cài đặt hệ thống → Quyền riêng tư và bảo mật → Microphone/);
  assert.match(micScript, /data-mic-meter-bar/);
});

test('mic check is a live Zoom-style test (real-time meter + playback + re-test)', () => {
  // Live "heard you" detection while the bar moves in real time.
  assert.match(micScript, /Nghe rõ rồi/);
  assert.match(micScript, /level >= SILENT_LEVEL/);
  // Plays the child's own recording back.
  assert.match(micScript, /Nghe lại giọng con/);
  // Passed state is never a dead end — offers a working re-test button.
  assert.match(micScript, /Nói thử lại/);
  // Robust clipboard fallback so the copy button actually does something.
  assert.match(micScript, /function legacyCopy/);
  assert.match(micScript, /execCommand\('copy'\)/);
});

test('lesson page has mic prep banner and shared stream helper', () => {
  assert.match(lessonPage, /mic-prep-banner/);
  assert.match(lessonPage, /_r2lOpenMicStream/);
  assert.match(lessonPage, /_r2lRunMicWarmup/);
  assert.match(lessonPage, /_r2lFocusMicHelp/);
});

test('lesson and speaking pages load mic check script and panel', () => {
  assert.match(lessonPage, /r2l-mic-check\.js/);
  assert.match(speakingPage, /r2l-mic-check\.js/);
  assert.match(listenSpeak, /MicCheckPanel/);
  assert.match(speakingPage, /MicCheckPanel/);
  assert.match(lessonPage, /_r2lMountMicCheck/);
  assert.match(speakingPage, /mountSpeakingMicCheck/);
});

// ── r2l-micgate Fix 1: a mic-less child must not be trapped on book page 1 ──
//
// Two things both have to be true, or the "fix" is a no-op (per the packet):
// (1) the book-reader phase mounts the mic check with allowLessonSkip=true,
//     so [data-mic-skip-lesson] actually becomes visible after 2 failures;
// (2) the click handler for that button, when the lesson is on the
//     book_reader phase, settles the pending chunk and advances — not just
//     the activity-flow branch, which never matches for book reads.

test('r2l-micgate Fix 1a: book-reader phase mounts the mic check with allowLessonSkip=true', () => {
  assert.match(
    lessonPage,
    /_r2lMountMicCheck\(qs\('#w1-book-reader-phase'\),\s*0,\s*true\)/,
    'the book-reader mic-check mount must pass allowLessonSkip=true, or [data-mic-skip-lesson] stays hidden forever',
  );
});

// Extracts a top-level `function <name>(...) { ... }` declaration's full
// source (brace-balanced) out of the raw lesson.astro text. The inline
// <script is:inline> block cannot be imported as an ES module (see the
// normalizeGuidedListening comment above it), so this is how its runtime
// logic gets exercised in node:test instead of only pattern-matched.
function extractFunctionSource(source, name) {
  // (async )? — pollDeferredFullStoryAudio is declared `async function`;
  // dropping that keyword during extraction would silently turn every
  // `await` inside it into a SyntaxError instead of running the real code.
  const headMatch = source.match(new RegExp(`(async\\s+)?function ${name}\\s*\\([^)]*\\)\\s*\\{`));
  assert.ok(headMatch, `function ${name} not found in lesson.astro`);
  let i = headMatch.index + headMatch[0].length;
  let depth = 1;
  while (depth > 0 && i < source.length) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') depth -= 1;
    i += 1;
  }
  return source.slice(headMatch.index, i);
}

// Runs the real bookCompleteShadowChunk / bookCurrentChunk / bookPageState /
// _r2lSkipMicSpeakingProgress / _r2lSkipBookReaderChunkForMicGate functions
// (extracted verbatim from lesson.astro) against a fake `state`, with their
// few external calls (playSfx, bookSetStage, celebrateDiamondReward,
// scheduleSaveLessonSession, showToast) stubbed and recorded.
function runBookReaderSkip(state) {
  const fnNames = [
    'bookPageState',
    'bookCurrentChunk',
    'bookCompleteShadowChunk',
    '_r2lSkipMicSpeakingProgress',
    '_r2lSkipBookReaderChunkForMicGate',
  ];
  const extracted = fnNames.map((name) => extractFunctionSource(lessonPage, name)).join('\n\n');
  const calls = { bookSetStage: [], celebrateDiamondReward: [], showToast: [], scheduleSaveLessonSession: 0 };
  const sandbox = {
    state,
    SFX: { levelUp: '/sfx/r2l/voice-xuatsac.mp3' },
    PAGE_DIAMOND_REWARD: 5,
    SPEAKING_ACTIVITY_TYPES: new Set(['listen_and_speak', 'read_aloud']),
    playSfx: () => {},
    bookSetStage: (stage) => calls.bookSetStage.push(stage),
    celebrateDiamondReward: (...args) => calls.celebrateDiamondReward.push(args),
    scheduleSaveLessonSession: () => { calls.scheduleSaveLessonSession += 1; },
    showToast: (msg) => calls.showToast.push(msg),
    _r2lCompleteSpeakActivityOnMicSkip: () => { throw new Error('should not run the activity-flow branch for a book reader'); },
  };
  vm.createContext(sandbox);
  vm.runInContext(extracted, sandbox);
  sandbox._r2lSkipMicSpeakingProgress();
  return calls;
}

function makeSingleChunkBookReaderState() {
  return {
    w1Phase: 'book_reader',
    activityIndex: 0,
    lesson: { activities: [] },
    bookReader: {
      pageIndex: 0,
      chunkIndex: 0,
      pages: [
        {
          page_reads: [
            { read_id: 'read-0', status: 'pending', attempts: 0, technical_failures: 0, score_percent: 0 },
          ],
        },
      ],
    },
  };
}

test('r2l-micgate Fix 1b: clicking the skip button on a stuck book-reader page settles the chunk and advances to "next" (a mic-less child is not trapped)', () => {
  // This exercises the ACTUAL production _r2lSkipMicSpeakingProgress —
  // if the book_reader branch were removed (i.e. line 5571 flipped back to
  // false with no wiring, today's state pre-fix), this call is a no-op:
  // the chunk stays 'pending' and bookSetStage is never called. That is the
  // exact trap this packet exists to close.
  const state = makeSingleChunkBookReaderState();
  const calls = runBookReaderSkip(state);

  const chunk = state.bookReader.pages[0].page_reads[0];
  assert.equal(chunk.status, 'skipped', 'chunk must be settled, not left pending');
  assert.equal(chunk.technical_skip, true, 'settled via the technical-skip path, same as the existing 2-failure flow');
  // r2l-micgate round 2: technical_skip=true alone is NOT enough — Buffet
  // rejected round 1 because technical_failures stays 0 for a mic-less child
  // (that counter only increments inside the recording/upload pipeline the
  // mic gate makes unreachable), which the real validator's
  // `technical_skip && technical_failures >= 2` rule rejects. mic_skip is
  // the new explicit field the validator now also accepts.
  assert.equal(chunk.mic_skip, true, 'mic_skip must be set — technical_skip alone cannot pass the real server validator with technical_failures still 0');
  assert.equal(chunk.technical_failures, 0, 'a mic-less child never reaches the recording pipeline that increments this — it must NOT be faked to 2');
  assert.equal(chunk.score_percent, 0, 'a skipped read earns 0, never a phantom score');
  assert.deepEqual(calls.bookSetStage, ['next'], 'a single-chunk page must land the child on the forward-navigation stage');
  assert.equal(calls.celebrateDiamondReward.length, 0, 'founder-approved trade: 0 diamonds for a mic-skipped page, no ticker/confetti');
  assert.ok(calls.scheduleSaveLessonSession >= 1, 'progress must be persisted so the skip survives a reload');
});

test('r2l-micgate Fix 1b: a multi-chunk page moves to the next pending chunk rather than skipping the whole page', () => {
  const state = makeSingleChunkBookReaderState();
  state.bookReader.pages[0].page_reads.push(
    { read_id: 'read-1', status: 'pending', attempts: 0, technical_failures: 0, score_percent: 0 },
  );
  const calls = runBookReaderSkip(state);

  assert.equal(state.bookReader.pages[0].page_reads[0].status, 'skipped');
  assert.equal(state.bookReader.pages[0].page_reads[1].status, 'pending', 'second chunk untouched by one skip click');
  assert.equal(state.bookReader.chunkIndex, 1, 'chunk pointer advances to the next pending read');
  assert.deepEqual(calls.bookSetStage, ['shadow'], 'stays on the read-aloud stage for the remaining chunk, not forced to "next"');
});

test('r2l-micgate Fix 1b: does not touch a chunk the child already passed with a working mic (idempotent / no bypass of a real attempt)', () => {
  const state = makeSingleChunkBookReaderState();
  state.bookReader.pages[0].page_reads[0].status = 'passed';
  state.bookReader.pages[0].page_reads[0].score_percent = 90;
  const calls = runBookReaderSkip(state);

  assert.equal(state.bookReader.pages[0].page_reads[0].status, 'passed', 'a passed chunk must never be overwritten to skipped');
  assert.equal(state.bookReader.pages[0].page_reads[0].score_percent, 90);
  assert.deepEqual(calls.bookSetStage, [], 'guard returns early — nothing to settle');
});

// ── r2l-micgate Fix 3: "Mở truyện" full-story audio poll fails honestly ──
//
// A fake, non-blocking timer queue: real setTimeout delays would make these
// tests take 12 * 3s (plus a second run for the re-entrancy case), and the
// point of the fix is bounding the ATTEMPT COUNT / not stacking overlapping
// polls, not the literal wall-clock interval — so time is faked out entirely.
function makeFakeTimers() {
  let nextId = 1;
  const canceled = new Set();
  return {
    setTimeout(fn) {
      const id = nextId++;
      Promise.resolve().then(() => {
        if (!canceled.has(id)) fn();
      });
      return id;
    },
    clearTimeout(id) {
      canceled.add(id);
    },
  };
}

function runFullStoryAudioPoll({ safeJsonImpl, fetchImpl }) {
  const extracted = [
    extractFunctionSource(lessonPage, 'setStoryAudioButtonState'),
    extractFunctionSource(lessonPage, 'pollDeferredFullStoryAudio'),
  ].join('\n\n');
  const fetchCalls = [];
  const state = { accessCode: 'R2L-DANNY-JPZ9', packId: 'pack-rainbow', lesson: { story: { full_audio_url: '' } } };
  const window = makeFakeTimers();
  const sandbox = {
    state,
    window,
    AbortController: globalThis.AbortController,
    safeJson: safeJsonImpl,
    fetch: (...args) => {
      fetchCalls.push(args);
      return (fetchImpl || (async () => ({ ok: true })))(...args);
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extracted, sandbox);
  return { sandbox, fetchCalls };
}

test('r2l-micgate Fix 3: exhausts attempts and settles honestly on "Chưa có audio" — never stuck on "Đang tạo audio truyện..." forever', async () => {
  // Every poll comes back ok but with an empty full_audio_url, matching
  // Danny's pack (full.mp3 404s / was never generated).
  const { sandbox, fetchCalls } = runFullStoryAudioPoll({
    safeJsonImpl: async () => ({ ok: true, lesson: { story: { full_audio_url: '' } } }),
  });
  const button = { textContent: '', disabled: false, dataset: {} };
  await sandbox.pollDeferredFullStoryAudio(button);

  assert.equal(fetchCalls.length, 12, 'must stop after maxAttempts, not keep polling indefinitely');
  assert.equal(button.textContent, 'Chưa có audio', 'settles on the honest disabled state, not left reading "Đang tạo..."');
  assert.equal(button.disabled, true);
  assert.equal(button.dataset.audioPolling, 'false', 'guard releases once settled');
});

test('r2l-micgate Fix 3: a second overlapping call does not stack another 12 fetches on the same button (re-entrancy guard)', async () => {
  // Pre-fix, pollDeferredFullStoryAudio had no re-entrancy guard: two
  // concurrent callers on the same button would each independently run the
  // full 12-attempt loop (24 fetches total) — this is the regression this
  // test catches.
  const { sandbox, fetchCalls } = runFullStoryAudioPoll({
    safeJsonImpl: async () => ({ ok: true, lesson: { story: { full_audio_url: '' } } }),
  });
  const button = { textContent: '', disabled: false, dataset: {} };
  await Promise.all([
    sandbox.pollDeferredFullStoryAudio(button),
    sandbox.pollDeferredFullStoryAudio(button),
  ]);

  assert.equal(fetchCalls.length, 12, 'the second overlapping call must short-circuit, not double the polling');
});

test('r2l-micgate Fix 3: stops immediately once the pack reports a real full_audio_url', async () => {
  let attempt = 0;
  const { sandbox, fetchCalls } = runFullStoryAudioPoll({
    safeJsonImpl: async () => {
      attempt += 1;
      return attempt < 3
        ? { ok: true, lesson: { story: { full_audio_url: '' } } }
        : { ok: true, lesson: { story: { full_audio_url: '/books/rainbow/full.mp3' } } };
    },
  });
  const button = { textContent: '', disabled: false, dataset: {} };
  await sandbox.pollDeferredFullStoryAudio(button);

  assert.equal(fetchCalls.length, 3, 'stops polling the moment audio shows up, not all 12 attempts');
  assert.equal(button.textContent, 'Nghe cả truyện');
  assert.equal(button.disabled, false);
  assert.equal(sandbox.state.lesson.story.full_audio_url, '/books/rainbow/full.mp3');
});
