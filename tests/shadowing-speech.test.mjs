import test from 'node:test';
import assert from 'node:assert/strict';

import { speechSupport, createLighter } from '../src/lib/shadowing-speech.mjs';

class FakeSpeechRecognition {
  constructor() {
    this.startCalls = 0;
    this.stopCalls = 0;
    this.lang = null;
    this.interimResults = null;
    this.continuous = null;
    this.maxAlternatives = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    FakeSpeechRecognition.instances.push(this);
  }

  start() { this.startCalls += 1; }
  stop() { this.stopCalls += 1; }
}
FakeSpeechRecognition.instances = [];

function resetInstances() {
  FakeSpeechRecognition.instances.length = 0;
}

// ---------------------------------------------------------------------------
// speechSupport
// ---------------------------------------------------------------------------

test('speechSupport: native when SpeechRecognition or webkitSpeechRecognition is a function', () => {
  assert.equal(speechSupport({ SpeechRecognition: function X() {} }), 'native');
  assert.equal(speechSupport({ webkitSpeechRecognition: function X() {} }), 'native');
});

test('speechSupport: none when neither constructor exists (or win is missing)', () => {
  assert.equal(speechSupport({}), 'none');
  assert.equal(speechSupport(undefined), 'none');
  assert.equal(speechSupport({ SpeechRecognition: 'not-a-function' }), 'none');
});

// ---------------------------------------------------------------------------
// interim events flow
// ---------------------------------------------------------------------------

test('createLighter: configures the recognizer for lighting-only use and flows interim events', () => {
  resetInstances();
  const win = { SpeechRecognition: FakeSpeechRecognition };
  const lighter = createLighter(win);
  const interimSeen = [];
  let ended = false;

  lighter.start({ lang: 'en-US', onInterim: (t) => interimSeen.push(t), onEnd: () => { ended = true; } });

  const instance = FakeSpeechRecognition.instances[0];
  assert.equal(instance.lang, 'en-US');
  assert.equal(instance.interimResults, true);
  assert.equal(instance.continuous, false);
  assert.equal(instance.maxAlternatives, 1);
  assert.equal(instance.startCalls, 1);

  instance.onresult({ resultIndex: 0, results: [[{ transcript: 'hello ' }], [{ transcript: 'world' }]] });
  assert.deepEqual(interimSeen, ['hello world']);
  assert.equal(ended, false);
});

test('createLighter: uses webkitSpeechRecognition when SpeechRecognition is absent', () => {
  resetInstances();
  const lighter = createLighter({ webkitSpeechRecognition: FakeSpeechRecognition });
  lighter.start({ onEnd: () => {} });
  assert.equal(FakeSpeechRecognition.instances.length, 1);
});

test('createLighter: a throwing onInterim callback never propagates into the recognizer', () => {
  resetInstances();
  const lighter = createLighter({ SpeechRecognition: FakeSpeechRecognition });
  lighter.start({ onInterim: () => { throw new Error('page bug'); }, onEnd: () => {} });
  const instance = FakeSpeechRecognition.instances[0];
  assert.doesNotThrow(() => instance.onresult({ resultIndex: 0, results: [[{ transcript: 'x' }]] }));
});

// ---------------------------------------------------------------------------
// Error swallowing: every mapped error name -> onEnd fires, nothing throws.
// Real SpeechRecognition implementations fire onerror then onend for the
// same failure (Web Speech API spec) -- the fake mirrors that ordering.
// ---------------------------------------------------------------------------

const ERROR_NAMES = ['no-speech', 'not-allowed', 'audio-capture', 'network', 'aborted'];

