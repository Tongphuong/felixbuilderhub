# SPEC — Avatar geometry root fix: alpha-derived sockets & pivots (kills the arm bug class)

> Status: **READY**. Owner: Claude (spec + review) · **Codex** (implement, hub repo) · Phương (acceptance).
> Branch: `codex/avatar-geometry` off `origin/main`. **Never push main.** Log START/DONE (+commit
> hash) in `docs/AGENT_LOG.md`. Zone: ONLY §6 files. Monster zone reassigned Cursor → Codex for this task.

## 1. Why 6 "fix" commits didn't fix it (root cause, measured 2026-06-11)

Six commits in a row (52aca08 → 021d7c7) tuned numbers inside the same broken model. The model
itself cannot place arms correctly, for four measured reasons:

1. **Parts are anchored by their sprite CENTER, but the attachment point of an arm is at its
   EDGE.** Measured: `arm_blueA.png` is 82×176, tightly cropped, opaque to every edge. Center-
   anchoring it at the body's edge hides most of the arm behind the body; the visible leftovers
   are the floating "blobs" in Phương's screenshots. No fraction-tuning can fix this — the code
   simply does not know where the arm's shoulder is.
2. **The C/D "dual-arm" branch is built on a false premise.** `isDualArmSprite()` assumes
   `arm_*C/D.png` contain BOTH limbs and centers them on the body. Measured: `arm_blueC.png` =
   98×181, `arm_blueD.png` = 92×197 — single limbs. Every C/D arm is therefore pasted into the
   body's middle.
3. **One hand-tuned fraction table (tuned on round body A, 165×165) is applied to all 6 body
   shapes** (B 192×192 … E 132×250). Different silhouettes → the same fraction lands inside the
   body on one shape and in mid-air on another.
4. **Mirroring flips the image around its center (`scaleX(-1)`, transform-origin center) but not
   the attachment geometry** → the right arm is wrong whenever the left one is right, and vice
   versa ("sai vị trí trái phải").

And the meta-cause: **no automated contact check** — every fix was eyeballed on a few combos
(`_qa-*.png`), so regressions on the other combos were invisible. 6 shapes × ~15 arm styles =
90 combos; nobody eyeballs 90 images per change.

## 2. The fix: measure geometry from the PNGs, once, by script

Stop guessing with fractions. The PNG alpha channel knows where things attach.

### 2a. Geometry generator (extend `scripts/gen-monster-parts.mjs`)

Add `pngjs` as a **devDependency** (authorized; build-time only, nothing ships to the client).
For every part PNG, decode alpha and compute:

- **Bodies (per shape A–F; colors share geometry):**
  - `sockets.armLeft`  = leftmost opaque pixel at y = 58% of opaque height → `{x, y}`
  - `sockets.armRight` = rightmost opaque pixel at the same y → `{x, y}`
  (58% ≈ Kenney's natural shoulder line; one constant, NOT per-shape tuning.)
- **Arms (per style letter; colors share geometry):**
  - `facing`: compare opaque-pixel mass in the left vs right half — the attachment edge is the
    side with the WIDER vertical opaque span on its outermost column. Record `attach: 'left'|'right'`.
  - `pivot`: midpoint `{x, y}` of the opaque run on that attachment edge column.
- Write results into `monster-parts.json` as `geom: { w, h, pivotX, pivotY, attach }` per arm
  part and `sockets` per body shape. Deterministic output (stable ordering) so the manifest
  diffs cleanly.

### 2b. Compositor (`src/lib/monster-slot-layout.ts` + `monster-avatar.ts`)

Replace the arm path entirely (delete `isDualArmSprite`, `ARM_SINGLE_ANCHORS`, `ARM_DUAL_ANCHOR`,
`armSingleAnchors`, `armDualAnchor` and their dead code):

- Scale: `scale = ARM_HEIGHT_FRACTION * bodyBox.h / geom.h` with ONE global constant
  (start at 0.62 — Phương eyeballs final value on the QA sheet).
- Place LEFT arm: position the sprite so its **pivot lands on the body's `armLeft` socket pulled
  INWARD by `INSET = 0.06 * bodyBox.w`** (guaranteed overlap — arms can never detach again).
  If `geom.attach === 'left'` (sprite drawn as a right-side limb), flip first.
- Place RIGHT arm: flip the sprite (`scaleX(-1)`) **and mirror the pivot: `pivotX' = w − pivotX`**,
  then pin to `armRight` socket inset inward. Flip must use the placed box, not visual center
  guessing (set transform-origin so the flip happens in place: flip THEN position, or compute
  position with the mirrored pivot — the latter, it's pure math).
- Sockets/pivots scale with bodyBox exactly like the body sprite does (same fill-fit transform).
- Z-order: arms behind body (unchanged). Eyes/mouth/detail paths: unchanged in this task.

### 2c. Contact guarantee in tests (this is what ends the whack-a-mole)

Generator also writes `public/assets/monsters/monster-geom-qa.json`: for EVERY (body shape ×
arm style) combo, the computed placement + whether the placed arm's opaque box overlaps the
body's opaque silhouette by ≥ 4px in both axes. New test `tests/monster-arm-contact.test.mjs`
reads that JSON and **fails if any combo lacks contact or any right/left pair is asymmetric**
(|leftGap − rightGap| > 3px). 90 combos verified on every commit, no eyeballs needed.

Also regenerate the `_qa` contact sheet (one PNG grid of all 6 bodies × arms… if the existing
QA script supports it) for Phương's visual acceptance, and DELETE the stale `_qa-*.png` litter
from `public/assets/monsters/` (gitignore the pattern).

## 3. Compatibility

- Saved avatars reference part ids — ids don't change; only placement math does. No KV change.
- `normalizeAvatarMonster` untouched.
- If `geom`/`sockets` missing for a part (regen not run), compositor falls back to current
  behavior — never crashes.

## 4. Acceptance (Phương)

Builder: pick each of the 6 bodies, cycle 5+ arm styles each — arms touch the body at shoulder
height, left/right symmetric, on EVERY combo. Header/leaderboard/profile mini-renders look the
same as the builder.

## 5. Out of scope

Hats/pets/frames (W3), rarity/locks (W3), eyes/mouth/detail retuning, hue-rotate replacement (W3).

## 6. Zone (ONLY these files)

`src/lib/monster-slot-layout.ts` · `src/lib/monster-avatar.ts` · `scripts/gen-monster-parts.mjs` ·
`public/assets/monsters/monster-parts.json` + `monster-geom-qa.json` (generated) ·
`tests/gen-monster-parts.test.mjs` · `tests/monster-arm-contact.test.mjs` (new) ·
`package.json` (pngjs devDependency only) · `.gitignore` (_qa-*.png).
KHÔNG đụng: lesson.astro, functions/, hoc-sinh/, leaderboard (đang là zone của 3 Cursor W2R).
