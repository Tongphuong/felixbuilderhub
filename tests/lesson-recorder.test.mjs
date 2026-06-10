import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');

test('lesson page registers MediaRecorder support detection', () => {
  assert.match(lessonPage, /_r2lMicIsReady/);
  assert.match(lessonPage, /_r2lCreateMediaRecorder/);
  assert.match(lessonPage, /MediaRecorder/);
});

test('speaking activity completes on effort, not on Whisper success (no deadlock)', () => {
  // listen_and_speak completes when every sentence was RECORDED, regardless of ASR.
  assert.match(lessonPage, /attemptedItems/);
  assert.match(lessonPage, /attemptedItems >= itemKeys\.length/);
  assert.doesNotMatch(lessonPage, /scoredItems >= itemKeys\.length/);
  // retell has an effort-complete path too.
  assert.match(lessonPage, /_r2lCompleteRetellOnEffort/);
});

test('mic warmup no longer creates/closes an AudioContext (Realtek silence root cause)', () => {
  // Fix C: the warmup must not prime+close an AudioContext on the recording stream.
  const warmupStart = lessonPage.indexOf('async function _r2lRunMicWarmup');
  const warmupEnd = lessonPage.indexOf('function _r2lFocusMicHelp');
  const warmupBody = lessonPage.slice(warmupStart, warmupEnd);
  assert.doesNotMatch(warmupBody, /primeAudioPipeline/);
});

test('lesson page handles permission denial gracefully', () => {
  assert.match(lessonPage, /micPermissionBlocked/);
  assert.match(lessonPage, /Vui lòng cấp quyền micro/);
  assert.match(lessonPage, /Thử thu lại/);
});

test('lesson page implements record / stop / play / redo actions', () => {
  for (const action of ['start', 'stop', 'play', 'redo']) {
    assert.match(lessonPage, new RegExp(`action === '${action}'`));
  }
});

test('lesson page cleans up blob URLs on activity exit', () => {
  assert.match(lessonPage, /URL\.revokeObjectURL/);
  assert.match(lessonPage, /_r2lRecorderState\.perItem\.clear\(\)/);
});

test('lesson page gates speak recording behind mic check', () => {
  assert.match(lessonPage, /_r2lMicGateReady/);
  assert.match(lessonPage, /Kiểm tra micro/);
  assert.match(lessonPage, /r2l-mic-gate/);
  assert.match(lessonPage, /_r2lOpenMicStream/);
});

test('lesson page mounts Minny speak controls per sentence', () => {
  assert.match(lessonPage, /data-speak-record/);
  assert.match(lessonPage, /data-speak-card="\$\{itemIndex\}"/);
  assert.match(lessonPage, /data-speak-feedback/);
  assert.match(lessonPage, /words_exact/);
  assert.match(lessonPage, /_r2lSyncMinnyRecordButton/);
  assert.match(lessonPage, /current\.blob !== scoringBlob/);
});

test('listen_and_speak recorder submits Whisper scoring after stop', () => {
  assert.match(lessonPage, /_r2lScoreSpeakRecording/);
  assert.match(lessonPage, /read2lead-speaking-check/);
  assert.match(lessonPage, /item\.text_en/);
  assert.match(lessonPage, /Minny đang nghe và nhận xét bài đọc của con/);
});

test('recorder rejects header-only blobs instead of sending silence to Groq', () => {
  // A too-short / header-only recording must be caught locally with a clear
  // "speak longer" message, never uploaded (which returns the scary "không nghe được").
  assert.match(lessonPage, /_R2L_MIN_SPEECH_BYTES/);
  assert.match(lessonPage, /blob\.size < _R2L_MIN_SPEECH_BYTES/);
});

// (Removed: "mic warmup closes its primed AudioContext" — the priming itself was
//  removed in the Realtek-silence root-cause fix; see the no-AudioContext test above.)

test('recording start gives a clear GO signal for non-reading kids', () => {
  assert.match(lessonPage, /_r2lPlayGoBeep/);
  assert.match(lessonPage, /recording: true/);
  assert.match(lessonPage, /Nói đi con/);
});

test('speaking-check upload is bounded by a timeout', () => {
  assert.match(lessonPage, /AbortController/);
  assert.match(lessonPage, /controller\.abort\(\)/);
});

test('recording shows a big countdown popup that flips to GO at capture start', () => {
  assert.match(lessonPage, /r2l-mic-countdown/);
  assert.match(lessonPage, /function _r2lRunCountdownOverlay/);
  assert.match(lessonPage, /function _r2lCountdownGo/);
  assert.match(lessonPage, /NÓI ĐI CON/);
  // GO must fire AFTER recording starts so a kid who speaks instantly is captured.
  const startIdx = lessonPage.indexOf('mr.start(250)');
  const goIdx = lessonPage.indexOf('_r2lCountdownGo();', startIdx);
  assert.ok(startIdx > -1 && goIdx > startIdx, 'countdown GO should run after mr.start(250)');
});

test('MCQ renderer does not reference speak activity itemIndex', () => {
  const mcqStart = lessonPage.indexOf('function renderMcqActivity');
  const orderStart = lessonPage.indexOf('function renderOrderActivity');
  const mcqRenderer = lessonPage.slice(mcqStart, orderStart);

  assert.ok(mcqStart > -1, 'renderMcqActivity should exist');
  assert.ok(orderStart > mcqStart, 'renderOrderActivity should appear after renderMcqActivity');
  assert.doesNotMatch(mcqRenderer, /itemIndex/);
  assert.doesNotMatch(mcqRenderer, /data-speak-card/);
});
