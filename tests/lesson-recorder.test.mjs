import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');

test('lesson page registers MediaRecorder support detection', () => {
  assert.match(lessonPage, /_r2lMicIsReady/);
  assert.match(lessonPage, /_r2lCreateMediaRecorder/);
  assert.match(lessonPage, /MediaRecorder/);
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

test('mic warmup closes its primed AudioContext (no leak)', () => {
  assert.match(lessonPage, /primedContext/);
  assert.match(lessonPage, /primedContext\.close/);
});

test('recording start gives a clear GO signal for non-reading kids', () => {
  assert.match(lessonPage, /_r2lPlayGoBeep/);
  assert.match(lessonPage, /recording: true/);
  assert.match(lessonPage, /Nói đi con/);
});

test('speaking-check upload is bounded by a timeout', () => {
  assert.match(lessonPage, /AbortController/);
  assert.match(lessonPage, /controller\.abort\(\)/);
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