for (const name of ERROR_NAMES) {
  test(`createLighter: error "${name}" is swallowed -- onEnd fires (after the one auto-restart), nothing throws`, () => {
    resetInstances();
    const win = { SpeechRecognition: FakeSpeechRecognition };
    const lighter = createLighter(win);
    let ended = false;

    assert.doesNotThrow(() => {
      lighter.start({ onEnd: () => { ended = true; } });
    });

    const first = FakeSpeechRecognition.instances[0];
    assert.doesNotThrow(() => {
      first.onerror({ error: name });
      first.onend();
    });
    // The single auto-restart fires here -- a second instance exists, and
    // onEnd must not have fired yet.
    assert.equal(FakeSpeechRecognition.instances.length, 2, `${name}: expected exactly one auto-restart`);
    assert.equal(ended, false, `${name}: onEnd must not fire before the restart is used up`);

    const second = FakeSpeechRecognition.instances[1];
    assert.doesNotThrow(() => {
      second.onerror({ error: name });
      second.onend();
    });
    assert.equal(ended, true, `${name}: onEnd must fire once the restart is exhausted`);

    // A stray extra onend (or another error) must never restart again or throw.
    assert.doesNotThrow(() => second.onend());
    assert.equal(FakeSpeechRecognition.instances.length, 2, `${name}: no restart storm`);
  });
}

// ---------------------------------------------------------------------------
// Single auto-restart cap (isolated from any specific error name)
// ---------------------------------------------------------------------------

test('at most one auto-restart per start() call', () => {
  resetInstances();
  const lighter = createLighter({ SpeechRecognition: FakeSpeechRecognition });
  let endCount = 0;
  lighter.start({ onEnd: () => { endCount += 1; } });

  FakeSpeechRecognition.instances[0].onend(); // ended early -> auto-restart
  assert.equal(FakeSpeechRecognition.instances.length, 2);
  assert.equal(endCount, 0);

  FakeSpeechRecognition.instances[1].onend(); // restart already used -> finish now
  assert.equal(endCount, 1);

  FakeSpeechRecognition.instances[1].onend(); // stray extra end -> must not double-fire
  assert.equal(endCount, 1);
  assert.equal(FakeSpeechRecognition.instances.length, 2);
});

test('stop() marks the session manually-stopped, suppressing the auto-restart', () => {
  resetInstances();
  const lighter = createLighter({ SpeechRecognition: FakeSpeechRecognition });
  let endCount = 0;
  lighter.start({ onEnd: () => { endCount += 1; } });

  lighter.stop();
  assert.equal(FakeSpeechRecognition.instances[0].stopCalls, 1);

  FakeSpeechRecognition.instances[0].onend(); // native onend following the manual stop
  assert.equal(FakeSpeechRecognition.instances.length, 1, 'no auto-restart after a manual stop');
  assert.equal(endCount, 1);
});

test('stop() before any start() is a safe no-op', () => {
  const lighter = createLighter({ SpeechRecognition: FakeSpeechRecognition });
  assert.doesNotThrow(() => lighter.stop());
});

// ---------------------------------------------------------------------------
// No native support / construction failures
// ---------------------------------------------------------------------------

test('no native support: start() calls onEnd synchronously and does nothing else', () => {
  const lighter = createLighter({});
  let ended = false;
  assert.doesNotThrow(() => lighter.start({ onEnd: () => { ended = true; } }));
  assert.equal(ended, true);
  assert.doesNotThrow(() => lighter.stop());
});

test('a recognizer whose start() throws still calls onEnd, never throws out', () => {
  class ThrowingRecognition {
    start() { throw new Error('boom'); }

    stop() {}
  }
  const lighter = createLighter({ SpeechRecognition: ThrowingRecognition });
  let ended = false;
  assert.doesNotThrow(() => lighter.start({ onEnd: () => { ended = true; } }));
  assert.equal(ended, true);
});

test('a recognizer whose constructor throws still calls onEnd, never throws out', () => {
  class ThrowingConstructor {
    constructor() { throw new Error('cannot construct'); }
  }
  const lighter = createLighter({ SpeechRecognition: ThrowingConstructor });
  let ended = false;
  assert.doesNotThrow(() => lighter.start({ onEnd: () => { ended = true; } }));
  assert.equal(ended, true);
});
