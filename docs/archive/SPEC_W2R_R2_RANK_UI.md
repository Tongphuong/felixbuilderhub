# SPEC W2R-R2 — Rank UI: season banner, medal cabinet, cap hints, rank-jump

> Status: **READY**. Owner: Claude (spec+review) · 1 Cursor agent · Phương (acceptance).
> Branch: `w2r/r2-rank-ui` off `origin/main`. **Never push main.** Log START/DONE (+hash) in
> `docs/AGENT_LOG.md`. Zone = ONLY §4 files. Roadmap: V4 §4b. Runs in PARALLEL with R1 —
> build against the contract fixture in §2, do NOT wait for or edit functions/.

## 1. What to build (kid-facing, M0 voice everywhere)

1. **Season banner** (hub `/hoc-sinh` top, under HUD): theme emoji + "Mùa Khám Phá 🧭 · còn 23 ngày"
   + current season rank pill. Compact, one line on mobile.
2. **Medal cabinet** ("Tủ huy chương") on profile: one medal per past season — theme emoji + season
   name + peak rank label + coins earned. Empty state: "Mùa đầu tiên của con đang diễn ra — huy
   chương sẽ xuất hiện ở đây!" Render from `medals[]`, newest first, horizontal scroll on mobile.
3. **Cap lock hint**: when `season.ladder.capped === true`, show a friendly lock row under the rank
   display: 🔒 + `cap_unlock_hint_vi` from payload (e.g. "Lên Level 2 để mở khoá rank Bạch Kim!").
   This is motivation, not punishment — gold accent, never red.
4. **Rank-jump celebration**: when a state refresh shows tier_index increased by ≥2 since the last
   render (level-up lifted the cap), show the existing rank-up toast/modal with copy
   "Mở khoá rank mới! Con đã lên {label}!" — reuse the V3 rank-up component, no new modal system.
5. Season-end reward surfacing: if the state payload's `medals[0].ts` is newer than the locally
   stored last-seen medal ts (localStorage `r2l_last_medal_seen`), show a one-time congrats card:
   "Mùa {name_vi} khép lại — con đạt {peak_label_vi}, nhận {reward_coins} xu! 🎉".

## 2. Contract fixture (R1 owns this shape — code against it verbatim)

```json
"season": { "id": "2026-S1", "name_vi": "Mùa Khám Phá", "emoji": "🧭", "ends_at": "2026-08-31",
            "rp": 14, "ladder": { "tier_index": 1, "label_vi": "Bạc II", "stars": 1,
              "stars_per_division": 3, "stars_to_next": 2, "capped": false,
              "cap_unlock_hint_vi": null }, "peak_label_vi": "Bạc I" },
"medals": [ { "season_id": "2026-S0", "name_vi": "Mùa Khởi Đầu", "emoji": "🌱",
              "peak_label_vi": "Vàng II", "peak_tier_index": 2, "reward_coins": 35, "ts": "..." } ]
```

Missing/absent `season` (old backend during parallel dev) → render NOTHING new (feature degrades
invisibly; no broken UI). Put the fixture in the new test file as the canonical mock.

## 3. Hard rules

- Big tap targets, weak-3G friendly (no new images; emoji + CSS only).
- M0: no red, no "mất/tụt hạng" words anywhere. Reset copy = "mùa mới bắt đầu", never "bị reset".
- Flag: render only when `isW1Enabled()`/V3 flag path used by the kid hub already — same gate, no new flag.

## 4. Zone (ONLY these files)

`src/components/read2lead/**` (new SeasonBanner/MedalCabinet components) ·
`src/pages/hoc-sinh/**` · `src/scripts/r2l-w1-page.ts` · `tests/read2lead-rank-ui.test.mjs` (new).
Need other files (Header, lesson.astro, functions/) → STOP, report. lesson.astro is forbidden.

## 5. Tests (structural, style of existing tests/*.test.mjs)

- Hub page renders season banner + medal cabinet markup hooks.
- Capped ladder fixture → lock hint shown with payload text; uncapped → hidden.
- Missing `season` in payload → no season UI, no crash (assert guard exists).
- Medal congrats uses localStorage last-seen guard.
- Full `node --test` + `npx astro build` green.
