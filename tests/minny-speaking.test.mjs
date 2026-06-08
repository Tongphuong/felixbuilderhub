import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildPracticePrompts,
  buildSpeakingModes,
  pickPracticePack,
} from '../functions/api/minny-speaking-context.js';
import { canAccessPackForPractice } from '../functions/api/_read2lead-pack-access.js';

const speakingPage = readFileSync('src/pages/read2lead/speaking.astro', 'utf-8');
const parentPortal = readFileSync('src/pages/hoc-sinh/index.astro', 'utf-8');

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

test('parent portal links to speaking page without coming-soon badge', () => {
  assert.match(parentPortal, /\/read2lead\/speaking\?code=/);
  assert.match(parentPortal, /Luyện nói với Minny/);
  assert.doesNotMatch(parentPortal, /Sắp ra mắt[\s\S]*Luyện nói với Minny/);
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
