import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const schema = readFileSync('schemas/pack.schema.v2.json', 'utf-8');

test('pack schema exposes optional story.trivia_vi', () => {
  assert.match(schema, /"trivia_vi"/);
});

test('lesson page wires W11 trivia reveal after lesson pass', () => {
  assert.match(lessonPage, /trivia-reveal-section/);
  assert.match(lessonPage, /Bí mật sau truyện/);
  assert.match(lessonPage, /_r2lMaybeRevealTriviaSecret/);
  assert.match(lessonPage, /TRIVIA_REVEAL_MIN_SCORE = 75/);
  assert.match(lessonPage, /trivia-reveal-continue/);
  assert.match(lessonPage, /r2l-trivia-reveal/);
});

test('trivia remains isolated from the active activity instructions', () => {
  const commandStart = lessonPage.indexOf('const MINNY_COMMANDS');
  const commandEnd = lessonPage.indexOf('const MINNY_CELEBRATE');
  assert.ok(commandStart > -1 && commandEnd > commandStart);
  const commandBody = lessonPage.slice(commandStart, commandEnd);
  assert.doesNotMatch(commandBody, /trivia_vi/);
});

// R2L Rewards Redesign (SPEC_R2L_REWARDS_REDESIGN.md, approved 2026-07-18):
// _r2lShowCompletionAfterTrivia is the single terminal completion path for
// both book lessons and standard packs — it must read the new
// rewards.diamonds field (submit-read2lead-lesson.js response) and show 💎,
// not the retired rewards.coins/🪙 xu wording.
test('lesson completion reads rewards.diamonds (falling back to legacy coins) and celebrates with 💎', () => {
  const start = lessonPage.indexOf('function _r2lShowCompletionAfterTrivia');
  const end = lessonPage.indexOf("qs('#trivia-reveal-continue')");
  assert.ok(start > -1 && end > start);
  const body = lessonPage.slice(start, end);
  assert.match(body, /const rewardDiamonds = Number\(rewards\.diamonds \?\? rewards\.coins \?\? 0\);/);
  assert.match(body, /Con nhận 💎 \$\{rewardDiamonds\} và ⭐ \$\{rewards\.xp \|\| 0\} XP cho nhiệm vụ này\./);
  assert.match(body, /playSfx\(SFX\.diamondChime, \{ volume: 0\.6 \}\);/);
  assert.match(body, /showDiamondTicker\(rewardDiamonds, '#completion-card'\);/);
  assert.doesNotMatch(body, /🪙/);
  assert.doesNotMatch(body, /playSynthTone\?\.\('coin'/);
});
