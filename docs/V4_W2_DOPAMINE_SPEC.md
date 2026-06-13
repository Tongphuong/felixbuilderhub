# V4 W2 — Dopamine Loop Core · Master Spec

**Author:** Claude · **Date:** 2026-06-13 · **Status:** READY (decision gates open)
**Branches:** `v4/w2-z1` … `v4/w2-z5` off `origin/main` · **Integration:** `v4-w2`
**Flag gate:** `PUBLIC_R2L_W1` (re-use, not new flag — V4 §1 rule)

> Extends V4_REBUILD_ROADMAP.md §4. Builds the Liên Quân loop on top of V3 rank + V4 W1 game shell:
> every action = feedback, every session = a prize, every day = a reason to return.

---

## 1. Goal & success

**Functional:**
- Each passed pack awards a **chest** (visual opening on result screen).
- 3 daily quests visible on profile + lesson HUD; complete → bonus xu/RP.
- Combo counter ×2/×3 inside activities; max +5 xu bonus/pack server-capped.
- 1 daily login chest claimable from profile.
- Near-miss banner when `stars_to_next === 1` at result.
- Audio: Howler.js + Kenney sounds (chest crack, coin clink, button tap), <200KB total, lazy-loaded after first interaction, mute toggle persisted.

**Non-functional:**
- All state additive on `progress:<code>`; old records read without crashing.
- Lesson bundle gets ZERO new inline code — everything through `window.__r2lJuice` or dynamic import.
- Audio + chest animation lazy-loaded; first-paint bundle unchanged.
- No real money, no countdown punish, no rank demotion.
- Tests green: `node --test`, `npx astro check` no NEW errors.

**Done when:**
1. Pass a pack → result screen shows chest-opening 3-stage animation → reveal xu/part → confetti.
2. Profile shows 3 daily quests with progress bars + 1 daily login chest button.
3. Combo counter shows ×2/×3 inside activities as kid gets streak of correct answers.
4. Near-miss banner fires when 1 star left to next rank.
5. Sound on (default) → chest crack + coin clink audible; mute persisted.
6. Old `progress:<code>` records (no quest/chest fields) load + behave like quests not started yet.

---

## 2. Decision gates (Phương quyết — em đề xuất default)

### G1. Quest options — pick 3 rotating from 8 (Claude drafts; Phương locks)

| # | Vietnamese label | Trigger | Reward |
|---|---|---|---|
| Q1 | Xong 1 bài học hôm nay | 1 pack passed | +10 xu |
| Q2 | Trên 80% chính xác trong 1 bài | passed pack with score ≥80% | +15 xu, +1 RP |
| Q3 | Làm phần Nói lại trong 1 bài | speak activity completed | +12 xu |
| Q4 | Đúng 5 câu liên tiếp trong 1 bài | combo ≥5 in any activity | +10 xu |
| Q5 | Mở 1 rương | chest opened (auto-counts) | +5 xu |
| Q6 | Xong 2 bài học hôm nay | 2 packs passed | +20 xu, +1 RP |
| Q7 | Hoàn thành 1 hoạt động không sai | any activity score 100% | +15 xu |
| Q8 | Học liên tục 3 ngày (streak) | streak day ≥3 today | +25 xu |

**Default rotate logic:** `hash(date_key + access_code) → pick 3 indices`. Đảm bảo 3 quest khác nhau mỗi ngày, deterministic, không cần KV write trước lúc render.

→ **Phương quyết:** danh sách lock 3 quest active (hoặc cho rotate full 8)? Có thay đổi nội dung label nào không?

### G2. Chest odds (server-side RNG, transparent)

| Rarity | Odds | Reward | Note |
|---|---|---|---|
| Common | 70% | 10-20 xu (random) | mặc định |
| Rare | 25% | 25-40 xu + 1 random part unlock | duplicate part → auto-convert thành 30 xu |
| Epic | 5% | 50 xu + 1 rare part (filter rarity≥rare) | duplicate part → auto-convert thành 60 xu |

→ **Phương quyết:** odds này OK? Hay nâng rare lên 30%/epic 7% để kid happy hơn?

### G3. Combo cap

V4_REBUILD_ROADMAP §4: "max +5 xu bonus/pack server-capped". Em đề xuất:
- Combo bậc: ×2 sau 3 correct liên tiếp, ×3 sau 6 correct.
- Bonus xu: 1 xu / correct trong combo bậc ×2, 2 xu / correct trong bậc ×3, **CAP 5 xu/pack**.
- Wrong answer = reset combo về 0.

