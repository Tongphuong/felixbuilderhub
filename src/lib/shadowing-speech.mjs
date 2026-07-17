/**
 * Lighting-only SpeechRecognition wrapper for the Shadowing page. Its only
 * job is to feed interim transcript text to shadowing-score.mjs's
 * lightWords() for the live karaoke word-lighting while a kid is recording.
 * It must be impossible for this module to affect scoring or block the
 * flow — GRADING is the server's Whisper endpoint (a separate recording
 * pipeline entirely); this wrapper never scores anything, never rejects a
 * promise, and holds no state the engine reads. Every error is swallowed
 * silently: onEnd always fires, nothing ever throws out of start()/stop(),
 * and there are no retry storms (at most one auto-restart per start() call,
 * only if recognition ends while the caller is still expecting it to run).
 *
 * `win` is always passed in explicitly (never reads a global `window`) so
 * this is trivially testable with a fake SpeechRecognition class.
 */

export function speechSupport(win) {
  const SR = win?.SpeechRecognition || win?.webkitSpeechRecognition;
  return typeof SR === 'function' ? 'native' : 'none';
}

export function createLighter(win) {
  const SR = win?.SpeechRecognition || win?.webkitSpeechRecognition;
  let active = null; // the session object for whichever start() call is current

  function finish(session) {
    if (session.finished) return;
    session.finished = true;
    try { session.onEnd?.(); } catch { /* a page bug in onEnd must never propagate back into the recognizer */ }
  }

  return {
    start({ lang = 'en-US', onInterim, onEnd } = {}) {
      if (typeof SR !== 'function') {
        // No native support at all: call onEnd once, synchronously, and do
        // nothing else — the page falls back to server-only grading.
        try { onEnd?.(); } catch { /* swallow */ }
        return;
      }

      const session = { recognizer: null, manuallyStopped: false, autoRestarted: false, finished: false, onEnd };
      active = session;

      function attempt() {
        let recognizer;
        try {
          recognizer = new SR();
        } catch {
          finish(session);
          return;
        }
        session.recognizer = recognizer;
        try {
          recognizer.lang = lang;
          recognizer.interimResults = true;
          recognizer.continuous = false;
          recognizer.maxAlternatives = 1;

          recognizer.onresult = (event) => {
            try {
              let interim = '';
              for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
                interim += event.results[i]?.[0]?.transcript || '';
              }
              onInterim?.(interim);
            } catch {
              // A bug in the page's onInterim callback (or a malformed
              // event) must never throw back into the recognizer / SR
              // event loop — lighting is cosmetic, never load-bearing.
            }
          };

          // Every error name (no-speech, not-allowed, audio-capture,
          // network, aborted, ...) is swallowed here. Real SpeechRecognition
          // implementations always fire `onend` after `onerror` per the Web
          // Speech API spec, so `onend` — not `onerror` — is the single
          // place that decides "restart once, else finish".
          recognizer.onerror = () => { /* swallowed */ };

          recognizer.onend = () => {
            if (session.finished) return;
            if (!session.manuallyStopped && !session.autoRestarted) {
              session.autoRestarted = true;
              attempt();
              return;
            }
            finish(session);
          };

          recognizer.start();
        } catch {
          finish(session);
        }
      }

      attempt();
    },

    stop() {
      if (!active) return;
      active.manuallyStopped = true;
      try { active.recognizer?.stop(); } catch { /* swallow */ }
    },
  };
}
