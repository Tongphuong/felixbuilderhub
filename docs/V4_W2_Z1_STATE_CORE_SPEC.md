# V4 W2 Z1 — State-core extension spec (Codex)

**Parent:** `docs/V4_W2_DOPAMINE_SPEC.md`
**Depends on:** Z2 (`_read2lead-quests.js`) + Z3 (`_read2lead-chests.js`) MERGED into `v4-w2` first.
**Owner:** Codex (1 agent, kỷ luật cao — touches protected `_read2lead-v2-state.js`)
**Branch:** `codex/w2-z1-state-core` (off `origin/v4-w2`)
**Worktree:** `D:\hub-codex-w2-z1`
**Status:** READY (Phương ack 2026-06-13 all 5 decision gates)

---

## 1. Mục tiêu

Extend state-core với daily_quests, pending_chest, chest_history, daily_login_chest, combo_lifetime_xu. Add 3 API endpoints (claim quest, open chest, claim daily login chest). Hook quest events + chest award vào `submit-read2lead-lesson.js`. Enforce combo xu cap server-side.

**Backward compatibility là requirement cứng:** old records (no W2 fields) MUST read + behave như W2 chưa start. Một field nào missing → fallback default. Cấm rename/remove field cũ.

## 2. Files allowed

- `functions/api/_read2lead-v2-state.js` (EXTEND — add helpers + defaults trong normalizeProgressState)
- `functions/api/submit-read2lead-lesson.js` (EDIT — add quest event hooks + chest award + combo cap)
- `functions/api/read2lead-quest-claim.js` (NEW)
- `functions/api/read2lead-chest-open.js` (NEW)
- `functions/api/read2lead-daily-chest-claim.js` (NEW)
- `tests/read2lead-w2-state.test.mjs` (NEW)
- `tests/read2lead-w2-submit-integration.test.mjs` (NEW)
- `tests/read2lead-w2-endpoints.test.mjs` (NEW)

Cấm sửa:
- Z2 `_read2lead-quests.js`, Z3 `_read2lead-chests.js` (only import)
- mic/speaking files
- Z4 UI components, Z5 audio/juice files
- lesson.astro

## 3. State schema additions

Trong `normalizeProgressState` (existing function ~line 540), thêm fields sau (giữ THỨ TỰ alphabet không cần — chỉ cần additive):

```js
{
  // ... all existing fields unchanged ...

  daily_quests: normalizeDailyQuests(raw?.daily_quests, accessCode, vietnamDateKey(nowIso)),
  pending_chest: normalizePendingChest(raw?.pending_chest),
  chest_history: normalizeChestHistory(raw?.chest_history),
  daily_login_chest: normalizeDailyLoginChest(raw?.daily_login_chest),
  combo_lifetime_xu: numberOrZero(raw?.combo_lifetime_xu),
  unlocked_parts: Array.isArray(raw?.unlocked_parts) ? Array.from(new Set(raw.unlocked_parts.filter(Boolean).map(String))) : [],
}
```

### Field schemas

```js
// daily_quests
{
  date: 'YYYY-MM-DD',                       // VN date key
  ids: [string, string, string],            // 3 quest ids from QUEST_IDS
  progress: { [questId]: integer },         // 0..target per quest
  claimed: { [questId]: boolean },          // claim flag
}

// pending_chest (null when none)
{
  rarity: 'common' | 'rare' | 'epic',
  reward: {
    coins: integer,
    part_id: string | null,
    part_name?: string,                     // optional human label cached
  },
  duplicate: boolean,                       // true if part was duplicate → coins-only
  awarded_at: ISO string,
}

// chest_history (last 50, FIFO trim)
[
  {
    opened_at: ISO string,
    rarity: string,
    reward: { coins, part_id },
    duplicate: boolean,
  },
  ...
]

// daily_login_chest
{
  last_claim_date: 'YYYY-MM-DD' | null,
}
```

### Normalizers (helper functions Z1 owns)