→ **Phương quyết:** OK hay đổi ngưỡng?

### G4. Daily login chest

Em đề xuất: 5 xu base + 2 xu × min(streak, 10) — tức tối đa 25 xu nếu kid streak ≥10 ngày. Claim 1 lần / ngày từ profile. Reset bằng `vietnamDateKey`.

→ **Phương quyết:** Hay simpler — 5 xu cố định?

### G5. Audio assets pick

Em đề xuất từ Kenney CC0:
- `chest-shake.mp3` (kenney.nl/assets/casino-audio) ~30KB
- `chest-crack.mp3` ~25KB
- `coin-clink.mp3` (kenney.nl/assets/interface-sounds) ~10KB
- `quest-complete.mp3` ~15KB
- `combo-tick.mp3` ~8KB
- `near-miss.mp3` (subtle harp/chime) ~12KB
- `daily-chest-claim.mp3` ~20KB
- Total ~120KB, lazy-loaded.

→ **Phương quyết:** Em download + commit luôn? Hay anh muốn nghe trước để chọn?

---

## 3. Architecture

```
┌───────────────────────────────────────────────────────────────┐
│ progress:<code> KV (additive fields)                          │
│  + daily_quests: { date, ids: [q1,q3,q7], progress: {q1: 0..} │
│  + chest_history: [ {opened_at, rarity, reward} ]             │
│  + pending_chest: { rarity, reward } | null                   │
│  + daily_login_chest: { last_claim_date }                     │
│  + combo_lifetime_xu: integer (cumulative for stats)          │
└───────────────────────────────────────────────────────────────┘
                          ▲
                          │ additive read/write
                          │
┌──────────────────────┬───┴──────────────────┬──────────────────┐
│ Z1 state-core        │ Z2 quests engine     │ Z3 chest RNG     │
│ _read2lead-v2-state  │ _read2lead-quests.js │ _read2lead-      │
│   .js (extend)       │   (new)              │   chests.js (new)│
│ submit-…lesson.js    │                      │                  │
│   (chest award)      │                      │                  │
└──────────┬───────────┴──────────┬───────────┴────────┬─────────┘
           │                      │                    │
           ▼                      ▼                    ▼
┌────────────────────────────────────────────────────────────────┐
│ Hub UI (Astro + client TS)                                     │
│  Z4 components: QuestCard, ChestBox, ChestOpening,             │
│                 ComboCounter, NearMissBanner,                  │
│                 DailyLoginChest                                │
│  Z5 lesson juice: lesson-juice.ts (extend), lesson-result-     │
│                   chest.ts (new), lesson.astro (only hooks)    │
│  Z6 audio: r2l-audio.ts (new — Howler wrapper)                 │
└────────────────────────────────────────────────────────────────┘
                          ▲
                          │ load lazy after first user interaction
                          │
                          └── audio/kenney/*.mp3
```

---

## 4. State schema (additive — non-negotiable)

Append to `progress:<code>` (Z1 owns):

```js
{
  // ... existing V3 fields ...

  daily_quests: {
    date: '2026-06-13',          // VN date key
    ids: ['q1', 'q3', 'q7'],     // 3 picked by hash(date+code)
    progress: { q1: 0, q3: 1, q7: 0 },  // 0..target per quest
    claimed: { q1: false, q3: false, q7: false },
  },

  pending_chest: null,            // or { rarity: 'rare', reward: { coins: 28, part_id: 'png-default-detail-blue-horn-large' } }
  chest_history: [                // last 50 (FIFO trim)
    { opened_at: '2026-06-13T10:23:00.000Z', rarity: 'common', reward: { coins: 14 } },
  ],

  daily_login_chest: {
    last_claim_date: '2026-06-12',  // VN date key
  },

  combo_lifetime_xu: 47,          // cumulative xu earned via combo (stats only)
}
```

**Read defaults** (Z1 must provide for old records):

```js
daily_quests: { date: vietnamDateKey(), ids: pickQuests(date, code), progress: {}, claimed: {} }
pending_chest: null
chest_history: []
daily_login_chest: { last_claim_date: null }
combo_lifetime_xu: 0
```

---

## 5. Zone breakdown (5 sub-specs, 5 song song agent)

