# V3 PHASE B — Rank Ladder (Liên Quân style) · SPEC

**Author:** Claude (tech commander) · **Date:** 2026-06-09 · **Executor:** Cursor
**Repo:** felixbuilderhub (hub) · **Branches:** `v3/b-rank-core` (Z2) → then `v3/b-rank-ui` (Z3)
**Flag:** UI behind `R2L_V3`. State-core is a pure additive computation (safe on main).

> **Goal:** Replace the dopamine-dead rank (rank == learning level, advances ~4× ever) with a Liên Quân-style ladder that advances **every 1-2 packs**, decoupled from learning level, with **no demotion** (kid-positive). This is the single highest-leverage dopamine fix in V3.

---

## 1. Core principle — TWO separate axes

| Axis | What it is | Driven by | Speed |
|---|---|---|---|
| **Reading level** L1-L5 | content difficulty | XP / mastery (existing) | slow (curriculum) |
| **Rank** (NEW) | prestige / progress candy | packs completed + scores | fast (every pack moves it) |

A child at L1 can climb Đồng → Bạc → Vàng just by playing — rank is "how much you've achieved," level is "how hard your content is." Never conflate them again.

---

## 2. The ladder

8 tiers; each of the first 7 has 3 divisions (III → II → I); the top is an apex. Promotion by **stars**; **no demotion, no star loss** (Minny M0: celebrate effort, never punish).

| tier_index | Tier (VI) | EN | divisions | color (CSS, no art needed yet) |
|---|---|---|---|---|
| 0 | Đồng | Bronze | III, II, I | `#cd7f32` |
| 1 | Bạc | Silver | III, II, I | `#c0c0c0` |
| 2 | Vàng | Gold | III, II, I | `#ffd700` |
| 3 | Bạch Kim | Platinum | III, II, I | `#4fd1c5` |
| 4 | Kim Cương | Diamond | III, II, I | `#5b8def` |
| 5 | Tinh Anh | Elite | III, II, I | `#a855f7` |
| 6 | Cao Thủ | Master | III, II, I | `#ef4444` |
| 7 | Thách Đấu | Challenger | apex (no divisions) | gold gradient |

### Star / point math (single cumulative number → full display)

- **rank_points (RP):** cumulative, never decreases. Per completed pack: `1 + (score_percent >= 80 ? 1 : 0)` → **1-2 RP/pack** (rewards effort AND quality).
- 1 RP = 1 star. **3 stars per division. 3 divisions per tier = 9 RP per tier.**
- Derivation from cumulative `P`:
  - If `P >= 63` (7 tiers × 9): **Thách Đấu** apex; `apex_points = P - 63` (for leaderboard ordering).
  - Else: `tier_index = floor(P/9)`; `within = P % 9`; `division = [III,II,I][floor(within/3)]`; `stars = within % 3` (out of 3); `stars_to_next = 3 - stars`.
- **Cadence:** a star every pack (visible progress always); a **division-up every ~2-3 packs**; a tier-up every ~6-9 packs. Reaching Thách Đấu ≈ 42-63 packs. Tunable via the RP formula.

### Source of RP (derived — NO migration, live-data safe)

`rank_points` is **computed from existing data**, not a new stored field:
```
rank_points = Σ over completed packs of ( 1 + (pack.score_percent >= 80 ? 1 : 0) )
```
Use whatever per-pack score history already exists (`pack_history` / `web_attempts`). If a past pack has no stored score, count it as **1 RP**. This means every existing student instantly gets a fair rank from their real history — no reset, no migration, backward-compatible by construction. (Optional: cache the computed number in state on write, but it must always be re-derivable.)

---

## 3. Z2 — State-core (land FIRST, on `v3/b-rank-core`)

**File:** `functions/api/_read2lead-v2-state.js` (+ its test). This zone is shared with Phase C — do it first, merge to `v3`, then B-UI and C can branch.