```js
function normalizeDailyQuests(raw, code, todayKey) {
  // If raw missing or raw.date !== todayKey → rebuild fresh
  if (!raw || raw.date !== todayKey) {
    const ids = pickDailyQuestIds(todayKey, code);  // from Z2
    const progress = {}; const claimed = {};
    for (const id of ids) { progress[id] = 0; claimed[id] = false; }
    return { date: todayKey, ids, progress, claimed };
  }
  // Otherwise normalize existing
  const validIds = Array.isArray(raw.ids) ? raw.ids.filter(id => QUEST_IDS.includes(id)).slice(0, 3) : [];
  if (validIds.length !== 3) {
    // Corruption — rebuild
    return normalizeDailyQuests(null, code, todayKey);
  }
  const progress = {}; const claimed = {};
  for (const id of validIds) {
    progress[id] = clampInt(raw.progress?.[id] ?? 0, 0, 999);
    claimed[id] = Boolean(raw.claimed?.[id]);
  }
  return { date: raw.date, ids: validIds, progress, claimed };
}

function normalizePendingChest(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!['common', 'rare', 'epic'].includes(raw.rarity)) return null;
  return {
    rarity: raw.rarity,
    reward: {
      coins: numberOrZero(raw.reward?.coins),
      part_id: raw.reward?.part_id ? String(raw.reward.part_id) : null,
      ...(raw.reward?.part_name ? { part_name: String(raw.reward.part_name) } : {}),
    },
    duplicate: Boolean(raw.duplicate),
    awarded_at: raw.awarded_at || null,
  };
}

function normalizeChestHistory(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(e => e && ['common', 'rare', 'epic'].includes(e.rarity))
    .slice(-CHEST_HISTORY_LIMIT)
    .map(e => ({
      opened_at: e.opened_at || null,
      rarity: e.rarity,
      reward: { coins: numberOrZero(e.reward?.coins), part_id: e.reward?.part_id || null },
      duplicate: Boolean(e.duplicate),
    }));
}

function normalizeDailyLoginChest(raw) {
  if (!raw || typeof raw !== 'object') return { last_claim_date: null };
  return { last_claim_date: raw.last_claim_date || null };
}
```

Constants thêm đầu file:

```js
import { QUEST_IDS, QUEST_DEFS, pickDailyQuestIds, questCompleted, questReward, questDeltasForEvent } from './_read2lead-quests.js';
import { rollChest, autoConvertDuplicate, chestPreviewText } from './_read2lead-chests.js';

const CHEST_HISTORY_LIMIT = 50;
const COMBO_XU_CAP_PER_PACK = 5;
const DAILY_LOGIN_CHEST_BASE = 5;
const DAILY_LOGIN_CHEST_PER_STREAK = 2;
const DAILY_LOGIN_CHEST_MAX_STREAK = 10;

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v) || 0);
  return Math.min(hi, Math.max(lo, n));
}
```

## 4. Helper functions (exports)