| Zone | Owner type | Files (exclusive) | Spec file |
|---|---|---|---|
| **Z1 state-core** | Codex | `functions/api/_read2lead-v2-state.js` (extend), `functions/api/submit-read2lead-lesson.js` (chest award + quest progress write), tests | `docs/V4_W2_Z1_STATE_CORE_SPEC.md` |
| **Z2 quests engine** | Cursor #1 | `functions/api/_read2lead-quests.js` (new), tests | `docs/V4_W2_Z2_QUESTS_SPEC.md` |
| **Z3 chest RNG** | Cursor #2 | `functions/api/_read2lead-chests.js` (new), tests | `docs/V4_W2_Z3_CHESTS_SPEC.md` |
| **Z4 UI components** | Cursor #3 | `src/components/read2lead/v4/QuestCard.astro` (new), `ChestBox.astro` (new), `ChestOpening.astro` (new), `ComboCounter.astro` (new), `NearMissBanner.astro` (new), `DailyLoginChest.astro` (new), tests | `docs/V4_W2_Z4_UI_COMPONENTS_SPEC.md` |
| **Z5 lesson juice + audio** | Codex (touches lesson.astro carefully) | `src/lib/lesson-juice.ts` (extend), `src/lib/lesson-result-chest.ts` (new), `src/lib/r2l-audio.ts` (new — Howler wrapper), `src/pages/read2lead/lesson.astro` (chỉ thêm 2-3 hook lines), `public/audio/kenney/*.mp3` (8 files), tests | `docs/V4_W2_Z5_LESSON_JUICE_AUDIO_SPEC.md` |

**Z1 phải LAND TRƯỚC** (vì Z2/Z3 cần helpers từ state-core). Sau khi Z1 merge `v4-w2`, Z2/Z3/Z4/Z5 chạy song song.

→ Wave plan:
- **Wave A (serial):** Z1 → merge `v4-w2`
- **Wave B (parallel, 4 agents):** Z2 ‖ Z3 ‖ Z4 ‖ Z5 → all merge `v4-w2`
- **Final:** Claude rebase `v4-w2 → main` (flag-gated), Phương promote.

---

## 6. API contract giữa các zone (đông cứng — sub-specs phải tuân)

### Z1 exports cho các zone khác

```ts
// from _read2lead-v2-state.js
export function getDailyQuests(state, dateKey, code): { ids, progress, claimed };
export function applyQuestProgress(state, eventName, params): state;
//   eventName: 'pack_passed' | 'pack_passed_high_score' | 'speak_completed' | 'combo_reached' | 'chest_opened' | 'streak_day'
export function awardPendingChest(state, packResult): state;  // calls Z3 internally
export function consumePendingChest(state): { state, reward };
export function claimDailyLoginChest(state, dateKey): { state, reward, alreadyClaimed };
export function recordComboBonus(state, comboXu): state;
```

### Z2 exports cho Z1

```ts
// from _read2lead-quests.js
export const QUEST_DEFS;  // { q1: {label_vi, target, reward, trigger}, ... q8 }
export function pickDailyQuestIds(dateKey, code): [string, string, string];
export function questCompleted(quest, progress): boolean;
export function questReward(questId): { coins, rp };
```

### Z3 exports cho Z1

```ts
// from _read2lead-chests.js
export const CHEST_ODDS;  // { common: 0.7, rare: 0.25, epic: 0.05 }
export const CHEST_REWARDS;  // amount ranges
export function rollChest(seed): { rarity, reward };  // seed = Date.now()+code if no replay needed
export function autoConvertDuplicate(reward, ownedPartIds): reward;
```

### Z4 (UI) consumes from Z1 via API endpoints (no direct state access)

- `GET /api/_read2lead-v2-state?code=X` returns state including new fields → existing endpoint, Z1 extends response.
- `POST /api/read2lead-chest-open` → consume pending_chest (Z1 helper).
- `POST /api/read2lead-quest-claim?qid=q1` → claim quest reward (Z1 helper).
- `POST /api/read2lead-daily-chest-claim` → claim login chest (Z1 helper).

### Z5 (lesson juice) consumes from Z4 components via `window.__r2lJuice` extensions

