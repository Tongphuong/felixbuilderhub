import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildPracticePrompts,
  buildSpeakingModes,
  pickPracticePack,
  buildHomeworkSteps,
} from '../functions/api/minny-speaking-context.js';
import { canAccessPackForPractice } from '../functions/api/_read2lead-pack-access.js';

const speakingPage = readFileSync('src/pages/read2lead/speaking.astro', 'utf-8');
const parentPortal = readFileSync('src/pages/ho-so/index.astro', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so.ts', 'utf-8') + '\n' + readFileSync('src/pages/ho-so/ho-so-parent-view.ts', 'utf-8');

test('speaking page exists with coaching-first copy and no AI marketing', () => {
  assert.match(speakingPage, /Luyện nói với Minny/);
  assert.match(speakingPage, /Felix Coaching/);
  assert.match(speakingPage, /minny-speaking-context/);
  assert.match(speakingPage, /read2lead-speaking-check/);
  assert.match(speakingPage, /practice_mode/);
  assert.match(speakingPage, /data\.modes/);
  assert.match(speakingPage, /🎤 Con nói/);
  assert.doesNotMatch(speakingPage, /tăng cường bởi AI/i);
  assert.doesNotMatch(speakingPage, /\bAI\b/);
});

test('speaking page has kid-friendly mode cards and video fallback', () => {
  assert.match(speakingPage, /minny-mode-card/);
  assert.match(speakingPage, /mode-picker/);
  assert.match(speakingPage, /practice-screen/);
  assert.match(speakingPage, /id="minny-video"/);
  assert.match(speakingPage, /id="minny-fallback"/);
  assert.match(speakingPage, /tryPlay\('mp4'\)/);
  assert.match(speakingPage, /\.webm/);
  assert.match(speakingPage, /showMinnyPng/);
  assert.match(speakingPage, /back-to-modes/);
  assert.match(speakingPage, /progress-dots/);
});

test('unified profile renders parent view with portfolio and dashboard', () => {
  assert.match(parentPortal, /renderParentView/);
  assert.match(parentPortal, /renderAll/);
});

test('buildSpeakingModes returns output-focused retell and questions modes', () => {
  const modes = buildSpeakingModes({
    studentName: 'Linh',
    storyTitle: 'The Puppy',
    topic: 'animals',
    v2Pack: {
      story: {
        title: 'The Puppy',
        paragraphs_en: ['A small puppy plays in the park.'],
      },
      topic: 'animals',
      activities: [
        {
          type: 'reading_comprehension',
          questions: [
            {
              section: 'Open Question',
              question_vi: 'Con thích nhân vật nào nhất?',
              question_en: 'Which character did you like most?',
            },
          ],
        },
      ],
    },
  });

  assert.equal(modes.length, 2);
  assert.equal(modes[0].id, 'retell');
  assert.equal(modes[1].id, 'questions');
  assert.match(modes[0].title_vi, /Kể lại truyện/);
  assert.match(modes[1].title_vi, /Minny hỏi/);
  assert.equal(modes[0].steps[0].kind, 'retell');
  assert.equal(modes[0].steps[0].check_mode, 'open');
  assert.equal(modes[1].steps[0].kind, 'question');
  assert.equal(modes[1].steps[0].check_mode, 'open');
  assert.ok(modes[0].steps.length >= 2, 'retell mode includes say-more follow-up');
});

test('buildPracticePrompts flattens modes without sentence read-back', () => {
  const prompts = buildPracticePrompts({
    studentName: 'Linh',
    storyTitle: 'The Puppy',
    topic: 'animals',
    v2Pack: {
      story: {
        title: 'The Puppy',
        paragraphs_en: ['A small puppy plays in the park.'],
      },
      topic: 'animals',
    },
  });
  assert.ok(prompts.length >= 2);
  assert.ok(prompts.every((step) => step.check_mode === 'open'));
  assert.ok(prompts.every((step) => step.kind !== 'repeat'));
  assert.match(prompts[0].label_vi, /Kể lại truyện/);
});

test('pickPracticePack prefers current pack with story', () => {
  const picked = pickPracticePack({
    progress: {
      current_pack: {
        pack_id: 'pack_1',
        status: 'reviewed_pass_web_v2',
        story: { title: 'Story' },
        schema_version: 2,
        activities: [],
      },
      review_history: [{ pack_id: 'pack_1', title: 'Story' }],
    },
  });
  assert.equal(picked.pack_id, 'pack_1');
  assert.equal(picked.source, 'current_pack');
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

test('buildSpeakingModes includes homework mode first when homework present', () => {
  const codeData = {
    homework: {
      updated_at: '2026-07-04T09:00:00.000Z',
      sentences: [{ id: 's1', text_en: 'Test.', hint_vi: null }],
    },
  };
  const modes = buildSpeakingModes({
    studentName: 'Linh',
    storyTitle: 'The Puppy',
    topic: 'animals',
    v2Pack: null,
    codeData,
  });
  assert.equal(modes.length, 3);
  assert.equal(modes[0].id, 'homework');
  assert.equal(modes[1].id, 'retell');
  assert.equal(modes[2].id, 'questions');
});

test('buildSpeakingModes without homework unchanged', () => {
  const modes = buildSpeakingModes({
    studentName: 'Linh',
    storyTitle: 'The Puppy',
    topic: 'animals',
    v2Pack: null,
  });
  assert.equal(modes.length, 2);
  assert.equal(modes[0].id, 'retell');
  assert.equal(modes[1].id, 'questions');
});
