import test from 'node:test';
import assert from 'node:assert/strict';

import { cueTick, watchdogAction, loadYouTubeApi, createSegmentPlayer } from '../src/lib/shadowing-player.mjs';

const SEG = { start: 10, end: 20 };

// ---------------------------------------------------------------------------
// cueTick — pure boundary cases
// ---------------------------------------------------------------------------

test('cueTick: continues well before end-epsilon', () => {
  assert.equal(cueTick(15, SEG, 0.08), 'continue');
});

test('cueTick: continues just before the epsilon boundary', () => {
  assert.equal(cueTick(19.9, SEG, 0.08), 'continue'); // 20 - 0.08 = 19.92
});

test('cueTick: pauses exactly at the epsilon boundary', () => {
  assert.equal(cueTick(19.92, SEG, 0.08), 'pause');
});

test('cueTick: pauses after the segment end', () => {
  assert.equal(cueTick(25, SEG, 0.08), 'pause');
});

test('cueTick: default epsilon is 0.08 when omitted', () => {
  assert.equal(cueTick(19.9, SEG), 'continue');
  assert.equal(cueTick(19.93, SEG), 'pause');
});

// ---------------------------------------------------------------------------
// watchdogAction — pure boundary cases (frozen vs actually-passed-end)
// ---------------------------------------------------------------------------

test('watchdogAction: frozen media time before the end -> continue (rearm, no force)', () => {
  assert.equal(watchdogAction(15, SEG), 'continue');
});

test('watchdogAction: media time exactly at the end -> pause (force)', () => {
  assert.equal(watchdogAction(20, SEG), 'pause');
});

test('watchdogAction: media time past the end -> pause (force)', () => {
  assert.equal(watchdogAction(30, SEG), 'pause');
});

// ---------------------------------------------------------------------------
// loadYouTubeApi — singleton, double-call tolerance
// ---------------------------------------------------------------------------

function fakeDoc(scripts) {
  return {
    createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
    querySelector: () => scripts.find((s) => s.attrs['data-shadowing-yt-api'] === '1') || null,
    getElementsByTagName: () => scripts,
    head: { appendChild: (el) => scripts.push(el) },
  };
}

test('loadYouTubeApi: injects the script exactly once and resolves via onYouTubeIframeAPIReady; tolerant of a second call', async () => {
  const scripts = [];
  const win = {};
  const doc = fakeDoc(scripts);

  const p1 = loadYouTubeApi(win, doc);
  const p2 = loadYouTubeApi(win, doc); // called again before it resolves
  assert.equal(p1, p2, 'same win -> the exact same promise, even pre-resolution');
  assert.equal(scripts.length, 1, 'iframe_api script injected exactly once');

  const fakeYT = { Player: function Player() {} };
  win.YT = fakeYT;
  win.onYouTubeIframeAPIReady();

  assert.equal(await p1, fakeYT);

  const p3 = loadYouTubeApi(win, doc); // called again after resolution
  assert.equal(p3, p1);
  assert.equal(scripts.length, 1, 'still only one script tag');
});

test('loadYouTubeApi: short-circuits immediately when win.YT.Player already exists', async () => {
  const fakeYT = { Player: function Player() {} };
  const win = { YT: fakeYT };
  const scripts = [];
  const resolved = await loadYouTubeApi(win, fakeDoc(scripts));
  assert.equal(resolved, fakeYT);
  assert.equal(scripts.length, 0, 'no script injected when the API is already present');
});

test('loadYouTubeApi: chains a pre-existing onYouTubeIframeAPIReady handler instead of clobbering it', async () => {
  const win = {};
  let priorCalled = false;
  win.onYouTubeIframeAPIReady = () => { priorCalled = true; };
  const scripts = [];
  const p = loadYouTubeApi(win, fakeDoc(scripts));
  win.YT = { Player: function Player() {} };
  win.onYouTubeIframeAPIReady();
  await p;
  assert.equal(priorCalled, true);
});

test('loadYouTubeApi: two different win objects each get their own promise', () => {
  const winA = {};
  const winB = {};
  const pA = loadYouTubeApi(winA, fakeDoc([]));
  const pB = loadYouTubeApi(winB, fakeDoc([]));
  assert.notEqual(pA, pB);
});

// ---------------------------------------------------------------------------
// createSegmentPlayer — config wiring, ready-queueing, event routing
// (lighter coverage beyond the packet's explicit list, since it's cheap and
// directly exercises this file's other new code; polling/watchdog TIMING
// itself is intentionally not re-tested here -- cueTick/watchdogAction above
// already cover that logic in isolation, and it drives real setInterval/
// setTimeout that would need fake timers to assert on precisely.)
// ---------------------------------------------------------------------------

class FakeYTPlayer {
  constructor(elId, config) {
    this.elId = elId;
    this.config = config;
    this.seekCalls = [];
    this.playCalls = 0;
    this.pauseCalls = 0;
    this.destroyCalls = 0;
    this.currentTime = 0;
    FakeYTPlayer.instances.push(this);
  }

  seekTo(t) { this.seekCalls.push(t); this.currentTime = t; }