```ts
window.__r2lJuice = {
  // existing
  playSynthTone, fireStreakConfetti, fireLessonPassConfetti,
  // new from Z5
  playKenney(name): void,                       // 'chest-crack' | 'coin-clink' | ...
  showXpTicker(xpDelta, anchorEl): void,
  showComboBadge(level): void,                  // 1 = off, 2 = ×2 visible, 3 = ×3
  openChest(pendingChest): Promise<void>,       // 3-stage animation, resolves after reveal
  showNearMissBanner(text): void,
  setMuted(boolean): void,
  isMuted(): boolean,
};
```

---

## 7. Lesson hook integration (Z5 owns these touchpoints)

Z5 sẽ add MAX 5 hook lines vào `lesson.astro`, KHÔNG inline logic:

```ts
// in lesson.astro at result-screen render path:
import { renderResultChest } from '../../lib/lesson-result-chest';
await renderResultChest(passResult, state.pending_chest);

// in activity correct-answer handler:
window.__r2lJuice?.showComboBadge?.(comboLevel);

// in submit handler:
window.__r2lJuice?.showXpTicker?.(xpDelta, '.r2l-score-summary');

// in result render, near-miss check:
if (rankLadder.stars_to_next === 1) {
  window.__r2lJuice?.showNearMissBanner?.(`Còn 1 sao nữa là lên ${rankLadder.next_label}!`);
}
```

That's ALL `lesson.astro` gets. Everything else lives in `src/lib/`.

---

## 8. Test plan (each zone owns)

- **Z1**: state defaults work for old record; daily_quests resets at VN date change; quest progress increments; pending_chest add/consume; daily login claim idempotent.
- **Z2**: pickDailyQuestIds deterministic; 3 unique; quest completed correctly per progress.
- **Z3**: rollChest distribution close to odds over 10000 rolls (±2%); duplicate auto-convert; epic never includes common parts.
- **Z4**: Astro components render with sample props; CSS animation triggers; KidModal binding.
- **Z5**: lesson-juice.ts extends `window.__r2lJuice` without breaking existing keys; lazy audio load happens after first interaction; mute persists in localStorage.

---

## 9. Verify protocol (when all 5 zones merged `v4-w2`)

1. Claude rebase `v4-w2 → main`, push (flag gated `PUBLIC_R2L_W1`).
2. Cloudflare preview build → Phương mở `/hoc-sinh` → see 3 quests + daily chest.
3. Phương làm 1 bài (preview env, test code) → result screen chest opens.
4. Phương check: combo visible? near-miss banner fires? audio plays? mute toggle?
5. Phương log P/F per checklist → Claude merge `v4-w2 → main` final.
6. **Backward compat**: Phương log in với code không có daily_quests field → không crash, render quest mới.

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Lesson bundle grows (Z5 lazy-load slip) | Z5 spec mandates dynamic import audio + chest animation; CI check `dist/` size delta |
| Chest RNG bias (seed collision) | Z3 spec mandates `crypto.getRandomValues` server-side, fallback `Date.now() ^ hash(code)` |
| KV write storm (3 quests × N kids check on each load) | Z1: quest progress write ONLY on quest-completing event, not on read |
| Combo cap bypass (client edits) | Z1: server validates combo_xu ≤ 5 in submit-…lesson.js, hard cap |
| Duplicate part drop feels bad | Z3 auto-convert to slightly higher xu (30 vs 14 common) → kid feels rewarded |
| Audio download fails on weak 3G | Z6 graceful degrade: visual chest still works without sound |

---

## 11. What this spec does NOT cover

- W3 avatar 2.0 / part rarity tags (just hooks `part_id` from chest — Z3 references existing manifest)
- W4 shop expansion
- W5 mini-games
- W6 profile redesign
- Personalization

These are downstream waves. W2 lays the **mechanic foundation**.

---

## 12. Decision gate ack required from Phương before agents START

| Gate | Decision needed | Em đề xuất |
|---|---|---|
| G1 | 3 quests lock hay rotate full 8? | Rotate full 8, daily pick 3 |
| G2 | Chest odds 70/25/5 OK? | Yes default |
| G3 | Combo cap 5 xu OK? | Yes, ×2 @3, ×3 @6 |
| G4 | Daily login chest formula | 5 + 2×min(streak,10), max 25 |
| G5 | Audio assets em download luôn? | Yes, em commit Kenney 8 files |

Anh ack 5 gate → em viết 5 sub-specs (Z1-Z5) → giao 5-6 agent chạy song song.