```js
// Read view for UI — includes preview text from Z3 for any pending chest
export function getDailyQuestsView(state, dateKey, code) {
  const dq = normalizeDailyQuests(state?.daily_quests, code, dateKey);
  return {
    date: dq.date,
    quests: dq.ids.map(id => ({
      id,
      label_vi: QUEST_DEFS[id].label_vi,
      target: QUEST_DEFS[id].target,
      progress: dq.progress[id] || 0,
      reward_coins: QUEST_DEFS[id].reward.coins,
      reward_rp: QUEST_DEFS[id].reward.rp || 0,
      claimed: Boolean(dq.claimed[id]),
      complete: questCompleted(id, dq.progress[id] || 0),
    })),
  };
}

// Mutator — apply progress for an event
export function applyQuestProgress(state, eventName, params, dateKey, code) {
  const dq = normalizeDailyQuests(state.daily_quests, code, dateKey);
  const deltas = questDeltasForEvent(eventName, params || {}, dq.ids);
  if (deltas.length === 0 && dq === state.daily_quests) return state;
  const nextProgress = { ...dq.progress };
  for (const { questId, delta } of deltas) {
    const target = QUEST_DEFS[questId]?.target ?? 0;
    nextProgress[questId] = Math.min(target, (nextProgress[questId] || 0) + delta);
  }
  return { ...state, daily_quests: { ...dq, progress: nextProgress } };
}

// Mutator — claim reward
export function claimQuestReward(state, questId, dateKey, code) {
  const dq = normalizeDailyQuests(state.daily_quests, code, dateKey);
  if (!dq.ids.includes(questId)) return { state, error: 'quest_not_active_today' };
  if (dq.claimed[questId]) return { state, error: 'already_claimed' };
  if (!questCompleted(questId, dq.progress[questId] || 0)) return { state, error: 'not_complete' };
  const reward = questReward(questId);
  // Add to coins + rank points
  let nextState = {
    ...state,
    coins: numberOrZero(state.coins) + reward.coins,
    daily_quests: { ...dq, claimed: { ...dq.claimed, [questId]: true } },
  };
  if (reward.rp > 0) {
    // Reuse existing awardRankPoints semantics for rp from quest? Quest RP is bonus, not score-derived.
    // Add directly to lifetime_rp/season.rp + respect cap_by_level only if season.rp > start.
    nextState = applyQuestRpBonus(nextState, reward.rp, dateKey);
  }
  return { state: nextState, reward };
}

function applyQuestRpBonus(state, rpBonus, dateKey) {
  // Lightweight: bump lifetime_rp + season.rp by rpBonus; respect existing cap.
  // DOES NOT count toward RANK_DAILY_RP_CAP (this is bonus, not score).
  const lifetime = numberOrZero(state.lifetime_rp ?? state.rank_points) + rpBonus;
  const seasonRp = numberOrZero(state.season?.rp) + rpBonus;
  return {
    ...state,
    lifetime_rp: lifetime,
    rank_points: lifetime,
    season: { ...(state.season || {}), rp: seasonRp },
  };
}

// Mutator — award chest after pack passed
export function awardPendingChest(state, { passed, score } = {}, rngFn = Math.random) {
  if (!passed) return state;
  if (state.pending_chest) return state;  // already pending — don't stack
  const raw = rollChest(rngFn);
  const owned = new Set(state.unlocked_parts || []);
  const final = autoConvertDuplicate(raw, owned);
  const pending = {
    rarity: final.rarity,
    reward: final.reward,
    duplicate: final.duplicate,
    awarded_at: new Date().toISOString(),
  };
  return { ...state, pending_chest: pending };
}

// Mutator — open chest (consume pending → push to history, add coins + part, fire quest event)
export function consumePendingChest(state, dateKey, code) {
  if (!state.pending_chest) return { state, error: 'no_pending_chest' };
  const ch = state.pending_chest;
  const coins = numberOrZero(state.coins) + ch.reward.coins;
  let unlocked = state.unlocked_parts || [];
  if (ch.reward.part_id && !ch.duplicate && !unlocked.includes(ch.reward.part_id)) {
    unlocked = [...unlocked, ch.reward.part_id];
  }
  const historyEntry = {
    opened_at: new Date().toISOString(),
    rarity: ch.rarity,
    reward: { coins: ch.reward.coins, part_id: ch.duplicate ? null : ch.reward.part_id },
    duplicate: ch.duplicate,
  };
  const history = [...(state.chest_history || []), historyEntry].slice(-CHEST_HISTORY_LIMIT);
  let next = {
    ...state,
    coins,
    unlocked_parts: unlocked,
    chest_history: history,
    pending_chest: null,
  };
  // Trigger quest progress for chest_opened
  next = applyQuestProgress(next, 'chest_opened', { rarity: ch.rarity }, dateKey, code);
  return { state: next, reward: { coins: ch.reward.coins, part_id: ch.duplicate ? null : ch.reward.part_id, duplicate: ch.duplicate, rarity: ch.rarity } };
}

// Mutator — claim daily login chest
export function claimDailyLoginChest(state, dateKey) {
  const dlc = state.daily_login_chest || { last_claim_date: null };
  if (dlc.last_claim_date === dateKey) {
    return { state, error: 'already_claimed_today' };
  }
  const streak = clampInt(state.streak_days, 0, 999);
  const cappedStreak = Math.min(streak, DAILY_LOGIN_CHEST_MAX_STREAK);
  const coins = DAILY_LOGIN_CHEST_BASE + DAILY_LOGIN_CHEST_PER_STREAK * cappedStreak;
  return {
    state: {
      ...state,
      coins: numberOrZero(state.coins) + coins,
      daily_login_chest: { last_claim_date: dateKey },
    },
    reward: { coins, formula: { base: DAILY_LOGIN_CHEST_BASE, per_streak: DAILY_LOGIN_CHEST_PER_STREAK, streak_used: cappedStreak } },
  };
}

// Mutator — combo bonus (server caps)
export function recordComboBonus(state, comboXuRequested) {
  const capped = clampInt(comboXuRequested, 0, COMBO_XU_CAP_PER_PACK);
  if (capped === 0) return state;
  return {
    ...state,
    coins: numberOrZero(state.coins) + capped,
    combo_lifetime_xu: numberOrZero(state.combo_lifetime_xu) + capped,
  };
}

// Preview helper for UI — what reward would daily chest give right now
export function previewDailyLoginChest(state, dateKey) {
  const dlc = state.daily_login_chest || { last_claim_date: null };
  const available = dlc.last_claim_date !== dateKey;
  const streak = clampInt(state.streak_days, 0, 999);
  const cappedStreak = Math.min(streak, DAILY_LOGIN_CHEST_MAX_STREAK);
  return {
    available,
    coins: DAILY_LOGIN_CHEST_BASE + DAILY_LOGIN_CHEST_PER_STREAK * cappedStreak,
    next_claim_date: available ? null : addDaysToDateKey(dlc.last_claim_date, 1),
  };
}

function addDaysToDateKey(dateKey, days) {
  if (!dateKey) return null;
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
```

