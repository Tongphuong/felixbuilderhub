// Public policy only. Answer keys, evidence and reward ledgers stay on the server.
export const STORY_MISSION_VERSION = 'story-mission-v1';
export const STORY_REWARD_VERSION = 'story-diamonds-v1';
export const STORY_INTERVIEW_VERSION = 'story-interview-v1';
export const STORY_INTERVIEW_QUESTIONS = 12;
export const STORY_INTERVIEW_DIAMONDS = 50;
export function isStoryInterview(lesson) {
  return lesson?.interview?.version === STORY_INTERVIEW_VERSION;
}
export const STORY_STAGES = Object.freeze(['read', 'understand', 'retell', 'reward']);
export const STORY_REWARDS = Object.freeze([
  Object.freeze({ grade: 'S', minPercent: 85, xp: 20, diamonds: 1000 }),
  Object.freeze({ grade: 'A', minPercent: 70, xp: 20, diamonds: 800 }),
  Object.freeze({ grade: 'B', minPercent: 50, xp: 10, diamonds: 400 }),
]);
export const STORY_RECALL_DIAMONDS = 200;
// A product default to evaluate in the pilot, not a research-proven optimum.
export const STORY_RECALL_DELAY_MS = 24 * 60 * 60 * 1000;

export function storyRewardForScore(percent) {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new TypeError('Invalid mission score');
  }
  const tier = STORY_REWARDS.find((entry) => percent >= entry.minPercent);
  return tier ? { ...tier } : { grade: null, xp: 0, diamonds: 0 };
}
