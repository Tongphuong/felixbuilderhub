/**
 * YouTube IFrame API wrapper for the Shadowing page: loads the API once,
 * then drives a single embedded player through one segment at a time.
 * NO auto-chaining — every playSegment/replaySegment call is expected to
 * come from the page inside a user tap; this module never queues up "play
 * the next segment" on its own.
 *
 * `win`/`doc` are always accepted as explicit params (never read off a
 * global) so both the loader and the player are testable with fakes.
 */

const apiPromiseByWin = new WeakMap();

/**
 * Injects https://www.youtube.com/iframe_api at most once per `win` and
 * resolves once the IFrame API calls window.onYouTubeIframeAPIReady.
 * Tolerant of being called twice (returns the same in-flight/resolved
 * promise); short-circuits immediately if win.YT.Player already exists.
 */
export function loadYouTubeApi(win, doc) {
  if (apiPromiseByWin.has(win)) return apiPromiseByWin.get(win);

  const promise = new Promise((resolve) => {
    if (win.YT && win.YT.Player) {
      resolve(win.YT);
      return;
    }
    const previousReady = win.onYouTubeIframeAPIReady;
    win.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === 'function') {
        try { previousReady(); } catch { /* a misbehaving prior handler must not block our resolve */ }
      }
      resolve(win.YT);
    };
    const already = doc.querySelector('script[data-shadowing-yt-api]');
    if (!already) {
      const tag = doc.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.setAttribute('data-shadowing-yt-api', '1');
      const firstScript = doc.getElementsByTagName('script')[0];
      if (firstScript && firstScript.parentNode) {
        firstScript.parentNode.insertBefore(tag, firstScript);
      } else {
        (doc.head || doc.body || doc).appendChild(tag);
      }
    }
  });

  apiPromiseByWin.set(win, promise);
  return promise;
}

const UNPLAYABLE_ERROR_CODES = new Set([2, 5, 100, 101, 150]);

/**
 * Pure — decides whether the 100ms media-time poll should keep going or
 * pause playback because the segment has effectively ended.
 */
export function cueTick(currentTime, segment, epsilon = 0.08) {
  return currentTime >= segment.end - epsilon ? 'pause' : 'continue';
}

/**
 * Pure — re-checked once by the (end-start+6)s watchdog timer. Only forces
 * a segment end if media time actually passed the end (the 100ms poll got
 * stuck, e.g. a throttled background tab); if time is frozen before the
 * end (an ad, a buffering stall), does nothing so the caller can rearm and
 * check again later rather than cutting off a merely-slow video.
 */
export function watchdogAction(currentTime, segment) {
  return currentTime >= segment.end ? 'pause' : 'continue';
}

/**
 * @param {{elId:string, youtubeId:string, YT:object, win?:object, callbacks?:object}} opts
 *   `win` defaults to the global `window` when available; the real
 *   playerVars.origin (below) has no other source, and the packet's
 *   destructure list didn't spell it out — added as the obvious minimal
 *   fill-in its own specced config requires.
 */
export function createSegmentPlayer({ elId, youtubeId, YT, win = (typeof window !== 'undefined' ? window : undefined), callbacks = {} }) {
  let player = null;
  let ready = false;
  let pendingAction = null; // queued play*/replay call that arrived before onReady
  let pollTimer = null;
  let watchdogTimer = null;
  let currentSegment = null;
  let destroyed = false;

  function clearPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }
  function clearWatchdog() {
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  }

  function endSegment(segment) {
    clearPoll();
    clearWatchdog();
    try { player.pauseVideo(); } catch { /* best-effort */ }
    callbacks.onSegmentEnd?.(segment);
  }

  function armWatchdog(segment) {
    clearWatchdog();
    const ms = Math.max(0, (segment.end - segment.start + 6)) * 1000;
    watchdogTimer = setTimeout(() => {
      const t = typeof player?.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
      if (watchdogAction(t, segment) === 'pause') {
        endSegment(segment);
      } else {
        armWatchdog(segment); // frozen (ad/buffer) -- rearm, check again later
      }
    }, ms);
  }

  function startPoll(segment) {
    clearPoll();
    pollTimer = setInterval(() => {
      const t = typeof player?.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
      if (cueTick(t, segment) === 'pause') endSegment(segment);
    }, 100);
  }

  function doPlaySegment(segment) {
    currentSegment = segment;
    try {
      player.seekTo(segment.start, true);
      player.playVideo();
    } catch { /* best-effort */ }
    startPoll(segment);
    armWatchdog(segment);
  }

  function doPlayFullVideo() {
    currentSegment = null;
    clearPoll();
    clearWatchdog();
    try {
      player.seekTo(0, true);
      player.playVideo();
    } catch { /* best-effort */ }
  }

  function runOrQueue(action) {
    if (destroyed) return;
    if (ready) {
      action();
    } else {
      pendingAction = action; // only the LAST call before ready wins, matching "no auto-chaining"
    }
  }

  function ensurePlayer() {
    if (player || destroyed) return;
    player = new YT.Player(elId, {
      host: 'https://www.youtube-nocookie.com',
      videoId: youtubeId,
      playerVars: {
        playsinline: 1,
        controls: 0,
        rel: 0,
        disablekb: 1,
        fs: 0,
        iv_load_policy: 3,
        origin: win?.location?.origin,
      },
      events: {
        onReady: () => {
          ready = true;
          if (pendingAction) {
            const action = pendingAction;
            pendingAction = null;
            action();
          }
        },
        onStateChange: (e) => {
          const ENDED = YT?.PlayerState?.ENDED ?? 0;
          if (e?.data === ENDED && currentSegment) endSegment(currentSegment);
        },
        onError: (e) => {
          if (UNPLAYABLE_ERROR_CODES.has(e?.data)) callbacks.onUnplayable?.(e.data);
        },
      },
    });
  }

  return {
    playSegment(seg) {
      ensurePlayer();
      runOrQueue(() => doPlaySegment(seg));
    },
    replaySegment(seg, preRollS = 0.2) {
      ensurePlayer();
      const start = Math.max(0, seg.start - preRollS);
      // Only the seek-in point moves; cueTick/watchdog end-detection still
      // key off the ORIGINAL seg.end via this same segment object.
      runOrQueue(() => doPlaySegment({ ...seg, start }));
    },
    pause() {
      clearPoll();
      clearWatchdog();
      try { player?.pauseVideo(); } catch { /* best-effort */ }
    },
    pauseForHidden() {
      // Same behavior as pause(); kept as a distinctly-named export so the
      // page's visibilitychange listener has a self-documenting call site.
      this.pause();
    },
    playFullVideo() {
      ensurePlayer();
      runOrQueue(doPlayFullVideo);
    },
    destroy() {
      destroyed = true;
      clearPoll();
      clearWatchdog();
      try { player?.destroy(); } catch { /* best-effort */ }
      player = null;
    },
  };
}
