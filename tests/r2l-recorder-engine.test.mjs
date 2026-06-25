import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeStopMonitor } from '../src/lib/r2l-recorder-guards.ts';
import { r2lRecorderScriptSrc } from '../src/scripts/r2l-recorder-script.mjs';

const engine = readFileSync('public/scripts/r2l-recorder.js', 'utf-8');
const versionedRecorderSrc = r2lRecorderScriptSrc();
const micScript = readFileSync('public/scripts/r2l-mic-check.js', 'utf-8');
const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const speakingPage = readFileSync('src/pages/read2lead/speaking.astro', 'utf-8');
const checkApi = readFileSync('functions/api/read2lead-speaking-check.js', 'utf-8');

test('engine exposes the unified recording API', () => {
  assert.match(engine, /global\.R2LRecorder/);
  assert.match(engine, /getStream/);
  assert.match(engine, /startMonitor/);
  assert.match(engine, /createRecorder/);
  assert.match(engine, /watchTrack/);
  assert.match(engine, /saveDevicePref/);
  assert.match(engine, /bumpProfile/);
  assert.match(engine, /useWavEngine/);
  assert.match(engine, /appendTelemetry/);
});

test('engine remembers the tested mic and degrades constraints (Zoom pattern + self-healing)', () => {
  assert.match(engine, /r2l_mic_device_v1/);
  assert.match(engine, /r2l_mic_profile_v1/);
  // Stale remembered device must not break getUserMedia.
  assert.match(engine, /OverconstrainedError/);
  // Ladder ends with all processing off (raw mic).
  assert.match(engine, /noiseSuppression: false/);
});