**Add a pure function** `computeRankLadder(state)` returning:
```js
{
  rank_points: 14,
  tier_index: 1,
  tier_name_vi: 'Bạc',
  tier_name_en: 'Silver',
  tier_color: '#c0c0c0',
  division: 'II',          // 'III' | 'II' | 'I' | null (apex)
  stars: 2,                // filled stars in current division (0-3)
  stars_per_division: 3,
  stars_to_next: 1,        // stars until next promotion
  is_apex: false,
  apex_points: 0,          // RP beyond Thách Đấu entry, for leaderboard
  label_vi: 'Bạc II'       // display string ('Thách Đấu' at apex)
}
```
Plus a helper `rankPointsFromHistory(state)` implementing the RP formula above.

**Expose it** in the responses that already return student state (e.g. `loadProgressState` consumers / `read2lead-progress.js` / the submit response `read2lead_state`) as `state.rank_ladder = computeRankLadder(state)`. Keep the OLD `rank_title`/`rank_asset_url` fields untouched (don't break existing consumers) — the new UI reads `rank_ladder`.

**Rank-up signal for the submit flow:** in `submit-read2lead-lesson.js`, after awarding a pack, compute `rank_ladder` BEFORE and AFTER and include in the response:
```js
rank_up: { changed: true|false, from_label: 'Bạc III', to_label: 'Bạc II', tier_changed: false }
```
so the lesson page can fire a celebration when `changed` is true.

**Constraints:** additive only. Do NOT alter LEVELS, XP, level-up logic, or lower any floor. Pure new computation + new response fields.

**Tests (`tests/` node):**
- RP math: P=0 → Đồng III 0★; P=2 → Đồng III 2★; P=3 → Đồng II 0★; P=8 → Đồng I 2★; P=9 → Bạc III 0★; P=63 → Thách Đấu apex; P=70 → apex, apex_points=7.
- `rankPointsFromHistory`: 3 packs (scores 90, 50, 85) → 1+1 + 1 + 1+1 = 5 RP.
- No-demotion: function is monotonic in P (more packs never lowers rank).
- Existing student record (old shape, no scores) → ranks from pack count, no crash.

---

## 4. Z3 — Rank UI (after Z2 merges, on `v3/b-rank-ui`, behind `R2L_V3`)

**No image assets required to start** — render badges in CSS (tier color + tier name + division + a row of filled/empty stars). Phương can swap in custom emblem art later.

1. **`src/components/read2lead/v3/rank/RankBadge.astro`** — shows tier color chip, `label_vi` (e.g. "Bạc II"), and `stars/stars_per_division` as ⭐ filled vs ☆ empty. A compact variant for the lesson header, a large variant for the profile.
2. **Profile/review page** (`review.astro`): show the large RankBadge + a progress line "Còn {stars_to_next} sao nữa lên {next label}" + the full ladder (all 8 tiers, current highlighted) so kids see what's ahead.
3. **Lesson header**: replace the old level-as-rank chip with the compact RankBadge (gated by `R2L_V3`; if flag off, keep current). Show reading level separately as a quiet "Cấp độ đọc: L2" — NOT as a rank.
4. **Rank-up celebration:** when submit response has `rank_up.changed`, show a celebratory modal/burst: "Lên hạng! {to_label} ⭐" with Minny cheering (M0 voice: "Tuyệt vời! Con lên {to_label} rồi!"). Tier-up (`tier_changed`) = bigger celebration.
   - **Use `canvas-confetti`** (first adopted V3 dependency — see V3_ROADMAP.md §4b) for the burst: a normal confetti pop on division-up, a bigger/longer burst in the tier's color on `tier_changed`. Install via npm; import only in this rank-up component (not in the global lesson bundle). Respect `prefers-reduced-motion` (skip confetti, keep the modal).
   - Full Minny animation polish comes in Phase E; the confetti + modal is enough to make B feel great now.

**Minny voice (M0) for rank-up:** xưng Minny/con, celebrate effort, 1-2 câu, no FOMO. e.g. "Con vừa lên {to_label}! Minny tự hào quá." Never "you must rank up" / no countdown pressure.

**Flag:** every Z3 UI change checks `R2L_V3` (from `src/config/flags.ts`). Off in production until Phương approves on preview.

---

## 5. Deploy & sequence
1. `v3/b-rank-core` (Z2) → tests green → merge to `v3`. (Safe to reach `main` later even with flag off — it's additive state computation; old UI ignores `rank_ladder`.)
2. `v3/b-rank-ui` (Z3) off updated `v3` → preview URL → Phương reviews feel → iterate → merge to `v3`.
3. Phương promotes `v3 → main` and flips `PUBLIC_R2L_V3=1` when B (and the slice it ships with) is ready.

---

## 6. 5× AUDIT (5 lenses)

1. **Correctness / regression** — Z2 is purely additive (new function + new response fields); old `rank_title`/level/XP untouched; rank derived from existing data so **zero migration** and old records can't break (missing scores → 1 RP). Monotonic by construction (no demotion bug possible). ✅
2. **Pedagogy / behaviour** — frequent rank-ups + score bonus (≥80% = 2 RP) reward both effort and doing well, nudging quality without punishing failure. Decoupling means struggling readers still feel progress. ✅
3. **Kid/parent UX** — a star every pack = constant visible win; the visible full ladder creates "just one more"; no demotion avoids the #1 kid-demotivator. CSS badges = ships now, art later. ✅
4. **Risk / failure modes** — (a) live data: derived, additive, no migration → safe. (b) Performance: `rankPointsFromHistory` iterates a student's own pack history (small) — O(packs), fine. (c) Double-count: rank is derived from completed packs, so the existing double-submit bug (BL-1) could inflate RP — note: fix BL-1 alongside or accept until F. Flag this. (d) Flag-gated UI → no prod exposure until ready. ✅
5. **Maintainability / testability** — pure function, fully unit-testable (math table), revertible; UI isolated in `v3/rank/*`. ✅

**Audit refinements folded in:** (a) keep old rank fields to avoid breaking consumers; (b) CSS badges so no asset dependency blocks the build; (c) cross-flag with BL-1 (double-submit) since rank now reads pack history — recommend shipping BL-1 before turning the flag on, else a double-tap inflates rank.

---

## 6b. FIX (post-verify) — persist monotonic rank_points (no demotion past 50 packs)

**Bug found in review:** `rankPointsFromHistory` derives RP from `pack_history`, which is capped at 50 entries. When a kid does pack #51, the oldest drops off — if it was a 2-RP (high-score) pack and the new one is 1-RP, total RP DECREASES → **rank demotion**, breaking the no-demotion promise. Dormant while the flag is off and kids have <50 packs, but must fix before flag-on.

**Fix (additive, monotonic, backward-compatible):**
1. Store a cumulative `rank_points` on state that ONLY increments.
2. In `applyPackCompletion`, **inside the newly-completed branch only** (NOT the `already_counted` path — keeps it double-submit safe), increment:
   ```
   earnedRp = 1 + (scorePercent != null && Number(scorePercent) >= 80 ? 1 : 0)
   base = (state.rank_points != null && Number.isFinite(Number(state.rank_points)))
            ? Number(state.rank_points)
            : rankPointsFromHistory(state)   // backfill old records from history (before this pack)
   state.rank_points = base + earnedRp
   ```
3. `computeRankLadder(state)`: if `state.rank_points` is a finite number, use it; else fall back to `rankPointsFromHistory(state)`. (Stored cumulative wins; old records still derive a fair starting rank, then persist forward.)
4. Test: completing a low-score pack #51 after 50 high-score packs must NOT lower `rank_points` (monotonic across real completions, not just monotonic in P).

This also closes the BL-1 interaction (rank can't be inflated by a double-tap, because the increment lives only in the not-already-counted branch).

## 7. Open decisions for Phương (review on preview, not blocking the build)
- Tier emblem ART (CSS placeholder ships first; custom art later — Phương's pick).
- RP cadence tuning (1-2 RP/pack) — adjustable after Phương feels the pace on preview.
- Whether reading level stays visible at all in the lesson header or moves entirely to the profile.