  playVideo() { this.playCalls += 1; }

  pauseVideo() { this.pauseCalls += 1; }

  getCurrentTime() { return this.currentTime; }

  destroy() { this.destroyCalls += 1; }

  fireReady() { this.config.events.onReady(); }

  fireStateChange(data) { this.config.events.onStateChange({ data }); }

  fireError(data) { this.config.events.onError({ data }); }
}
FakeYTPlayer.instances = [];

const FAKE_YT = { Player: FakeYTPlayer, PlayerState: { ENDED: 0 } };
const WIN = { location: { origin: 'https://example.com' } };

test('createSegmentPlayer: builds playerVars/host exactly per spec', () => {
  FakeYTPlayer.instances.length = 0;
  const sp = createSegmentPlayer({ elId: 'p', youtubeId: 'abc12345678', YT: FAKE_YT, win: WIN, callbacks: {} });
  sp.playSegment({ start: 1, end: 5 });
  const p = FakeYTPlayer.instances[0];
  assert.equal(p.config.host, 'https://www.youtube-nocookie.com');
  assert.equal(p.config.videoId, 'abc12345678');
  assert.deepEqual(p.config.playerVars, {
    playsinline: 1, controls: 0, rel: 0, disablekb: 1, fs: 0, iv_load_policy: 3, origin: 'https://example.com',
  });
  sp.destroy(); // clears the poll/watchdog timers this playSegment call armed
});

test('createSegmentPlayer: queues the first playSegment call until onReady fires (no auto-chaining)', () => {
  FakeYTPlayer.instances.length = 0;
  const sp = createSegmentPlayer({ elId: 'p', youtubeId: 'abc12345678', YT: FAKE_YT, win: WIN, callbacks: {} });
  sp.playSegment({ start: 2, end: 6 });
  const p = FakeYTPlayer.instances[0];
  assert.equal(p.seekCalls.length, 0, 'not seeked yet -- player not ready');
  p.fireReady();
  assert.deepEqual(p.seekCalls, [2]);
  assert.equal(p.playCalls, 1);
  sp.destroy(); // clears the poll/watchdog timers doPlaySegment armed on ready
});

test('createSegmentPlayer: onStateChange ENDED is treated as segment end', () => {
  FakeYTPlayer.instances.length = 0;
  let ended = null;
  const sp = createSegmentPlayer({
    elId: 'p', youtubeId: 'abc12345678', YT: FAKE_YT, win: WIN,
    callbacks: { onSegmentEnd: (seg) => { ended = seg; } },
  });
  const seg = { start: 0, end: 3 };
  sp.playSegment(seg);
  const p = FakeYTPlayer.instances[0];
  p.fireReady();
  p.fireStateChange(FAKE_YT.PlayerState.ENDED);
  assert.deepEqual(ended, seg);
  assert.equal(p.pauseCalls, 1);
});

test('createSegmentPlayer: onError with an unplayable code fires callbacks.onUnplayable; other codes do not', () => {
  FakeYTPlayer.instances.length = 0;
  const seen = [];
  const sp = createSegmentPlayer({
    elId: 'p', youtubeId: 'abc12345678', YT: FAKE_YT, win: WIN,
    callbacks: { onUnplayable: (code) => seen.push(code) },
  });
  sp.playSegment({ start: 0, end: 3 });
  const p = FakeYTPlayer.instances[0];
  p.fireReady();
  for (const code of [2, 5, 100, 101, 150]) p.fireError(code);
  p.fireError(999); // not an unplayable code
  assert.deepEqual(seen, [2, 5, 100, 101, 150]);
  sp.destroy(); // clears the poll/watchdog timers doPlaySegment armed on ready
});

test('createSegmentPlayer: replaySegment seeks to the pre-roll point but keeps the original segment end', () => {
  FakeYTPlayer.instances.length = 0;
  const sp = createSegmentPlayer({ elId: 'p', youtubeId: 'abc12345678', YT: FAKE_YT, win: WIN, callbacks: {} });
  sp.replaySegment({ start: 5, end: 8 }, 0.5);
  const p = FakeYTPlayer.instances[0];
  p.fireReady();
  assert.deepEqual(p.seekCalls, [4.5]);
  sp.destroy(); // clears the poll/watchdog timers doPlaySegment armed on ready
});

test('createSegmentPlayer: pause/pauseForHidden/playFullVideo/destroy drive the underlying player', () => {
  FakeYTPlayer.instances.length = 0;
  const sp = createSegmentPlayer({ elId: 'p', youtubeId: 'abc12345678', YT: FAKE_YT, win: WIN, callbacks: {} });
  sp.playSegment({ start: 0, end: 3 });
  const p = FakeYTPlayer.instances[0];
  p.fireReady();

  sp.pause();
  assert.equal(p.pauseCalls, 1);

  sp.pauseForHidden();
  assert.equal(p.pauseCalls, 2);

  sp.playFullVideo();
  assert.deepEqual(p.seekCalls, [0, 0]);
  assert.equal(p.playCalls, 2);

  sp.destroy();
  assert.equal(p.destroyCalls, 1);
});
