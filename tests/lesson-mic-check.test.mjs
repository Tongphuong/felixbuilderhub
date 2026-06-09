import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const micScript = readFileSync('public/scripts/r2l-mic-check.js', 'utf-8');
const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const speakingPage = readFileSync('src/pages/read2lead/speaking.astro', 'utf-8');
const listenSpeak = readFileSync('src/components/read2lead/v2/ListenAndSpeak.astro', 'utf-8');

test('mic check script exposes mount API and OS help', () => {
  assert.match(micScript, /global\.R2LMicCheck/);
  assert.match(micScript, /mount\(root/);
  assert.match(micScript, /isInAppBrowser/);
  assert.match(micScript, /getMicStream/);
  assert.match(micScript, /data-mic-parent-skip/);
  assert.match(micScript, /Windows → Cài đặt → Quyền riêng tư và bảo mật → Microphone/);
  assert.match(micScript, /Mac → Cài đặt hệ thống → Quyền riêng tư và bảo mật → Microphone/);
  assert.match(micScript, /data-mic-meter-bar/);
});

test('lesson page has mic prep banner and shared stream helper', () => {
  assert.match(lessonPage, /mic-prep-banner/);
  assert.match(lessonPage, /_r2lOpenMicStream/);
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
