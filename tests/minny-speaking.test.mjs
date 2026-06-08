import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildPracticePrompts, pickPracticePack } from '../functions/api/minny-speaking-context.js';
import { canAccessPackForPractice } from '../functions/api/_read2lead-pack-access.js';

const speakingPage = readFileSync('src/pages/read2lead/speaking.astro', 'utf-8');
const parentPortal = readFileSync('src/pages/hoc-sinh/index.astro', 'utf-8');

test('speaking page exists with coaching-first copy and no AI marketing', () => {
  assert.match(speakingPage, /Luyện nói với Minny/);
  assert.match(speakingPage, /Felix Coaching/);
  assert.match(speakingPage, /minny-speaking-context/);
  assert.match(speakingPage, /read2lead-speaking-check/);
  assert.match(speakingPage, /practice_mode/);
  assert.doesNotMatch(speakingPage, /tăng cường bởi AI/i);
  assert.doesNotMatch(speakingPage, /\bAI\b/);
});

test('parent portal links to speaking page without coming-soon badge', () => {
  assert.match(parentPortal, /\/read2lead\/speaking\?code=/);
  assert.match(parentPortal, /Luyện nói với Minny/);
  assert.doesNotMatch(parentPortal, /Sắp ra mắt[\s\S]*Luyện nói với Minny/);
});

test('buildPracticePrompts uses story sentences and retell open prompt', () => {
  const prompts = buildPracticePrompts({
    studentName: 'Linh',
    storyTitle: 'The Puppy',
    topic: 'animals',
    v2Pack: {
      story: {
        title: 'The Puppy',
        sentences: [{ text_en: 'The puppy runs fast.' }, { text_en: 'It is happy.' }],
        paragraphs_en: ['A small puppy plays in the park.'],
      },
      topic: 'animals',
    },
  });
  assert.ok(prompts.length >= 3);
  assert.equal(prompts[0].check_mode, 'read');
  assert.equal(prompts[prompts.length - 1].check_mode, 'open');
  assert.match(prompts[prompts.length - 1].label_vi, /Kể về truyện/);
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
