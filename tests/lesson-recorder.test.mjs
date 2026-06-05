import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');

test('lesson page registers MediaRecorder support detection', () => {
  assert.match(lessonPage, /_r2lSupportsRecording/);
  assert.match(lessonPage, /MediaRecorder/);
});

test('lesson page handles permission denial gracefully', () => {
  assert.match(lessonPage, /micPermissionDenied/);
  assert.match(lessonPage, /Vui lòng cấp quyền micro/);
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

test('lesson page mounts a recorder slot per item', () => {
  assert.match(lessonPage, /data-recorder-slot/);
  assert.match(lessonPage, /data-speak-card="\$\{itemIndex\}"/);
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
