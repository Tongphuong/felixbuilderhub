# V3 LAUNCH RUNBOOK — polish then go-live

**Author:** Claude (tech commander) · **Date:** 2026-06-10 · **For:** Cursor (polish) + Phương (the flag flip).

> Goal: bring `v3` fully up to date, close the last polish, ship to `main` flag-OFF, then flip the flag = LAUNCH. The flag flip is **instantly reversible** (flip back to 0), so launch risk is bounded.
> **Honest limit:** Claude verified code/structure/tests but CANNOT see rendered visuals. **Phương must glance at the preview once (step L2) before the flag flip** — that's the only unavoidable human gate.

---

## PART 1 — POLISH (Cursor, on `v3`)

### S1 — Sync `main` into `v3` (CRITICAL — do first)
`v3` is behind `main` (main has the audio/mic fixes, safe backlog, observability). Merge them in so launch doesn't regress live fixes and the eventual `v3→main` is clean.
```
git checkout v3 && git pull
git merge origin/main
```
Resolve conflicts — expected in `src/pages/read2lead/lesson.astro` (both branches edited it: main = audio/mic hardening; v3 = Phase E juice). **Keep BOTH sets of changes** (audio fixes AND juice). After resolving: `node --test` green, `npx astro check` no new errors. Commit the merge. Push `v3`.

### S2 — Bring BL-1 into `v3`
BL-1 (double-submit idempotency) lives on `v3-fixes`. Cherry-pick it (and its H3 null-guard if present) into `v3`:
```
git cherry-pick 632cb42   # BL-1 idempotent submit guard (+ any later null-guard commit on v3-fixes)
```
Resolve conflicts in `submit-read2lead-lesson.js` if any. `node --test` green. Push.

### S3 — Polish: shop buy double-charge (H1, must-have UI part)
In `src/pages/read2lead/shop.astro`: on Buy click, **immediately disable that item's button** (+ "Đang mua…") until the response returns; re-enable on error. (Server KV lock `shoplock:{accessCode}` in `read2lead-shop.js` is recommended but optional for launch — UI disable covers the common double-tap.) Test. Push.

### S4 — Polish: make the monster color picker visibly work
Kenney bodies have baked colors (blue/dark/green/red); the palette (mint/coral/sky/lemon/grape) currently only tints the CSS fallback. In `src/lib/monster-avatar.ts`, apply a CSS `filter` to the **real body PNG layer** based on `config.color` (map each palette color to a `hue-rotate(...) saturate(...)` so the body visibly tints). Verify the picker changes the monster. (If the tint looks muddy, leave a note — Phương may instead drop the color picker since bodies are pre-colored. Not a launch-blocker either way.)

### S5 — Final verify on `v3`
`node --test` all green; `npx astro check` no NEW errors (pre-existing TS-null hints OK). Confirm everything still gated behind `isV3Enabled()`. Push `v3`. **Report: all hashes + test result + the merge-conflict resolutions made.**

---

## PART 2 — GO LIVE (after Part 1 verified)

### L1 — Merge `v3` → `main` (flag still OFF → ships dark, safe)
```
git checkout main && git pull
git merge v3
node --test    # green
git push origin main
```
This deploys all V3 code to production **invisible to kids** (flag off). Live users unaffected. If `node --test` fails or conflicts are messy → STOP, report, do not push.

### L2 — Phương: 5-minute preview visual QA (REQUIRED before flip)
On the production URL with the override: `https://felixbuilderhub.com/hoc-sinh?v3=1` (or the `v3` preview). Check:
1. Monster renders — parts aligned (eyes/mouth on body, not floating)?
2. Build-a-monster: change body/eyes/mouth → preview updates? Change color → visibly changes?
3. Buy a hat → equip → **hat sits on the monster's head**? Buy a pet → shows beside?
4. Rank badge + rank-up (do a lesson) works; leaderboard shows small monster.
5. Nothing looks broken on mobile.

If anything looks wrong → DON'T flip; report to Claude with a screenshot.

### L3 — FLIP THE FLAG = LAUNCH
Cloudflare Pages → Settings → Environment variables → **Production** → set `PUBLIC_R2L_V3 = 1` → **Save & redeploy**. V3 is now live for all kids.

### L4 — Monitor (first hours/days)
- Watch **Sentry** for new errors, **Clarity** for confusion/rage-taps on the new screens.
- Watch generation/submit still work (rank/coins/shop write to KV).

### L5 — ROLLBACK (if anything is wrong)
**Instant:** set `PUBLIC_R2L_V3 = 0` in production → redeploy → V3 hidden again, everything back to pre-launch. No data loss (state is additive). Then fix on a branch and re-launch.

---

## Launch gate checklist (all must be ✅ before L3)
- [ ] S1 main merged into v3, conflicts resolved, tests green
- [ ] S2 BL-1 in v3
- [ ] S3 shop buy button-disable
- [ ] S4 color picker visibly works (or noted)
- [ ] S5 v3 tests green + astro no new errors + all gated
- [ ] L1 v3→main merged, tests green, pushed (flag off)
- [ ] L2 Phương preview QA passed (visual)
- [ ] then L3 flip flag
