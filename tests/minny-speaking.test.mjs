import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildSpeakingModes,
  buildHomeworkSteps,
} from '../functions/api/minny-speaking-context.js';
import { canAccessPackForPractice } from '../functions/api/_read2lead-pack-access.js';

const speakingPage = readFileSync('src/pages/speak-up.astro', 'utf-8');
const parentPortal = readFileSync('src/pages/ho-so/index.astro', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so.ts', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so-parent-view.ts', 'utf-8');

test('speak-up app page exists with coaching-first copy and no AI marketing', () => {
  assert.match(speakingPage, /SpeakUp/);
  assert.match(speakingPage, /minny-speaking-context/);
  assert.match(speakingPage, /read2lead-speaking-check/);
  assert.match(speakingPage, /practice_mode/);
  assert.match(speakingPage, /data\.modes/);
  assert.doesNotMatch(speakingPage, /tăng cường bởi AI/i);
  assert.doesNotMatch(speakingPage, /\bAI\b/);
});

test('speak-up page has kid-friendly mode cards and video fallback', () => {
  assert.match(speakingPage, /spk-mode-card/);
  assert.match(speakingPage, /mode-picker/);
  assert.match(speakingPage, /practice-screen/);
  assert.match(speakingPage, /no-homework-note/);
  assert.match(speakingPage, /id="minny-video"/);
  assert.match(speakingPage, /id="minny-fallback"/);
  assert.match(speakingPage, /tryPlay\('mp4'\)/);
  assert.match(speakingPage, /\.webm/);
  assert.match(speakingPage, /showMinnyPng/);
  assert.match(speakingPage, /back-to-modes/);
  assert.match(speakingPage, /progress-dots/);
});

test('speak-up page carries no Read2Lead activity (products share codes, not activities)', () => {
  assert.doesNotMatch(speakingPage, /Kể lại truyện/);
  assert.doesNotMatch(speakingPage, /Minny hỏi — con trả lời/);
});

test('speak-up page wires hands-free turn-taking with escape hatch and safety rails', () => {
  // Silence-pause auto-send + auto re-arm (Stage A). The VAD polls the
  // conversation monitor's voicedMs() — no change to r2l-recorder.js.
  assert.ok(speakingPage.includes('FT_VAD_PAUSE_MS'), 'VAD pause constant present');
  assert.ok(speakingPage.includes('FT_VAD_MIN_VOICED_MS'), 'min-voiced guard present');
  assert.ok(speakingPage.includes('FT_VAD_MAX_WAIT_MS'), 'silent auto-arm timeout present');
  assert.ok(speakingPage.includes("localStorage.getItem('r2l_ft_handsfree')"), 'hands-free escape hatch present');
  assert.ok(speakingPage.includes('ftMaybeAutoArm'), 'auto re-arm after Minny speaks');
  assert.ok(speakingPage.includes('ftStartVad(session, monitor, finishRecording'), 'VAD armed on recording start');
  // Auto re-arm must stay behind the gesture-created monitor and a live tab.
  assert.ok(speakingPage.includes('ft.micMonitor?.available'), 'auto-arm requires the gesture-created monitor');
  assert.ok(speakingPage.includes('ftCancelAutoArm();'), 'hidden tab cancels pending auto-arm');
});

test('speak-up page plays thinking filler and records turn latency', () => {
  assert.ok(speakingPage.includes("['thinking_1', 'thinking_2']"), 'prefetches both filler phrases');
  assert.ok(speakingPage.includes('FT_FILLER_DELAY_MS'), 'filler waits for a genuinely slow reply');
  assert.ok(speakingPage.includes('latency_p50_ms'), 'session summary carries latency p50');
  assert.ok(speakingPage.includes('stt_ms'), 'per-turn timing split captured');
});

test('unified profile renders parent view with portfolio and dashboard', () => {
  assert.match(parentPortal, /renderParentView/);
  assert.match(parentPortal, /renderAll/);
});

test('practice mode allows general pack without story history', () => {
  assert.equal(canAccessPackForPractice({ progress: {} }, 'general'), true);
});

test('buildHomeworkSteps returns null when no homework', () => {
  assert.equal(buildHomeworkSteps({}), null);
  assert.equal(buildHomeworkSteps({ homework: null }), null);
});

