# SPEC W2R-R1 — Rank core: quality stars, progressive tiers, level caps, seasons

> Status: **READY**. Owner: Claude (spec+review) · 1 Cursor agent (implement) · Phương (acceptance).
> Branch: `w2r/r1-rank-core` off `origin/main`. **Never push main.** Log START/DONE (with commit
> hash) in `docs/AGENT_LOG.md`. Zone = ONLY the files in §5. Roadmap context: V4 §4b.

## 1. Why

Measured inflation: 1-2 RP/pack, 9 RP/tier, apex 63 RP → Kim Cương in 9-18 days. Rank measures
grind, not skill. Locked fixes (Phương 2026-06-11): quality stars + progressive tier cost + daily
RP cap + tier cap by learning level + 2-month themed seasons with Liên Quân-style soft reset.

## 2. New rank math (constants in `_read2lead-v2-state.js`, one block)

```js
export const RANK_RP_PER_PACK = { below65: 0, from65: 1, from85: 2 }; // passed packs only (>=50%)
export const RANK_DAILY_RP_CAP = 3;            // VN date key (reuse vietnamDateKey)
export const RANK_TIER_COSTS = [9, 9, 12, 12, 15, 15, 15]; // Đồng..Cao Thủ; apex = sum = 87
export const RANK_TIER_CAP_BY_LEVEL = { L1: 2, L2: 3, L3: 4, L4: 6, L5: 7 }; // max tier_index reachable
```

- Divisions stay III/II/I; stars per division = tierCost/3 (3, 3, 4, 4, 5, 5, 5). The ladder payload
  already carries `stars_per_division` — it just stops being a constant.
- `buildRankLadderFromPoints` reworked for variable tier costs (cumulative thresholds), apex at 87.
- **Tier cap by level:** RP keeps accruing uncapped; the LADDER DISPLAY clamps at the cap for the
  student's `current_level`. Payload gains `capped: true|false` and `cap_unlock_hint_vi`
  ("Lên Level 2 để mở khoá rank Bạch Kim!"). On level-up the clamp lifts → client sees a rank jump
  (R2 renders the celebration).
- **No demotion, ever** (invariant — keep the existing monotonicity test passing).

## 3. Quality stars + daily cap (in `submit-read2lead-lesson.js`)

- On a passed submit: `rpEarned = scorePercent >= 85 ? 2 : scorePercent >= 65 ? 1 : 0`.
- Daily cap: `progress.rank_daily = { date_key, rp }` (additive field). If `rp >= 3`, award 0 RP
  (coins/XP/quests unchanged). Partial: cap to remainder.
- Persist `season_rp += awarded` and `lifetime_rp += awarded` (see §4). KEEP writing the legacy
  `rank_points` field = lifetime_rp (old clients/code read it; never remove).
- Response includes `rank_up` computed from season ladder before/after (existing computeRankUp).

## 4. Seasons (`functions/api/_read2lead-seasons.js`, new file)

```js
export const SEASONS = [
  { id: '2026-S1', name_vi: 'Mùa Khám Phá', emoji: '🧭', starts: '2026-07-01', ends: '2026-08-31' },
  { id: '2026-S2', name_vi: 'Mùa Phiêu Lưu', emoji: '🗺️', starts: '2026-09-01', ends: '2026-10-31' },
  // 2-month cadence; theme names are placeholders Phương can edit in this one file.
];
export function currentSeason(now = new Date()) { /* VN timezone; before 2026-07-01 → pre-season id '2026-S0' */ }
```

- State (additive on `progress:<code>`): `season = { id, rp, peak_tier_index, peak_label_vi }`,
  `lifetime_rp`, `medals: [{ season_id, name_vi, emoji, peak_tier_index, peak_label_vi, reward_coins, ts }]`.
- **Lazy rollover** — in the state-normalize path (where v2 state is already read+written on
  submit/state fetch): if `season.id !== currentSeason().id`:
  1. Freeze medal from `season.peak_*` into `medals[]` (skip if peak tier 0 and rp 0).
  2. Grant season reward coins by peak tier: `[10, 20, 35, 50, 70, 90, 120, 150]` (Đồng→Thách Đấu).
  3. Soft reset: `season.rp = cumulativeStartRP(max(0, peak_tier_index - 1))` — drop ONE tier,
     never below 0. (Liên Quân pattern: kế thừa, không về 0.)
  4. Set new `season.id`, reset `peak_*` to current post-reset position.
- **Migration at deploy (no kid demoted):** record without `season` → `lifetime_rp = rank_points`
  (or computed from history), `season.rp = lifetime_rp`, season id = current. First rollover later
  applies the soft reset naturally.
- Payload contract (state/submit responses) gains:

```json
"season": { "id": "2026-S1", "name_vi": "Mùa Khám Phá", "emoji": "🧭", "ends_at": "2026-08-31",
            "rp": 14, "ladder": { /* existing ladder shape + capped + cap_unlock_hint_vi */ },
            "peak_label_vi": "Bạc I" },
"medals": [ { "season_id": "2026-S0", "name_vi": "Mùa Khởi Đầu", "emoji": "🌱",
              "peak_label_vi": "Vàng II", "peak_tier_index": 2, "reward_coins": 35, "ts": "..." } ]
```

R2/R3 build against EXACTLY this shape — changing it requires Claude sign-off.

## 5. Level-up quality gate

Where pack-count level-up currently triggers (v2 state core): ALSO require average
`score_percent >= 70` over the last 5 passed packs (fewer than 5 → use what exists, min 3).
If count met but quality not: no level-up; payload gains
`level_gate_hint_vi: "Sắp lên Level rồi! Con luyện thêm cho điểm trung bình đạt 70% nhé."`
(M0: encouraging, no "fail"/red). Re-check on every subsequent pass.

## 6. Zone (ONLY these files)

`functions/api/_read2lead-v2-state.js` · `functions/api/_read2lead-seasons.js` (new) ·
`functions/api/submit-read2lead-lesson.js` · `tests/read2lead-rank-system.test.mjs` ·
`tests/read2lead-seasons.test.mjs` (new). Need another file → STOP, report.

## 7. Tests (extend existing style; all must pass + full `node --test` green)

- Tier costs: RP 0→Đồng III 0 sao; RP 30 = đỉnh Vàng; apex at 87; monotonic (never lowers).
- Quality stars: 64% → +0, 65% → +1, 85% → +2; unpassed pack → +0.
- Daily cap: 4 good packs same VN day → +3 RP only; next day resumes.
- Tier cap: L1 with RP 50 displays Vàng I capped:true + hint; same RP at L2 shows Bạch Kim.
- Rollover: S1 Kim Cương → medal appended + coins granted + season_rp = start of Bạch Kim; runs
  once (idempotent); pre-season records migrate without RP loss.
- Level gate: 5 packs avg 60% → no level-up + hint; avg 75% → level-up.
- Old records (no season fields) normalize without crash and WITHOUT losing rank.

## 8. Out of scope

UI (R2), leaderboard (R3), shop season items (W4), in-level difficulty ramp (backend repo).
Do NOT touch lesson.astro, recorder scripts, speaking-check API (Claude's zone).
