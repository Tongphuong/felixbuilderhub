# Design Handoff — Phase 1 Integration Audit Feedback

**Audit date:** 2026-06-18
**Integration branch:** `design/handoff-phase1` (HEAD `33ff1dc`)
**Auditor:** integration agent (5-lens audit before merge)

## Decision: ❌ DO NOT MERGE (yet)

`cursor-2/design-coaching` **FAILS Lens (b) COPY UNCHANGED**. Per the decision gate,
no branch was merged. `cursor-1/design-home` and `cursor-3/design-builder` are GREEN and
are ready to merge **as soon as cursor-2 is fixed and re-audited**.

---

## Per-branch 5-lens summary

| Branch | (a) Scope | (b) Copy | (c) Hex | (d) Responsive | (e) Focus ring | Verdict |
|---|---|---|---|---|---|---|
| cursor-1/design-home (`571a1b2`) | PASS | PASS | PASS | PASS | PASS* | ✅ GREEN |
| cursor-2/design-coaching (`e4b5e68`) | PASS | **FAIL** | PASS | PASS | PASS* | ❌ FAIL |
| cursor-3/design-builder (`8da3cff`) | PASS | PASS (new page) | PASS | PASS | PASS* | ✅ GREEN |

`*` See the shared-design-system advisory at the bottom — a pre-existing focus-ring nit
in `src/styles/design-system.css` that is NOT introduced by any of these branches and is
NOT a blocker.

---

## cursor-2/design-coaching — required fixes (Lens b: COPY UNCHANGED)

All evidence is in `src/pages/coaching.astro` on branch `cursor-2/design-coaching`.
This was supposed to be a design-only pass; the following user-facing copy was altered and
must be restored to the original wording (verbatim from `design/handoff-phase1`).

1. **Select option `intermediate` was reworded** — `coaching.astro:191`
   - Now: `<option value="intermediate">Trung bình (còn ngại)</option>`
   - Restore to: `Trung bình (giao tiếp được nhưng còn ngại)`

2. **Booking section heading was changed** — `coaching.astro:177`
   - Now (`SectionHeading title`): `Đặt lịch tư vấn miễn phí`
   - Restore to original H2 copy: `Để Felix liên hệ tư vấn`
   - Note: this also creates a duplicate of the heading already used at `coaching.astro:161`.

3. **Booking section lead had a new sentence appended** — `coaching.astro:178`
   - Now: `Điền form, Felix sẽ nhắn Zalo trong 24h. Buổi tư vấn 30 phút giúp Felix hiểu con và đề xuất lộ trình phù hợp.`
   - Restore to original: `Điền form, Felix sẽ nhắn Zalo trong 24h.` (drop the added second sentence)

4. **Textarea placeholder was shortened/changed** — `coaching.astro:195`
   - Now: `VD: Con tự tin nói trước lớp, kể chuyện mạch lạc…`
   - Restore to original: `VD: Con tự tin nói trước lớp, kể chuyện mạch lạc, giao tiếp tự nhiên với người nước ngoài...`

5. **New input placeholders were introduced (not in original copy)** — `coaching.astro:182,184,185,196`
   - Added: `Nguyễn Văn A`, `Bé Na`, `8`, `09xx xxx xxx` (the original inputs had no placeholders).
   - Fix: either remove these placeholders, or get them sign-off as approved new copy before merge.

6. **CTA buttons gained a `→` arrow** — `coaching.astro:66` (and the booking CTAs)
   - Original coaching CTAs were `Đặt lịch tư vấn miễn phí` / `Đặt lịch tư vấn` with no arrow.
   - Minor/decorative, but it is a text change. Either revert the arrows or align with the
     home page convention deliberately. (Home page already uses `→` on its CTAs, so this is
     borderline — but flagging for consistency review.)

**Intact (good):** the Vietnamese reassurance `Không spam.` is preserved verbatim
(`coaching.astro:202`), and the privacy-policy line is unchanged.

### Other lenses for cursor-2 (all PASS)
- (a) Scope: only `src/pages/coaching.astro` changed (its own zone) — no cross-zone edits.
- (c) Hex: no rogue hardcoded hex; all color comes from `fx-*` primitives / tokens.
- (d) Responsive: retains responsive grids (`md:grid-cols-2`, form `md:grid-cols-2`); holds at 375px.
- (e) Focus ring: see shared advisory; no regression introduced by this branch.

---

## cursor-1/design-home — ✅ GREEN (no action needed)
- (a) Scope: only `src/pages/index.astro` (home zone). No cross-zone edits.
- (b) Copy: all visible copy preserved verbatim; raw markup swapped for `Badge`/`Button`/`Card`/`Avatar`/`SectionHeading` primitives only. Existing `→` arrows preserved (already present in original).
- (c) Hex: no rogue hex; colors via tokens/primitives.
- (d) Responsive: `md:`/`lg:` classes and `max-w-6xl` layout preserved.
- (e) Focus ring: neutral (see shared advisory).

## cursor-3/design-builder — ✅ GREEN (no action needed)
- (a) Scope: adds `src/pages/read2lead/build.astro` + `src/scripts/r2l-builder.client.ts` (builder zone only).
- (b) Copy: brand-new page (no prior copy to alter); 4-stage rotation labels present as specified.
- (c) Hex: all CSS uses design-system tokens (`var(--…)`, `color-mix`); no rogue hex.
- (d) Responsive: `max-w-3xl`, `grid-cols-2 md:grid-cols-4` topic grid; holds at 375px.
- (e) Focus ring: uses primitives; reduced-motion is honored (`prefers-reduced-motion` skips the generating animation). No regression.

---

## Shared design-system advisory (NOT a blocker; pre-existing, not from these branches)
`src/styles/design-system.css` defines a `--ring-accent` token (`:87`) but only applies it to
`.fx-topic--selected` (`:398`, a selection state, not focus). There is no `:focus-visible`
yellow ring on `.fx-btn`, and `.fx-field:focus` sets `outline: none` with only a border-color
change (`:276`). Buttons keep the browser default outline (not removed), so this matches the
pre-existing behavior and is not introduced by the three design branches. Recommend a separate
follow-up to add `.fx-btn:focus-visible { box-shadow: var(--ring-accent); }` and a visible
focus ring on `.fx-field` for accessibility — but this should NOT block this handoff.

---

## Next step for the parent
Ping the **cursor-2** agent to restore the original coaching copy (items 1–4 are hard reverts;
items 5–6 need a keep-or-revert decision). After cursor-2 re-pushes, re-run this 5-lens audit;
if green, proceed to Step 2 (merge cursor-1 + cursor-2 + cursor-3 into `design/handoff-phase1`)
and Step 3 (push to trigger the Cloudflare Pages preview). cursor-1 and cursor-3 are already
clear to merge.