test('buildHomeworkSteps creates sentence steps and optional frame step', () => {
  const codeData = {
    homework: {
      schema_version: 1,
      updated_at: '2026-07-01T08:00:00.000Z',
      note_vi: 'Luyện phát âm',
      sentences: [
        { id: 's1', text_en: 'I like apples.', hint_vi: null },
        { id: 's2', text_en: 'She runs fast.', hint_vi: null },
      ],
      frame: {
        stems: [
          { id: 'f1', text_en: 'Last summer, I went to ___.', anchor_words: ['last','summer','i','went','to'] },
          { id: 'f2', text_en: 'I saw ___.', anchor_words: ['i','saw'] },
        ],
        duration_s: 45,
      },
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.ok(mode);
  assert.equal(mode.id, 'homework');
  assert.equal(mode.title_vi, 'Bài tập thầy giao');
  assert.match(mode.subtitle_vi, /Thầy Phương nhắn: Luyện phát âm/);
  assert.equal(mode.homework_note_vi, 'Luyện phát âm');
  assert.equal(mode.homework_updated_at, '2026-07-01T08:00:00.000Z');
  assert.equal(mode.steps.length, 3);
  assert.equal(mode.steps[0].id, 'hw_s1');
  assert.equal(mode.steps[0].kind, 'homework');
  assert.equal(mode.steps[0].task_type, 'read');
  assert.equal(mode.steps[0].check_mode, 'read');
  assert.equal(mode.steps[0].prompt_en, 'I like apples.');
  assert.equal(mode.steps[1].id, 'hw_s2');
  assert.equal(mode.steps[2].id, 'hw_frame');
  assert.equal(mode.steps[2].kind, 'speech');
  assert.equal(mode.steps[2].task_type, 'present');
  assert.equal(mode.steps[2].check_mode, 'frame');
  assert.equal(mode.steps[2].max_seconds, 60); // 45 + 15
  assert.deepEqual(mode.steps[2].stems, codeData.homework.frame.stems);
});

// ---------------------------------------------------------------------------
// THE HARD GATE (contract §0.3, §2, §3): the pilot is LIVE with 20 kids on
// schema v2 in KV. A v2 record must compile to byte-identical steps before
// and after the v3 change, except the additive task_type field. These
// fixtures are frozen "before" snapshots (the exact step shape produced by
// the pre-v3 buildHomeworkSteps) — do NOT "fix" a fixture to make a test
// pass; a fixture mismatch here means a live kid's grading changed.
// ---------------------------------------------------------------------------

test('HARD GATE: v2 sentences+frame record compiles byte-identical to today, plus task_type', () => {
  const codeData = {
    homework: {
      schema_version: 2,
      updated_at: '2026-06-20T08:00:00.000Z',
      note_vi: 'Luyện phát âm',
      sentences: [
        { id: 's1', text_en: 'I like apples.', hint_vi: null },
        { id: 's2', text_en: 'She runs fast.', hint_vi: null },
      ],
      frame: {
        stems: [
          { id: 'f1', text_en: 'Last summer, I went to ___.', anchor_words: ['last', 'summer', 'i', 'went', 'to'] },
        ],
        duration_s: 45,
      },
      photo: null,
      photo_talk: null,
      history: [],
    },
  };

  const BEFORE_STEPS = [
    {
      id: 'hw_s1',
      kind: 'homework',
      prompt_vi: 'Con đọc câu này cho Minny nghe nhé',
      prompt_en: 'I like apples.',
      expected_text: 'I like apples.',
      check_mode: 'read',
      max_seconds: 30,
    },
    {
      id: 'hw_s2',
      kind: 'homework',
      prompt_vi: 'Con đọc câu này cho Minny nghe nhé',
      prompt_en: 'She runs fast.',
      expected_text: 'She runs fast.',
      check_mode: 'read',
      max_seconds: 30,
    },
    {
      id: 'hw_frame',
      kind: 'speech',
      check_mode: 'frame',
      prompt_vi: 'Con thuyết trình theo khung nhé — nói một mạch!',
      stems: codeData.homework.frame.stems,
      max_seconds: 60,
    },
  ];

  const mode = buildHomeworkSteps(codeData);
  const afterStepsWithoutTaskType = mode.steps.map(({ task_type, ...rest }) => rest);
  assert.deepEqual(afterStepsWithoutTaskType, BEFORE_STEPS, 'steps must be byte-identical to today modulo task_type');
  assert.deepEqual(mode.steps.map((s) => s.task_type), ['read', 'read', 'present']);
});

test('HARD GATE: v2 photo-only record (old photo_talk) still compiles to the LEGACY open/photo_talk step, byte-identical', () => {
  const codeData = {
    homework: {
      schema_version: 2,
      updated_at: '2026-06-21T09:00:00.000Z',
      note_vi: '',
      sentences: [],
      frame: null,
      photo: { id: 'hp_abc123def456', r2_key: 'homework/class1/hp_abc123def456.jpg', content_type: 'image/jpeg', size: 9 },
      photo_talk: { duration_s: 90 },
      history: [],
    },
  };

  const BEFORE_STEPS = [
    {
      id: 'hw_photo_talk',
      kind: 'speech',
      check_mode: 'open',
      expected_text: 'photo_talk',
      prompt_vi: 'Con xem ảnh bài tập rồi thuyết trình theo ảnh nhé — nói một mạch!',
      max_seconds: 105,
    },
  ];

  const mode = buildHomeworkSteps(codeData);
  const afterStepsWithoutTaskType = mode.steps.map(({ task_type, ...rest }) => rest);
  assert.deepEqual(afterStepsWithoutTaskType, BEFORE_STEPS);
  assert.equal(mode.steps[0].task_type, 'picture');
  // Confirm it's the LEGACY (open) path, not the new coverage-scored frame
  // path -- this is the ONE intentional behaviour carve-out (contract §3):
  // a picture task with zero anchors must never silently change grading.
  assert.equal(mode.steps[0].check_mode, 'open');
});

test('HARD GATE: v1 record (no photo field at all) still upgrades and compiles byte-identical, plus task_type', () => {
  const codeData = {
    homework: {
      schema_version: 1,
      updated_at: '2026-06-01T08:00:00.000Z',
      note_vi: '',
      sentences: [{ id: 's1', text_en: 'Hello world.', hint_vi: null }],
      frame: null,
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.equal(mode.photo, null);
  assert.deepEqual(mode.steps, [{
    id: 'hw_s1',
    kind: 'homework',
    task_type: 'read',
    prompt_vi: 'Con đọc câu này cho Minny nghe nhé',
    prompt_en: 'Hello world.',
    expected_text: 'Hello world.',
    check_mode: 'read',
    max_seconds: 30,
  }]);
});

test('buildHomeworkSteps frame-only (no sentences)', () => {
  const codeData = {
    homework: {
      updated_at: '2026-07-02T10:00:00.000Z',
      sentences: [],
      frame: {
        stems: [{ id: 'f1', text_en: 'My trip', anchor_words: ['my','trip'] }],
        duration_s: 30,
      },
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.ok(mode);
  assert.equal(mode.steps.length, 1);
  assert.equal(mode.steps[0].id, 'hw_frame');
  assert.equal(mode.steps[0].max_seconds, 45);
});

test('buildHomeworkSteps sentences-only (no frame)', () => {
  const codeData = {
    homework: {
      updated_at: '2026-07-03T12:00:00.000Z',
      sentences: [{ id: 's1', text_en: 'Hello world.', hint_vi: null }],
      frame: null,
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.ok(mode);
  assert.equal(mode.steps.length, 1);
  assert.equal(mode.steps[0].id, 'hw_s1');
  assert.equal(mode.steps[0].check_mode, 'read');
});

test('buildSpeakingModes: homework first, then free_talk, when homework present', () => {
  const codeData = {
    homework: {
      updated_at: '2026-07-04T09:00:00.000Z',
      sentences: [{ id: 's1', text_en: 'Test.', hint_vi: null }],
    },
  };
  const modes = buildSpeakingModes(codeData);
  assert.equal(modes.length, 2);
  assert.equal(modes[0].id, 'homework');
  assert.equal(modes[1].id, 'free_talk');
  assert.equal(modes[1].steps.length, 0);
});

test('buildSpeakingModes: free_talk only, when no homework', () => {
  const modes = buildSpeakingModes({});
  assert.equal(modes.length, 1);
  assert.equal(modes[0].id, 'free_talk');
});

test('buildSpeakingModes: free_talk for every code, regardless of is_test (Phase 8b)', () => {
  for (const codeData of [{ is_test: true }, { is_test: false }, {}, undefined]) {
    const modes = buildSpeakingModes(codeData);
    assert.ok(modes.some((m) => m.id === 'free_talk'), `free_talk missing for ${JSON.stringify(codeData)}`);
  }
});

test('buildSpeakingModes: no Read2Lead activity modes ever (product separation)', () => {
  const modes = buildSpeakingModes({ is_test: true });
  assert.ok(!modes.some((m) => m.id === 'retell' || m.id === 'questions'));
});

test('buildHomeworkSteps: v1 record (no photo field) yields photo:null and unchanged steps', () => {
  const codeData = {
    homework: {
      schema_version: 1,
      note_vi: '',
      sentences: [{ id: 's1', text_en: 'I like cats.', hint_vi: null }],
      frame: { stems: [{ id: 'f1', text_en: 'I went to ___.', anchor_words: ['i', 'went', 'to'] }], duration_s: 60 },
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.equal(mode.photo, null);
  assert.equal(mode.steps.length, 2);
  assert.equal(mode.steps[0].id, 'hw_s1');
  assert.equal(mode.steps[0].check_mode, 'read');
  assert.equal(mode.steps[1].id, 'hw_frame');
  assert.equal(mode.steps[1].check_mode, 'frame');
});

test('buildHomeworkSteps: v2 record with photo exposes only the photo id', () => {
  const codeData = {
    homework: {
      schema_version: 2,
      note_vi: '',
      sentences: [{ id: 's1', text_en: 'I like cats.', hint_vi: null }],
      frame: null,
      photo: { id: 'hp_abc123def456', r2_key: 'homework/class1/hp_abc123def456.jpg', content_type: 'image/jpeg', size: 250000 },
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.deepEqual(mode.photo, { id: 'hp_abc123def456' });
  assert.equal(JSON.stringify(mode).includes('r2_key'), false, 'r2_key must never reach the client');
});

test('speak-up page has the homework photo thumb, lightbox, and authorized endpoint URL', () => {
  assert.ok(speakingPage.includes('hw-photo-thumb-btn'), 'photo thumb button in story card');
  assert.ok(speakingPage.includes('hw-photo-lightbox'), 'lightbox dialog present');
  assert.ok(speakingPage.includes('/api/speakup-homework-photo?code='), 'photo fetched through the code-authorized endpoint');
  assert.ok(speakingPage.includes('spk-mode-card__badge'), 'mode card attachment badge');
});

test('buildHomeworkSteps: photo-only record yields one open photo-talk step', () => {
  const codeData = {
    homework: {
      schema_version: 2,
      note_vi: '',
      sentences: [],
      frame: null,
      photo: { id: 'hp_abc123def456', r2_key: 'homework/class1/hp_abc123def456.jpg', content_type: 'image/jpeg', size: 9 },
      photo_talk: { duration_s: 90 },
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.equal(mode.steps.length, 1);
  assert.equal(mode.steps[0].id, 'hw_photo_talk');
  assert.equal(mode.steps[0].check_mode, 'open');
  assert.equal(mode.steps[0].expected_text, 'photo_talk');
  assert.equal(mode.steps[0].max_seconds, 105);
  assert.deepEqual(mode.photo, { id: 'hp_abc123def456' });
});

// ---------------------------------------------------------------------------
// Schema v3 native tasks — story / build / picture-with-anchors / qa.
// ---------------------------------------------------------------------------

test('buildHomeworkSteps(story): compiles to a frame step with must_use shown, show_photo from use_photo', () => {
  const codeData = {
    homework: {
      schema_version: 3,
      note_vi: '',
      photo: null,
      tasks: [{
        id: 't1',
        type: 'story',
        prompt_en: 'Tell the story of your best friend.',
        prompt_vi: 'Con kể câu chuyện về người bạn thân nhé.',
        must_use: ['because', 'friend', 'happy'],
        duration_s: 90,
        use_photo: true,
      }],
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.equal(mode.steps.length, 1);
  const step = mode.steps[0];
  assert.equal(step.id, 'hw_t1');
  assert.equal(step.kind, 'speech');
  assert.equal(step.task_type, 'story');
  assert.equal(step.check_mode, 'frame');
  assert.equal(step.prompt_vi, 'Con kể câu chuyện về người bạn thân nhé.');
  assert.equal(step.prompt_en, 'Tell the story of your best friend.');
  assert.deepEqual(step.must_use, ['because', 'friend', 'happy']);
  assert.deepEqual(step.stems, [{ id: 'story', text_en: 'Tell the story of your best friend.', anchor_words: ['because', 'friend', 'happy'] }]);
  assert.equal(step.show_photo, true);
  assert.equal(step.max_seconds, 105); // 90 + 15
});

test('buildHomeworkSteps(picture, with anchors): coverage-scored frame step; anchors never appear outside stems[].anchor_words', () => {
  const codeData = {
    homework: {
      schema_version: 3,
      note_vi: '',
      photo: { id: 'hp_abc123def456', r2_key: 'homework/class1/hp_abc123def456.jpg', content_type: 'image/jpeg', size: 9 },
      tasks: [{ id: 't5', type: 'picture', anchors: ['dog', 'park', 'ball', 'tree'], duration_s: 60 }],
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.equal(mode.steps.length, 1);
  const step = mode.steps[0];
  assert.equal(step.id, 'hw_t5');
  assert.equal(step.task_type, 'picture');
  assert.equal(step.check_mode, 'frame');
  assert.equal(step.show_photo, true);
  assert.deepEqual(step.stems, [{ id: 'picture', text_en: '', anchor_words: ['dog', 'park', 'ball', 'tree'] }]);
  assert.equal(step.max_seconds, 75); // 60 + 15
  // anchors must never appear as a top-level, directly-named field on the step.
  assert.equal(Object.prototype.hasOwnProperty.call(step, 'anchors'), false);
});

test('buildHomeworkSteps(build): one step per required sentence; no server-side expected_text; columns passed through', () => {
  const columns = [
    { id: 'c1', label_en: 'We…', options: ['play football', 'draw pictures', 'eat snacks'] },
    { id: 'c2', label_en: 'At…', options: ['school', 'the park', 'my house'] },
  ];
  const codeData = {
    homework: {
      schema_version: 3,
      note_vi: '',
      photo: null,
      tasks: [{ id: 't4', type: 'build', columns, sentences_required: 3 }],
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.equal(mode.steps.length, 3);
  assert.deepEqual(mode.steps.map((s) => s.id), ['hw_t4_1', 'hw_t4_2', 'hw_t4_3']);
  for (const step of mode.steps) {
    assert.equal(step.kind, 'build');
    assert.equal(step.task_type, 'build');
    assert.equal(step.check_mode, 'read');
    assert.deepEqual(step.columns, columns);
    assert.equal(step.max_seconds, 30);
    assert.equal('expected_text' in step, false, 'server never assembles expected_text for build steps');
  }
});

test('buildHomeworkSteps(qa): one step per card, using the card stem as the frame', () => {
  const codeData = {
    homework: {
      schema_version: 3,
      note_vi: '',
      photo: null,
      tasks: [{
        id: 't6',
        type: 'qa',
        cards: [{ id: 'q1', question_en: 'Is your friend funny?', stem: { text_en: 'Yes, my friend is ___ because ___.', anchor_words: ['yes', 'my', 'friend', 'is', 'because'] } }],
        duration_s: 30,
      }],
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.equal(mode.steps.length, 1);
  const step = mode.steps[0];
  assert.equal(step.id, 'hw_q1');
  assert.equal(step.task_type, 'qa');
  assert.equal(step.check_mode, 'frame');
  assert.equal(step.prompt_en, 'Is your friend funny?');
  assert.deepEqual(step.stems, [{ text_en: 'Yes, my friend is ___ because ___.', anchor_words: ['yes', 'my', 'friend', 'is', 'because'] }]);
  assert.equal(step.max_seconds, 45); // 30 + 15
});

test('buildHomeworkSteps: a v3 record with empty tasks[] but a bound photo still gets a legacy speaking step (safety net)', () => {
  const codeData = {
    homework: {
      schema_version: 3,
      note_vi: '',
      photo: { id: 'hp_abc123def456', r2_key: 'homework/class1/hp_abc123def456.jpg', content_type: 'image/jpeg', size: 9 },
      tasks: [],
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.equal(mode.steps.length, 1);
  assert.equal(mode.steps[0].id, 'hw_photo_talk');
  assert.equal(mode.steps[0].check_mode, 'open');
});

test('buildHomeworkSteps: every emitted step carries a task_type field', () => {
  const codeData = {
    homework: {
      schema_version: 3,
      note_vi: '',
      photo: { id: 'hp_abc123def456', r2_key: 'homework/class1/hp_abc123def456.jpg', content_type: 'image/jpeg', size: 9 },
      tasks: [
        { id: 't1', type: 'read', items: [{ id: 's1', text_en: 'Hi.' }] },
        { id: 't2', type: 'present', stems: [{ id: 'f1', text_en: 'I like ___.', anchor_words: ['i', 'like'] }], duration_s: 60 },
        { id: 't5', type: 'picture', anchors: ['dog'], duration_s: 60 },
      ],
      history: [],
    },
  };
  const mode = buildHomeworkSteps(codeData);
  assert.ok(mode.steps.length > 0);
  assert.ok(mode.steps.every((s) => typeof s.task_type === 'string' && s.task_type.length > 0));
});

// ---------------------------------------------------------------------------
// Zero LLM on the kid path (contract §0.2) — the compiler and the
// minny-speaking-context GET endpoint never fetch.
// ---------------------------------------------------------------------------

test('kid path: buildHomeworkSteps/buildSpeakingModes never call fetch, for any task type', () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = () => { fetchCalled = true; throw new Error('fetch must never be called on the kid path'); };
  try {
    const codeData = {
      homework: {
        schema_version: 3,
        note_vi: '',
        photo: { id: 'hp_abc123def456', r2_key: 'homework/class1/hp_abc123def456.jpg', content_type: 'image/jpeg', size: 9 },
        tasks: [
          { id: 't1', type: 'read', items: [{ id: 's1', text_en: 'Hi.' }] },
          { id: 't2', type: 'present', stems: [{ id: 'f1', text_en: 'I like ___.', anchor_words: ['i', 'like'] }], duration_s: 60 },
          { id: 't3', type: 'story', prompt_en: 'Tell a story.', must_use: ['because'], duration_s: 90, use_photo: false },
          { id: 't4', type: 'build', columns: [{ id: 'c1', label_en: 'We', options: ['play', 'run'] }, { id: 'c2', label_en: 'At', options: ['school', 'home'] }], sentences_required: 1 },
          { id: 't5', type: 'picture', anchors: ['dog'], duration_s: 60 },
          { id: 't6', type: 'qa', cards: [{ id: 'q1', question_en: 'Is it fun?', stem: { text_en: 'Yes, it is ___.', anchor_words: ['yes', 'it', 'is'] } }], duration_s: 30 },
        ],
        history: [],
      },
    };
    buildHomeworkSteps(codeData);
    buildSpeakingModes(codeData);
    assert.equal(fetchCalled, false, 'no fetch on the kid speaking-context path');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('minny-speaking-context response carries the code level (V1.2 packet 2: topic picker gates on it pre-start)', async () => {
  const { onRequestGet } = await import('../functions/api/minny-speaking-context.js');
  const kv = {
    async get(key, opts) {
      if (key === 'R2L-LVL-TEST') return { student_name: 'Lvl', progress: { current_level: 'L4' } };
      return null;
    },
    async put() {},
  };
  const request = new Request('http://x/api/minny-speaking-context?code=R2L-LVL-TEST');
  const res = await onRequestGet({ request, env: { READ2LEAD_CODES: kv } });
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.level, 'L4');
});

// --- Elon review fix (2026-07-13): step-id collision across same-type tasks ---
// Mark flagged this: item/card ids restart at s1/q1 inside every task and
// `present` hardcodes 'hw_frame', so a lesson with (say) a vocabulary list AND
// a sentence list — both `read` — emitted duplicate step ids. The kid client
// keys progress, scoring and the fix-it round off step.id.
test('buildHomeworkSteps: same-type tasks never emit duplicate step ids', () => {
  const mode = buildHomeworkSteps({
    homework: {
      schema_version: 3,
      tasks: [
        { id: 't1', type: 'read', items: [{ id: 's1', text_en: 'I have two cats.' }] },
        { id: 't2', type: 'read', items: [{ id: 's1', text_en: 'She is happy.' }] },
        { id: 't3', type: 'present', stems: [{ id: 'f1', text_en: 'I went to ___.', anchor_words: ['i', 'went', 'to'] }], duration_s: 60 },
        { id: 't4', type: 'present', stems: [{ id: 'f1', text_en: 'I saw ___.', anchor_words: ['i', 'saw'] }], duration_s: 60 },
      ],
    },
  });
  const ids = mode.steps.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate step ids: ${ids.join(', ')}`);
  // First use of each base id is handed back UNCHANGED — this is what keeps the
  // v1/v2 upgrade path byte-identical.
  assert.ok(ids.includes('hw_s1'));
  assert.ok(ids.includes('hw_frame'));
});