Export tất cả từ `_read2lead-v2-state.js`.

## 5. submit-read2lead-lesson.js changes

Tìm trong file hiện tại (~480 lines) handler logic sau khi compute scorePercent + pack passed. Thêm hook block:

```js
// === V4 W2 hooks ===
const w2DateKey = vietnamDateKey(completedAt);

// Quest events
state = applyQuestProgress(state, 'pack_passed', { score: scorePercent, has_speak: hasSpeakActivity }, w2DateKey, code);
if (scorePercent >= 80) {
  state = applyQuestProgress(state, 'pack_passed_high_score', { score: scorePercent }, w2DateKey, code);
}
if (hasSpeakActivity) {
  state = applyQuestProgress(state, 'speak_completed', {}, w2DateKey, code);
}
// activity_perfect: walk activityResults, find any with 100% correct
const perfectActivity = (activityResults || []).find(a => a.percent === 100 || a.score === 1);
if (perfectActivity) {
  state = applyQuestProgress(state, 'activity_perfect', { activity_key: perfectActivity.key }, w2DateKey, code);
}
// streak_day_3: only when streak just hit ≥3 (avoid daily double-count: q8 already has cap via claim flag)
if (numberOrZero(state.streak_days) >= 3) {
  state = applyQuestProgress(state, 'streak_day_3', { streak: state.streak_days }, w2DateKey, code);
}

// Combo bonus (client sends, server caps)
const requestedComboXu = numberOrZero(request.combo_xu);
if (requestedComboXu > 0) {
  state = recordComboBonus(state, requestedComboXu);
}

// Chest award (only on pass, only if no pending)
if (passed) {
  state = awardPendingChest(state, { passed: true, score: scorePercent }, rng);
}
// === end V4 W2 hooks ===
```

`rng` = `env.RNG` if exists else `Math.random`. Allow injection cho tests.

`hasSpeakActivity`, `activityResults`, `passed`, `scorePercent`, `completedAt`, `code`, `request` đều đã có trong scope hiện tại — Codex tìm + reuse, KHÔNG đổi variable names.

## 6. API endpoints

### `functions/api/read2lead-quest-claim.js`

```js
import { claimQuestReward, vietnamDateKey, normalizeProgressState } from './_read2lead-v2-state.js';

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid_json', 400); }
  const code = String(body.code || '').trim().toUpperCase();
  const questId = String(body.quest_id || '').trim();
  if (!code || !questId) return jsonError('missing_params', 400);

  const raw = await env.R2L_STATE.get(`progress:${code}`, 'json');
  if (!raw) return jsonError('code_not_found', 404);
  const state = normalizeProgressState(raw, code, /* profile */ {}, /* legacy */ {});
  const dateKey = vietnamDateKey();
  const { state: newState, reward, error } = claimQuestReward(state, questId, dateKey, code);
  if (error) return jsonError(error, 400);

  await env.R2L_STATE.put(`progress:${code}`, JSON.stringify(newState));
  return new Response(JSON.stringify({ ok: true, reward, daily_quests: newState.daily_quests, coins: newState.coins }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(code, status) {
  return new Response(JSON.stringify({ ok: false, error: code }), { status, headers: { 'Content-Type': 'application/json' } });
}
```

