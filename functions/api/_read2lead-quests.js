// R2L-REWARDS-REDESIGN (2026-07-18): rewards converted coins -> diamonds at
// 1💎 = 2🪙 (floor), per SPEC_R2L_REWARDS_REDESIGN.md §3.3/§5.
export const QUEST_DEFS = {
  q1: { label_vi: 'Xong 1 bài học hôm nay', target: 1, reward: { diamonds: 5, rp: 0 }, trigger: 'pack_passed' },
  q2: { label_vi: 'Trên 80% chính xác trong 1 bài', target: 1, reward: { diamonds: 7, rp: 1 }, trigger: 'pack_passed_high_score' },
  q3: { label_vi: 'Làm phần Nói lại trong 1 bài', target: 1, reward: { diamonds: 6, rp: 0 }, trigger: 'speak_completed' },
  q4: { label_vi: 'Đúng 5 câu liên tiếp trong 1 bài', target: 1, reward: { diamonds: 5, rp: 0 }, trigger: 'combo_reached_5' },
  q5: { label_vi: 'Mở 1 rương', target: 1, reward: { diamonds: 2, rp: 0 }, trigger: 'chest_opened' },
  q6: { label_vi: 'Xong 2 bài học hôm nay', target: 2, reward: { diamonds: 10, rp: 1 }, trigger: 'pack_passed' },
  q7: { label_vi: 'Hoàn thành 1 hoạt động không sai', target: 1, reward: { diamonds: 7, rp: 0 }, trigger: 'activity_perfect' },
  q8: { label_vi: 'Học liên tục 3 ngày (streak)', target: 1, reward: { diamonds: 12, rp: 0 }, trigger: 'streak_day_3' },
};

export const QUEST_IDS = Object.keys(QUEST_DEFS);

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic pick of 3 unique quest ids from 8.
 * @param {string} dateKey - VN date key 'YYYY-MM-DD'
 * @param {string} code - access code, e.g. 'R2L-ABC123'
 * @returns {[string, string, string]}
 */
export function pickDailyQuestIds(dateKey, code) {
  const ids = QUEST_IDS.slice();
  let seed = fnv1a(`${dateKey}|${code || 'anon'}`);
  for (let i = ids.length - 1; i > 0; i--) {
    seed = fnv1a(String(seed));
    const j = seed % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 3);
}

/**
 * Has the quest been satisfied by current progress?
 * @param {string} questId
 * @param {number} progressValue
 * @returns {boolean}
 */
export function questCompleted(questId, progressValue) {
  const def = QUEST_DEFS[questId];
  if (!def) return false;
  return progressValue >= def.target;
}

/**
 * Get reward for a quest. Used by Z1 on claim.
 * @param {string} questId
 * @returns {{diamonds: number, rp: number}}
 */
export function questReward(questId) {
  const def = QUEST_DEFS[questId];
  if (!def) return { diamonds: 0, rp: 0 };
  return { ...def.reward };
}

/**
 * Map a state event to which quest IDs should increment.
 * @param {string} eventName
 * @param {object} params
 * @param {[string, string, string]} activeIds
 * @returns {Array<{questId: string, delta: number}>}
 */
export function questDeltasForEvent(eventName, params, activeIds) {
  if (!eventName || !Array.isArray(activeIds)) return [];
  const deltas = [];
  for (const questId of activeIds) {
    const def = QUEST_DEFS[questId];
    if (!def || def.trigger !== eventName) continue;
    deltas.push({ questId, delta: 1 });
  }
  return deltas;
}
