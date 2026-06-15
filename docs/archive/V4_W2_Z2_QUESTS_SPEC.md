# V4 W2 Z2 — Quests engine spec (Cursor #1)

**Parent:** `docs/V4_W2_DOPAMINE_SPEC.md`
**Owner:** Cursor #1 · **Branch:** `cursor-1/w2-z2-quests` (off `origin/main`)
**Worktree:** `D:\hub-cursor-1-w2-z2`
**Status:** READY (Phương ack 2026-06-13: rotate full 8, quest labels OK)

---

## 1. Mục tiêu

Pure module — 8 quest definitions + deterministic daily-3 picker + completion checker + reward lookup. Z1 sẽ import module này. KHÔNG đụng state-core, KHÔNG viết KV.

## 2. Files allowed

- `functions/api/_read2lead-quests.js` (NEW — pure functions, no I/O)
- `tests/read2lead-quests.test.mjs` (NEW)

Cấm đụng mọi file khác.

## 3. Module contract

```js
// functions/api/_read2lead-quests.js

export const QUEST_DEFS = {
  q1: { label_vi: 'Xong 1 bài học hôm nay', target: 1, reward: { coins: 10, rp: 0 }, trigger: 'pack_passed' },
  q2: { label_vi: 'Trên 80% chính xác trong 1 bài', target: 1, reward: { coins: 15, rp: 1 }, trigger: 'pack_passed_high_score' },
  q3: { label_vi: 'Làm phần Nói lại trong 1 bài', target: 1, reward: { coins: 12, rp: 0 }, trigger: 'speak_completed' },
  q4: { label_vi: 'Đúng 5 câu liên tiếp trong 1 bài', target: 1, reward: { coins: 10, rp: 0 }, trigger: 'combo_reached_5' },
  q5: { label_vi: 'Mở 1 rương', target: 1, reward: { coins: 5, rp: 0 }, trigger: 'chest_opened' },
  q6: { label_vi: 'Xong 2 bài học hôm nay', target: 2, reward: { coins: 20, rp: 1 }, trigger: 'pack_passed' },
  q7: { label_vi: 'Hoàn thành 1 hoạt động không sai', target: 1, reward: { coins: 15, rp: 0 }, trigger: 'activity_perfect' },
  q8: { label_vi: 'Học liên tục 3 ngày (streak)', target: 1, reward: { coins: 25, rp: 0 }, trigger: 'streak_day_3' },
};

export const QUEST_IDS = Object.keys(QUEST_DEFS);  // ['q1', ..., 'q8']

/**
 * Deterministic pick of 3 unique quest ids from 8.
 * Same (dateKey, code) → same 3 ids forever. Different (dateKey, code) → different 3.
 * @param {string} dateKey - VN date key 'YYYY-MM-DD'
 * @param {string} code - access code, e.g. 'R2L-ABC123'
 * @returns {[string, string, string]}
 */
export function pickDailyQuestIds(dateKey, code) {
  // Hash dateKey+code → shuffle QUEST_IDS deterministically → take first 3
  // Use simple FNV-1a 32-bit hash, no crypto needed (deterministic + cheap)
}

/**
 * Has the quest been satisfied by current progress?
 * @param {string} questId
 * @param {number} progressValue - integer count
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
 * @returns {{coins: number, rp: number}}
 */
export function questReward(questId) {
  const def = QUEST_DEFS[questId];
  if (!def) return { coins: 0, rp: 0 };
  return { ...def.reward };
}

/**
 * Map a state event to which quest IDs should increment.
 * Called by Z1 applyQuestProgress.
 * @param {string} eventName - one of TRIGGER names
 * @param {object} params - event-specific data
 * @param {[string, string, string]} activeIds - today's 3 quest ids
 * @returns {Array<{questId: string, delta: number}>}
 */
export function questDeltasForEvent(eventName, params, activeIds) {
  // Walk activeIds, check each def.trigger against eventName + params,
  // return list of {questId, delta} (delta usually 1)
}
```

## 4. Algorithm — pickDailyQuestIds

```js
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pickDailyQuestIds(dateKey, code) {
  const ids = QUEST_IDS.slice();
  // Fisher-Yates shuffle seeded by hash
  let seed = fnv1a(`${dateKey}|${code || 'anon'}`);
  for (let i = ids.length - 1; i > 0; i--) {
    seed = fnv1a(String(seed));
    const j = seed % (i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, 3);
}
```

## 5. Trigger semantics (Z1 sẽ emit theo các event này)

| Event | Params | Increments which quest |
|---|---|---|
| `pack_passed` | `{ score, has_speak }` | q1 (always +1), q6 (always +1) |
| `pack_passed_high_score` | `{ score }` (score≥80) | q2 (+1) |
| `speak_completed` | `{}` | q3 (+1) |
| `combo_reached_5` | `{}` (combo ≥5 in activity) | q4 (+1) |
| `chest_opened` | `{ rarity }` | q5 (+1) |
| `activity_perfect` | `{ activity_key }` | q7 (+1) |
| `streak_day_3` | `{ streak }` (streak≥3) | q8 (+1 nhưng cap 1/ngày) |

Z2 chỉ trả `[{questId, delta}]`. Z1 quyết apply hay không (vd q8 cap).

## 6. Tests (`tests/read2lead-quests.test.mjs`)

```js
import { test } from 'node:test';
import assert from 'node:assert';
import {
  QUEST_DEFS, QUEST_IDS, pickDailyQuestIds, questCompleted,
  questReward, questDeltasForEvent,
} from '../functions/api/_read2lead-quests.js';

test('QUEST_DEFS has exactly 8 quests with valid shape', () => { /* shape check */ });
test('pickDailyQuestIds is deterministic for same (date, code)', () => { /* same input → same output */ });
test('pickDailyQuestIds returns 3 unique ids', () => { /* check uniqueness over 100 dates */ });
test('pickDailyQuestIds varies across dates/codes', () => { /* sample 50 combos, expect >30 distinct triples */ });
test('questCompleted returns true at target', () => { /* boundary */ });
test('questReward returns shallow copy (cannot mutate def)', () => { /* mutate return, re-read def */ });
test('questDeltasForEvent pack_passed increments q1+q6 if active', () => { /* */ });
test('questDeltasForEvent pack_passed_high_score increments q2 only if active', () => { /* */ });
test('questDeltasForEvent inactive quest returns no delta', () => { /* */ });
test('questDeltasForEvent unknown event returns empty', () => { /* */ });
```

Aim: 10+ tests, all green.

## 7. Done when

1. `_read2lead-quests.js` exports khớp contract §3.
2. `tests/read2lead-quests.test.mjs` xanh ≥10 tests.
3. `node --test` toàn bộ xanh (Z2 không gãy tests cũ).
4. `npx astro check` không thêm error.
5. Branch `cursor-1/w2-z2-quests` pushed origin.
6. AGENT_LOG START + DONE với commit hash.

## 8. Constraints

- NO KV access, NO `fetch`, NO mutable global.
- Pure functions only.
- No new npm dep.
- File < 200 lines.

## 9. Report

Theo format AGENTS.md §4. Paste `git log --oneline -3`, `git status --short`, `git log origin/cursor-1/w2-z2-quests -1`.
