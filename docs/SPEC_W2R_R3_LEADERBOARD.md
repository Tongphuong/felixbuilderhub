# SPEC W2R-R3 — Leaderboard theo mùa + podium mùa trước

> Status: **READY**. Owner: Claude (spec+review) · 1 Cursor agent · Phương (acceptance).
> Branch: `w2r/r3-leaderboard` off `origin/main`. **Never push main.** Log START/DONE (+hash) in
> `docs/AGENT_LOG.md`. Zone = ONLY §4 files. Roadmap: V4 §4b. PARALLEL with R1/R2 — build against
> the same contract fixture (SPEC_W2R_R2 §2); degrade gracefully while backend lacks `season`.

## 1. What to build

1. **Season-scoped board**: rank students by `season.rp` (fallback: existing rank_points when the
   record has no season — transition period must not crash or mis-sort; treat missing season.rp as
   the legacy value so ordering stays stable).
2. **Theme header**: season emoji + name + "còn N ngày" countdown above the board.
3. **Previous-season podium**: top-3 of last season frozen at rollover. Source: when building the
   board, records carry `medals[]`; latest medal per student with `season_id == previousSeasonId`
   → sort by `peak_tier_index` then reward_coins. Show 🥇🥈🥉 + names + peak rank. If no data yet
   (first season), hide the block.
4. Keep the existing KV 5-min cache + rate limit exactly as-is (BL-2) — just include the new fields
   in the cached payload.
5. Display names/privacy: reuse the existing display-name masking — no new PII exposure.

## 2. M0 rules

Board copy stays effort-positive: no "bét bảng", no red. The board shows top N as today; never
show a child their exact low position — keep existing behavior for non-top students.

## 3. Hard rules

Weak-3G: no new assets; emoji + CSS. Same feature flag path the leaderboard already uses.

## 4. Zone (ONLY these files)

`functions/api/read2lead-leaderboard.js` · `src/pages/read2lead/leaderboard.astro` ·
`tests/read2lead-leaderboard.test.mjs` (extend; create if missing).
Need other files → STOP, report. Do NOT touch `_read2lead-v2-state.js` (R1's zone) — read fields
defensively instead.

## 5. Tests

- Sort uses season.rp when present, legacy rank_points otherwise (mixed records sort sanely).
- Podium renders from medals of previous season; hidden when none.
- Cache shape includes season fields; rate limiting untouched (existing tests stay green).
- Full `node --test` + `npx astro build` green.
