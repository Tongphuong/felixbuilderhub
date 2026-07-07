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
  assert.equal(mode.steps[0].check_mode, 'read');
  assert.equal(mode.steps[0].prompt_en, 'I like apples.');
  assert.equal(mode.steps[1].id, 'hw_s2');
  assert.equal(mode.steps[2].id, 'hw_frame');
  assert.equal(mode.steps[2].kind, 'speech');
  assert.equal(mode.steps[2].check_mode, 'frame');
  assert.equal(mode.steps[2].max_seconds, 60); // 45 + 15
  assert.deepEqual(mode.steps[2].stems, codeData.homework.frame.stems);
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