### `functions/api/read2lead-chest-open.js`

```js
import { consumePendingChest, vietnamDateKey, normalizeProgressState } from './_read2lead-v2-state.js';

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid_json', 400); }
  const code = String(body.code || '').trim().toUpperCase();
  if (!code) return jsonError('missing_code', 400);

  const raw = await env.R2L_STATE.get(`progress:${code}`, 'json');
  if (!raw) return jsonError('code_not_found', 404);
  const state = normalizeProgressState(raw, code, {}, {});
  const dateKey = vietnamDateKey();
  const { state: newState, reward, error } = consumePendingChest(state, dateKey, code);
  if (error) return jsonError(error, 400);

  await env.R2L_STATE.put(`progress:${code}`, JSON.stringify(newState));
  return new Response(JSON.stringify({ ok: true, reward, coins: newState.coins, unlocked_parts: newState.unlocked_parts }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
// jsonError as above
```

### `functions/api/read2lead-daily-chest-claim.js`

```js
import { claimDailyLoginChest, previewDailyLoginChest, vietnamDateKey, normalizeProgressState } from './_read2lead-v2-state.js';

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  let body;
  try { body = await request.json(); } catch { return jsonError('invalid_json', 400); }
  const code = String(body.code || '').trim().toUpperCase();
  if (!code) return jsonError('missing_code', 400);

  const raw = await env.R2L_STATE.get(`progress:${code}`, 'json');
  if (!raw) return jsonError('code_not_found', 404);
  const state = normalizeProgressState(raw, code, {}, {});
  const dateKey = vietnamDateKey();
  const { state: newState, reward, error } = claimDailyLoginChest(state, dateKey);
  if (error) return jsonError(error, 400);

  await env.R2L_STATE.put(`progress:${code}`, JSON.stringify(newState));
  return new Response(JSON.stringify({ ok: true, reward, coins: newState.coins, preview: previewDailyLoginChest(newState, dateKey) }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

## 7. Tests

### `tests/read2lead-w2-state.test.mjs` — ≥18 tests

```
test('normalizeProgressState fills W2 defaults for old record without crash')
test('normalizeProgressState rebuilds daily_quests if date changed')
test('normalizeProgressState validates daily_quests ids against QUEST_IDS')
test('getDailyQuestsView returns 3 quests with target+progress+claimed+complete')
test('applyQuestProgress increments q1 on pack_passed if active')
test('applyQuestProgress increments q6 on second pack_passed (target=2)')
test('applyQuestProgress no-op if quest not in active ids')
test('applyQuestProgress clamps at target')
test('claimQuestReward adds coins + claimed flag')
test('claimQuestReward rejects already_claimed')
test('claimQuestReward rejects not_complete')
test('claimQuestReward applies RP bonus if reward.rp > 0')
test('awardPendingChest sets pending_chest with reward via Z3 mock')
test('awardPendingChest no-op if already pending')
test('awardPendingChest no-op if not passed')
test('consumePendingChest adds coins + part to unlocked_parts')
test('consumePendingChest duplicate path: coins only, no part add')
test('consumePendingChest triggers chest_opened quest event')
test('consumePendingChest trims chest_history at 50')
test('claimDailyLoginChest formula 5 + 2*min(streak,10)')
test('claimDailyLoginChest idempotent same day')
test('claimDailyLoginChest at streak=0 returns 5 coins')
test('claimDailyLoginChest at streak=15 caps at 25 coins')
test('previewDailyLoginChest returns available + coins preview')
test('recordComboBonus caps at COMBO_XU_CAP_PER_PACK=5')
test('recordComboBonus increments combo_lifetime_xu')
```

### `tests/read2lead-w2-submit-integration.test.mjs` — ≥8 tests

Use mocked KV (in-memory Map) + call submit handler logic via `applyPackCompletion` + W2 hooks:

```
test('submit pack_passed with score 90% awards chest + q1 + q2 progress')
test('submit pack_passed with score 60% awards chest + q1 only (no q2)')
test('submit failed pack no chest awarded')
test('submit second passed today increments q6 to 2')
test('submit speak activity completed → q3 progress')
test('submit perfect activity → q7 progress')
test('submit combo_xu=10 server caps to 5')
test('submit chest already pending → second pass does not overwrite')
```

### `tests/read2lead-w2-endpoints.test.mjs` — ≥9 tests

Mock `env.R2L_STATE` as Map. Use `onRequestPost` from each endpoint.

```
test('POST /read2lead-quest-claim claims complete quest → adds coins')
test('POST /read2lead-quest-claim invalid quest_id → 400')
test('POST /read2lead-quest-claim not complete → 400 not_complete')
test('POST /read2lead-quest-claim already claimed → 400 already_claimed')
test('POST /read2lead-chest-open opens pending → adds coins + part')
test('POST /read2lead-chest-open no pending → 400 no_pending_chest')
test('POST /read2lead-daily-chest-claim adds streak-scaled coins')
test('POST /read2lead-daily-chest-claim same day → 400 already_claimed_today')
test('Endpoints reject missing code → 400')
test('Endpoints handle missing KV key → 404')
```

## 8. Done when

1. State-core `_read2lead-v2-state.js` extends backward-compat (old records load + behave like W2 not started).
2. 8 exported helpers (`getDailyQuestsView`, `applyQuestProgress`, `claimQuestReward`, `awardPendingChest`, `consumePendingChest`, `claimDailyLoginChest`, `recordComboBonus`, `previewDailyLoginChest`).
3. `submit-read2lead-lesson.js` adds W2 hook block (quest events + chest award + combo cap), no logic changes elsewhere.
4. 3 new API endpoint files implemented + handle errors.
5. Tests ≥35 total across 3 test files, all green.
6. `node --test` toàn bộ xanh.
7. `npx astro check` không thêm error.
8. Branch `codex/w2-z1-state-core` pushed origin.
9. AGENT_LOG START + DONE với commit hash.
10. Report § AGENTS.md §4 + bundle size delta (state-core file should grow ~250 lines, acceptable).

## 9. Constraints (HARD)

- **KV state additive only.** Cấm rename/remove field cũ. Old records must read without crash.
- **`_read2lead-v2-state.js` là protected file** (xem hub AGENTS.md §1). Z1 thay đổi PHẢI giữ tất cả invariants cũ — rank ladder, season rollover, streak freeze, badges. CHỈ THÊM.
- **`submit-read2lead-lesson.js` cũng nóng** — KHÔNG refactor, KHÔNG đổi variable names, CHỈ thêm hook block tại đúng vị trí sau passed determination.
- **Z1 import Z2 + Z3 từ `./_read2lead-quests.js` + `./_read2lead-chests.js`.** Nếu 2 file đó chưa có khi Codex pull → STOP, báo Claude (đợi Wave 0 merge `v4-w2`).
- **No new npm dep.** Sử dụng helper functions có sẵn (`numberOrZero`, `vietnamDateKey`, etc.).
- **Combo cap server-side** — never trust client. Always `recordComboBonus` clamps.
- **Chest RNG seed**: dùng `Math.random` mặc định. Test inject deterministic LCG.
- **Migration safety**: chạy test với fixture của ít nhất 3 old record shapes (pre-V3, V3 only, V3+seasons) → cả 3 load thành công.

## 10. Wave dependency

1. **Wave 0 phải merge xong vào `v4-w2`** trước khi Z1 START:
   - Z2 `_read2lead-quests.js` merged
   - Z3 `_read2lead-chests.js` merged
2. Z1 branch off `origin/v4-w2` (NOT `main`).
3. Z4 + Z5 không cần Z1 ready trước (làm song song); integration test khi tất cả merged.

## 11. Report

Theo format AGENTS.md §4 + paste:
- `git log --oneline -5` (showing Z1 chain on top of v4-w2)
- `git status --short`
- `git log origin/codex/w2-z1-state-core -1`
- Test summary: ≥35/35 pass
- File diff stats (lines added per file)
- Backward compat verification: paste output of test loading 3 old-record fixtures successfully.
