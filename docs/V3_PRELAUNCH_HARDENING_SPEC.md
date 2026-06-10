# V3 PRE-LAUNCH HARDENING SPEC

**Author:** Claude (tech commander) · **Date:** 2026-06-10 · **Executor:** Cursor
**Goal:** Close the issues found in the deep review of the autonomous-week branches, so launch = just flip the flag. Nothing here is live; all on branches.

> Rules: follow `AGENTS.md` + `docs/V3_MASTER_EXECUTION.md` §0. Tests green before commit. Do NOT merge to `main`, do NOT flip `PUBLIC_R2L_V3`. Report hashes.

---

## H1 — Phase C: prevent double-charge on rapid "Buy"  ·  branch off `v3` → `v3-harden`
**Problem:** `read2lead-shop.js` does read-modify-write on KV with no lock; a double-tap "Mua" (or two concurrent buy requests) can both read coins before either writes → the same item is charged twice (coins deducted x2, inventory dedups to 1).

**Fix (two layers):**
1. **UI (must-have)** `src/pages/read2lead/shop.astro`: on Buy click, immediately disable that item's buy button (and show a tiny "Đang mua…") until the response returns; re-enable on error. Prevents the common double-tap.
2. **Server lock (recommended)** `functions/api/read2lead-shop.js`: wrap the load→purchase→save for a `buy` action with a short KV lock keyed `shoplock:{accessCode}` (TTL ~5s), mirroring the existing generation-lock pattern. If locked, return `{ ok:false, error:'busy', message:'Con đợi một chút rồi thử lại nhé!' }`. Release the lock after save (or let TTL expire). This serializes a kid's purchases.

**Tests:** extend `tests/read2lead-shop.test.mjs` — two purchases of the same item only deduct once total (the state fn already guards owned; assert the endpoint path doesn't double-deduct under the lock). Keep existing green.

---

## H2 — Phase E juice: confirm decision + robustness  ·  same `v3-harden`
**Decision (Claude):** the juice (confetti / synth sound / Minny mood / touch-order hint) **stays universal (NOT flag-gated)** — it's low-risk polish that benefits all kids, and the touch-order hint is a real mobile fix everyone should get. Keep `window.__r2lJuice` wired unconditionally. No gating change.

**Robustness check (do this):** in `src/lib/lesson-juice.ts`, ensure the confetti functions (`fireStreakConfetti`, `fireLessonPassConfetti`) **early-return on `prefers-reduced-motion`** and **dynamic-import `canvas-confetti`** (so it never enters the main bundle), exactly like `rank-up-celebration.ts`. If either guard is missing, add it. `playSynthTone` already respects `muted` — leave it. No other change.

---

## H3 — BL-1: null-guard the cached attempt  ·  branch `v3-fixes` (where BL-1 lives)
**Problem:** in `submit-read2lead-lesson.js` → `respondFromCachedAttempt`, if `attempt` resolves to `null` (no `web_lesson_summary` and no passing entry found), `attempt.score_percent` throws.

**Fix:** after resolving `attempt`, guard:
```js
if (!attempt) {
  return json({ ok: true, schema_version: 2, already_completed: true, passed: false,
    message: 'Con đã hoàn thành bài này rồi.' });
}
```
(place before reading `attempt.score_percent`). Add a test for the null path. Keep existing green. Commit on `v3-fixes`.

---

## H4 — Backend BL-B1/B2 (server.py)  ·  backend repo, branch `v3-fixes-backend`, HOLD for review
Lower priority; do if time allows.
- **BL-B1:** in `_run_generation_task_v2` after `generate_pack_v2(...)`, add `if not isinstance(pack, dict): raise ValueError("LLM returned non-dict pack")` so the retry path triggers cleanly instead of an AttributeError downstream.
- **BL-B2:** in `_publish_task_state`, the `urllib.request.Request` body is consumed after the first send; **rebuild the Request inside the retry loop** (or re-assign `req.data = body`) so the retry actually re-sends the body.
`pytest tests/ -q` green. Commit on `v3-fixes-backend`. Do NOT merge to main.

---

## Sequencing
1. `v3-harden` off `v3`: H1 + H2 → tests green → push → merge to `v3`.
2. `v3-fixes`: H3 → tests green → push.
3. Backend `v3-fixes-backend`: H4 → pytest green → push.
All HOLD for Claude review before any merge to `main` / before launch.

## 5× audit (delta)
1. **Correctness:** H1 lock mirrors an existing pattern; H1 state fn already idempotent on owned → lock only closes the same-item concurrent window. H3 is a pure guard. H4 makes failures explicit. ✅
2. **Live-data:** all additive/guarding; no schema change; nothing to `main`. ✅
3. **UX:** H1 button-disable + "đang mua" is clearer for kids; juice stays for everyone (H2). ✅
4. **Risk:** H1 lock could briefly block a kid (5s TTL) on lock-write failure — acceptable vs double-charge. Confetti dynamic import keeps bundle lean. ✅
5. **Maintainability:** small, isolated, tested, revertible. ✅
