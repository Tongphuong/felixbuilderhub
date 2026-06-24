import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lessonPage = readFileSync('src/pages/read2lead/lesson.astro', 'utf-8');
const progressBar = readFileSync('src/components/read2lead/v2/ProgressBar.astro', 'utf-8');
const lessonActivities = readFileSync('functions/api/_read2lead-lesson-activities.js', 'utf-8');

test('mission chrome shows part n/6 with progress dots', () => {
  assert.match(progressBar, /progress-part-label/);
  assert.match(progressBar, /progress-dots/);
  assert.match(progressBar, /data-dot="0"/);
  assert.match(progressBar, /id="sfx-toggle"/);
  assert.match(lessonPage, /r2l-dot/);
  assert.match(lessonPage, /dot\.dataset\.state/);
  assert.doesNotMatch(lessonPage, /#progress-fill/);
});

test('step buttons use done active locked states', () => {
  assert.match(lessonPage, /button\.dataset\.state = 'done'/);
  assert.match(lessonPage, /button\.dataset\.state = 'active'/);
  assert.match(lessonPage, /button\.dataset\.state = 'locked'/);
  assert.match(lessonPage, /r2l-step\[data-state='locked'\]/);
  assert.match(lessonPage, /state\.completedTypes\.has\(type\)/);
});

test('global CTA replaces per-activity prev next nav', () => {
  assert.match(lessonPage, /id="lesson-continue"/);
  assert.match(lessonPage, /function updateGlobalCta/);
  assert.doesNotMatch(lessonPage, /function renderActivityNav/);
  assert.doesNotMatch(lessonPage, /data-activity-prev/);
});

test('retell_summary is injected and reachable as part 6', () => {
  assert.match(lessonActivities, /retell_summary/);
  assert.match(lessonPage, /data-activity-shell="retell_summary"/);
  assert.match(lessonPage, /function ensureLessonActivities/);
  assert.match(lessonPage, /showActivity\(state\.activityIndex \+ 1\)/);
});

test('story dock replaces old story grid', () => {
  const storyDock = readFileSync('src/components/read2lead/v2/StoryDock.astro', 'utf-8');
  assert.match(storyDock, /id="story-dock"/);
  assert.match(storyDock, /id="dock-sentences"/);
  assert.match(lessonPage, /function initStoryDock/);
  assert.match(lessonPage, /function toggleDock/);
  assert.match(lessonPage, /function highlightDockSentence/);
  assert.match(lessonPage, /import StoryDock/);
  assert.doesNotMatch(lessonPage, /id="story-title"/);
  assert.doesNotMatch(lessonPage, /id="sentence-list"/);
});

test('minny coach strip with mood bubble and streak', () => {
  const minnyStrip = readFileSync('src/components/read2lead/v2/MinnyCoachStrip.astro', 'utf-8');
  assert.match(minnyStrip, /id="minny-strip"/);
  assert.match(minnyStrip, /id="minny-strip-avatar"/);
  assert.match(minnyStrip, /id="minny-strip-bubble"/);
  assert.match(lessonPage, /const MINNY_COMMANDS/);
  assert.match(lessonPage, /function setMinnyStrip/);
  assert.match(lessonPage, /function onItemCorrect/);
  assert.match(lessonPage, /function onItemWrong/);
  assert.match(lessonPage, /_itemStreak/);
  assert.match(lessonPage, /import MinnyCoachStrip/);
  assert.match(lessonPage, /onItemCorrect\(\)/);
  assert.match(lessonPage, /onItemWrong\(questionId\)/);
});

test('minny strip hidden for speak and retell parts', () => {
  assert.match(lessonPage, /minnyStrip\.hidden = useLargeMinny/);
  assert.match(lessonPage, /heroWrap\.hidden = !useLargeMinny/);
  assert.match(lessonPage, /listen_and_speak', 'read_aloud'\].includes\(activity\.type\)/);
});

test('meso interstitial between activity parts', () => {
  assert.match(lessonPage, /function showMesoInterstitial/);
  assert.match(lessonPage, /showMesoInterstitial\(completedIndex, nextIndex\)/);
  assert.match(lessonPage, /Phần \$\{partNum\} xong/);
  assert.match(lessonPage, /function dismissRewardBurst/);
});

test('parent guidance strip with per-activity help', () => {
  const parentStrip = readFileSync('src/components/read2lead/v2/ParentStrip.astro', 'utf-8');
  assert.match(parentStrip, /id="parent-strip"/);
  assert.match(parentStrip, /id="parent-doing"/);
  assert.match(parentStrip, /id="parent-needs"/);
  assert.match(parentStrip, /id="parent-stuck"/);
  assert.match(lessonPage, /const PARENT_GUIDE/);
  assert.match(lessonPage, /function updateParentStrip/);
  assert.match(lessonPage, /import ParentStrip/);
  const parentIdx = lessonPage.indexOf('<ParentStrip />');
  const dockIdx = lessonPage.indexOf('<StoryDock />');
  const minnyIdx = lessonPage.indexOf('<MinnyCoachStrip />');
  assert.ok(parentIdx > -1 && dockIdx > parentIdx, 'ParentStrip should appear before StoryDock');
  assert.ok(minnyIdx > dockIdx, 'MinnyCoachStrip should appear after StoryDock');
});

test('submit confirmation modal before lesson submit', () => {
  assert.match(lessonPage, /id="submit-confirm-modal"/);
  assert.match(lessonPage, /id="submit-confirm-yes"/);
  assert.match(lessonPage, /id="submit-confirm-no"/);
  assert.match(lessonPage, /submit-confirm-modal'\)\?\.classList\.remove\('hidden'\)/);
  assert.match(lessonPage, /submit-confirm-yes.*submit-lesson/s);
  assert.doesNotMatch(lessonPage, /if \(allDone\) \{\s*qs\('#submit-lesson'\)\?\.click\(\)/s);
});