test('engine monitor keeps an AudioContext OPEN during recording (no prime-then-close)', () => {
  // The Realtek root cause was closing an AudioContext right before recording.
  // The monitor must close it only in stop(), after the recording ends.
  const monitorStart = engine.indexOf('async function startMonitor');
  const monitorEnd = engine.indexOf('/* ---------- mime selection');
  const monitorBody = engine.slice(monitorStart, monitorEnd);
  assert.match(monitorBody, /stop: \(\) => \{/);
  assert.match(monitorBody, /ctx\.close\(\)/);
  // Resume is awaited (iOS peak=0 fix) but raced against a timeout so a
  // forever-pending resume() can never hang the recording flow.
  assert.match(monitorBody, /ctx\.resume\(\)/);
  assert.match(monitorBody, /Promise\.race/);
  // Silence is detected on-device, Meet style.
  assert.match(monitorBody, /onSilenceHint/);
  assert.match(engine, /SILENT_LEVEL/);
  assert.match(engine, /recordingLooksVoiced/);
  assert.match(engine, /TRUST_BLOB_BYTES/);
});

test('engine prefers software opus on Chromium and mp4 only on Safari', () => {
  const idxSafari = engine.indexOf("return ['audio/mp4', 'audio/aac'");
  const idxOthers = engine.indexOf("return ['audio/webm;codecs=opus'");
  assert.ok(idxSafari > -1, 'Safari branch keeps mp4 first');
  assert.ok(idxOthers > -1, 'non-Safari branch prefers webm/opus');
  assert.match(engine, /isSafariFamily/);
});

test('engine ships a raw-PCM WAV fallback that bypasses platform encoders', () => {
  assert.match(engine, /createWavRecorder/);
  assert.match(engine, /createScriptProcessor/);
  assert.match(engine, /RIFF/);
  assert.match(engine, /r2l_rec_engine_v1/);
  // 16kHz mono keeps uploads small on 3G.
  assert.match(engine, /WAV_TARGET_RATE = 16000/);
});

test('lesson and speaking pages load a versioned engine before the mic check script', () => {
  assert.match(versionedRecorderSrc, /^\/scripts\/r2l-recorder\.js\?v=[a-f0-9]{12}$/);
  for (const page of [lessonPage, speakingPage]) {
    assert.doesNotMatch(page, /src="\/scripts\/r2l-recorder\.js"/, 'bare engine URL must not appear');
    assert.match(page, /r2lRecorderScriptSrc/, 'build-time recorder URL helper is used');
    assert.match(page, /src=\{r2lRecorderSrc\}/, 'engine script tag uses hashed src');
    const engineIdx = page.indexOf('r2lRecorderSrc');
    const micIdx = page.indexOf('/scripts/r2l-mic-check.js');
    assert.ok(engineIdx > -1, 'engine script tag present');
    assert.ok(micIdx > engineIdx, 'engine loads before mic-check');
  }
});

test('startMonitor exposes a callable stop on every return path', () => {
  const fnStart = engine.indexOf('async function startMonitor');
  const fnEnd = engine.indexOf('/* ---------- mime selection');
  const body = engine.slice(fnStart, fnEnd);
  const returnBlocks = body.match(/return\s*\{[\s\S]*?\};/g) || [];
  assert.ok(returnBlocks.length >= 3, 'startMonitor has multiple return paths');
  for (const block of returnBlocks) {
    assert.match(block, /stop:\s*\(\)\s*=>/, 'each monitor return exposes stop()');
  }
});

test('safeStopMonitor tolerates monitors without stop (deploy skew guard)', () => {
  assert.doesNotThrow(() => safeStopMonitor({}));
  assert.doesNotThrow(() => safeStopMonitor({ stop: 'not-a-function' }));
  let stopped = false;
  safeStopMonitor({ stop: () => { stopped = true; } });
  assert.equal(stopped, true);
});

test('lesson and speaking inline cleanup uses safeStop guards', () => {
  assert.match(lessonPage, /function _r2lSafeStopMonitor/);
  assert.match(lessonPage, /_r2lSafeStopMonitor\(entry\.monitor\)/);
  assert.doesNotMatch(lessonPage, /entry\.monitor\.stop\(\)/);
  assert.match(speakingPage, /function safeStopMonitor/);
  assert.doesNotMatch(speakingPage, /state\.recording\.monitor\.stop\(\)/);
});

test('lesson detects silent captures on-device and never uploads silence', () => {
  assert.match(lessonPage, /_r2lStartLevelMonitor/);
  assert.match(lessonPage, /recordingLooksVoiced/);
  assert.match(lessonPage, /Micro chưa thu được tiếng/);
  assert.match(lessonPage, /_r2lReportSilentCapture/);
  assert.match(lessonPage, /report_silent/);
});

test('a hopeless mic offers an explicit no-reward completion path after retries', () => {
  assert.match(lessonPage, /_r2lSkipMicSpeakingProgress/);
  assert.match(lessonPage, /data-mic-skip-lesson/);
  assert.match(lessonPage, /Micro chưa thu được tiếng/);
  assert.match(lessonPage, /_r2lCompleteSpeakActivityOnMicSkip/);
  assert.match(lessonPage, /skipped_due_to_mic: true/);
  assert.match(lessonPage, /score_percent: 0/);
  assert.doesNotMatch(lessonPage, /_r2lCompleteSpeakActivityOnEffort/);
  assert.match(lessonPage, /_r2lAsrFailureLooksLikeOutage/);
});

test('lesson auto-switches to the WAV engine when ASR hears nothing despite voice', () => {
  assert.match(lessonPage, /useWavEngine/);
  assert.match(lessonPage, /telemetry\.voiced === true/);
});

test('lesson watches the live track for OS-level mute (another app holding the mic)', () => {
  assert.match(lessonPage, /watchTrack/);
  assert.match(lessonPage, /Micro đang bị app khác giữ/);
});

test('lesson shows a live level meter while recording (Meet pattern)', () => {
  assert.match(lessonPage, /data-rec-meter/);
  assert.match(lessonPage, /r2l-rec-meter-bar/);
});

test('mic check pins the passed device for later recordings', () => {
  assert.match(micScript, /saveDevicePref/);
  assert.match(micScript, /getSettings/);
  // Stream opening delegates to the shared engine when present.
  assert.match(micScript, /R2LRecorder\?\.getStream/);
});

test('the prime-then-close AudioContext pattern is fully gone', () => {
  assert.doesNotMatch(micScript, /async function primeAudioPipeline/);
  assert.doesNotMatch(speakingPage, /primeAudioPipeline\(stream\)/);
});

test('speaking page uses the unified engine with the silent-capture gate', () => {
  assert.match(speakingPage, /R2LRecorder\?\.createRecorder/);
  assert.match(speakingPage, /recordingLooksVoiced/);
  assert.match(speakingPage, /bumpProfile/);
  assert.match(speakingPage, /useWavEngine/);
});

test('monitor resume cannot hang the recording flow on iOS (timeout race + fail-open)', () => {
  // iOS can leave AudioContext.resume() pending forever outside a user gesture.
  // The await must be raced against a timeout, and a still-suspended context
  // must yield an UNAVAILABLE monitor (blob is trusted) — never a hang.
  assert.match(engine, /Promise\.race/);
  assert.match(engine, /ctx\.state !== 'running'/);
});

test('quota and provider 5xx errors count as ASR outage, never "đọc to hơn"', () => {
  assert.match(checkApi, /apiStatus === 429/);
  assert.match(checkApi, /apiStatus >= 500/);
});

test('speaking-check API records capture telemetry and silent reports behind auth', () => {
  assert.match(checkApi, /peak_level/);
  assert.match(checkApi, /device_label/);
  assert.match(checkApi, /rec_engine/);
  assert.match(checkApi, /mic_profile/);
  assert.match(checkApi, /silent_capture/);
  // The silent report must sit AFTER the rate limit and access-code check.
  const rateIdx = checkApi.indexOf('checkCodeRateLimit');
  const codeIdx = checkApi.indexOf('code_not_found');
  const reportIdx = checkApi.indexOf("if (reportSilent) {");
  assert.ok(rateIdx > -1 && codeIdx > rateIdx && reportIdx > codeIdx, 'silent report runs after auth');
});

test('WAV uploads are accepted end-to-end', () => {
  // Client names the file audio.wav; the server filename inference handles wav.
  assert.match(lessonPage, /audio\.wav/);
  assert.match(checkApi, /audio\.wav/);
});
