# Handoff: SpeakUp V1 — Wave D (Choice-chip Free Talking + Homework Feedback v2)

> Status: draft, awaiting Phương's approval (Wave D acceptance in
> `_ops/specs/SPEC_SPEAKUP_V1.md`: *"Phương approves both handoffs (recorded
> ack) before V1.2/V1.4 build."*) Nothing here is shipped code — no product
> file was touched to produce this handoff.

Two self-contained HTML mocks, phone (390) + desktop (1280) boards per
state, built directly against the CSS classes **already shipped** in
`src/styles/speakup-app.css` / `src/pages/speak-up.astro` (Phase 7a/7b),
so the extending build packets (V1.2, V1.3, V1.4) can copy class names
1:1 rather than re-deriving values. New classes are called out per screen
and summarized below.

## Files

```
design_handoff_speakup_v1/
├── README.md                                    ← you are here
├── SpeakUp V1 Free Talking Choice Chips.dc.html  ← Set 1 (V1-D2 / V1-D3)
└── SpeakUp V1 Homework Feedback v2.dc.html       ← Set 2 (V1-D1 / V1.3 / V1.4)
```

Both files are plain static HTML with an inline `<style>` block — open
directly in a browser, no build step, no external requests (fonts fall
back to system sans-serif; the live app already loads Manrope/Inter via
Astro, so this only affects how the mock itself looks, not the build).

---

## Level gating (added by Lead after founder directive 2026-07-10)

Set 1's entire scaffold system is for **beginner levels L1–L2 ONLY**. Advanced
kids would find pre-designed sentences boring — Phương's directive. The ladder
(spec `SPEC_SPEAKUP_V1.md` V1-D3):

| Level | Free-talk experience |
|---|---|
| L1–L2 | Choice chips + sentence starters + repair ladder (this handoff, Set 1) |
| L3 | Guided open questions — no chips; starter hint already faded |
| L4–L5 | **Production mode: storytelling / presentation / debate** — phase V1.P, its own future design handoff (third mock set, not in this folder) |

Any level indicator in a build must follow this table; the chips UI must never
render for an L3+ kid.

## Set 1 — Free Talking: choice-chip conversation view (L1–L2 scaffolded mode)

**File:** `SpeakUp V1 Free Talking Choice Chips.dc.html` (6 states × 2 breakpoints)

### Design rationale

The 7b Free Talking screen already gave low-level kids a chat-shaped
conversation, but an open mic with no scaffolding is exactly what V1-D2
is fixing — kids don't know what to say, and mispronunciation garbles the
transcript. The chip system borrows Buddy.ai's PPP pattern (Presentation
→ Practice → Production): Minny presents 2–3 short answers as tappable
chips, but tapping only *reveals* the sentence frame the kid must say
aloud (`minny-sentence-frame`) — it never submits an answer on the kid's
behalf. That distinction is made visually explicit with a green,
checkmark-style "Mic đã sẵn sàng" line so nobody mistakes tapping for
answering. The sentence-starter hint (`minny-starter-hint`) is a second,
independent scaffold that fades out once a kid no longer needs it —
shown both present (L1, screen 1) and absent (L3, screen 3) so the
fade reads as "graduated," not "broken." The repair ladder (screens
4–6) reuses the *exact same* turn chrome for steps (a) and (c) so nothing
about the screen changes shape when a kid is being gently corrected — the
one exception is step (b), whose two oversized choice buttons are
deliberately un-chip-like, because that is the one point where a tap
alone can resolve the turn (confirming what Minny half-heard), and it
needs to look different so kids don't start expecting every tap to work
that way. Hands-free (`minny-handsfree`) and the "Minny đang nghe…"
indicator are shown as an independent axis from level/hint state, per the
IDEAS.md 2026-07-10 note that it must never be a hidden localStorage flag
— it's a visible, always-present control near the recorder.

### New classes introduced

| Class | Purpose |
|---|---|
| `.minny-options` / `.minny-option-chip` | 2–3 tappable chips ending a scaffolded turn. `is-selected` / `is-dimmed` modifiers show the post-tap state. |
| `.minny-sentence-frame` (`__label`, `__text`, `__blank`, `__mic-armed`) | Revealed sentence frame after a chip tap; `__blank` is the filled-in word, underlined dashed gold. |
| `.minny-starter-hint` | Dashed-gold pill hint line ("Con có thể nói: I have…"), shown at L1–L2 only. |
| `.minny-handsfree` (`.is-on`) | Labeled hands-free toggle, static on/off boards (not a live control in the mock). |
| `.minny-listening-indicator` | Pulsing-dot "Minny đang nghe…" line, shown only while hands-free VAD listening is active. |
| `.minny-manual-prompt` | Static "Nhấn để nói, con nhé!" text shown when hands-free is off (contrast to the listening indicator). |
| `.minny-repair-tag` | Small gold pill labeling which repair-ladder step is active (kid-visible but reads as decoration). |
| `.minny-repair-choices` / `.minny-repair-choice-btn` | Oversized (56px+) two-button disambiguation for ladder step (b). |
| `.minny-repair-model__text` / `__cta` | Ladder step (c) model line + "Con thử nói nhé!" prompt. |

### Reused, unmodified

`ft-topbar`, `minny-end-btn`, `minny-timer`, `minny-turn-dots`/`minny-turn-dot`,
`ft-hero`/`ft-hero__avatar`/`ft-hero__eyebrow`/`ft-hero__line`, `minny-transcript__reply`,
`minny-transcript__kid-chip`, `spk-rec-btn`/`spk-rec-btn__icon`, `minny-play-chip`
(reused verbatim for the ladder-step-(c) replay button — same "hear Minny" affordance,
different trigger).

---

## Set 2 — Homework feedback panel v2 + fix-it round

**File:** `SpeakUp V1 Homework Feedback v2.dc.html` (5 states × 2 breakpoints)

### Design rationale

V1-D1 deliberately relaxes V0's zero-LLM rule in exactly one place: a
feedback layer painted *after* the deterministic scorer, never replacing
it. The design consequence is literal — screens 1 and 2 render the
existing `minny-frame-score-card` → `minny-frame-rubric-card` →
`minny-frame-smile-chip` stack completely unchanged, then append
`minny-feedback-sandwich` as a new card directly below. The sandwich's
four rows are fixed order (praise → focus word → model sentence → tiny
challenge) because the name is literal: praise is the encouraging bread,
the focus word + model sentence is the corrective filling, and the tiny
challenge is a forward-looking close — never generic praise-only, never a
bare correction. The focus word chip reuses the amber `minny-word--close`
family (never the dim `--miss` grey) so it reads as "next goal," matching
the product's established "never punitive" rule from 7a. The fix-it round
(screens 3–5) is explicitly skippable at every entry point — invitation
has a real skip link, no screen blocks the "next step" flow — because
V1.4's rep loop is a bonus rep, not a gate. The rep screen's two compare
buttons echo the celebrate/encourage smile-chip pattern of never grading:
"Nghe Minny" and "Nghe con nói" both use warm-not-red colors, framed as
listening/comparing rather than pass/fail.

### New classes introduced

| Class | Purpose |
|---|---|
| `.minny-feedback-sandwich` (`.is-celebrate` / `.is-encourage`) | New card under the existing rubric/smile-chip stack; 4 fixed-order rows. |
| `.minny-feedback-sandwich__praise` (with `<q>`) | Praise line; the `<q>`-wrapped fragment must be grounded (a literal substring of the kid's transcript). |
| `.minny-word--focus` | Larger-size modifier on the existing `.minny-word--close` chip, for the single focus word. |
| `.minny-feedback-sandwich__model-en` / `__model-vi` | Model sentence, English bold + Vietnamese subtitle italic beneath. |
| `.minny-feedback-sandwich__challenge` | Tiny forward-looking challenge line. |
| `.minny-fixit-invite` (`__avatar`, `__title`, `__words`, `__actions`, `__skip`) | Invitation card; skip is a real `<button>`, 44px target via padding. |
| `.minny-fixit-rep` (`__progress`, `__word`, `__compare`) | Rep screen: word large, progress label ("Từ 1/2"). |
| `.minny-compare-btn` (`--minny` / `--kid`) | The two compare buttons; `--kid` variant is hidden until a first recording exists this rep. |
| `.minny-fixit-celebrate` (`__avatar`, `__title`, `__sub`) | End-of-round card, green family (7a "celebrate" precedent), no scores shown. |

### Reused, unmodified

`spk-topbar`, `spk-back`, `minny-dot`/`minny-dot--done`/`minny-dot--active`,
`spk-story-card` (+ `__eyebrow`/`__title`/`__en`), `minny-frame-score-card`,
`minny-frame-rubric-card`/`minny-frame-rubric-row`, `minny-frame-smile-chip`,
`minny-word`/`--good`/`--close`/`--miss`, `spk-btn`/`--gold`/`--green`/`--ghost`,
`spk-rec-btn` (smaller instance for the rep screen's re-record control).

---

## Vietnamese copy used in the mocks (provisional — pending Phương's line-edit)

All copy below is illustrative, built to match the established warm-teacher
voice (from 7a/7b), but **it has not been separately reviewed for tone the
way shipped kid-facing copy requires** — treat it as part of what's being
approved alongside the visuals, not as final strings Mark/Steve should
hard-code without a second look.

**Set 1**
- Hint: `Con có thể nói: I have…`
- Mic-armed: `Mic đã sẵn sàng — con nói đi nào!`
- Hands-free label: `🎙️ Tự động nghe`
- Listening: `Minny đang nghe…`
- Manual prompt: `Nhấn để nói, con nhé!`
- Repair tags: `Câu hỏi đơn giản hơn` / `Xác nhận lại` / `Minny mẫu câu trả lời`
- Repair (c) CTA: `Con thử nói nhé! 🎤`

**Set 2**
- Sandwich eyebrow: `💬 Minny nói thêm`
- Fix-it invite: `Mình luyện lại 2 từ này nhé!` / skip `Bỏ qua, làm sau` / start `Bắt đầu luyện 🎯`
- Rep progress: `Từ 1 / 2`
- Compare buttons: `🔊 Nghe Minny` / `▶️ Nghe con nói`
- Re-record: `Nhấn để thu âm lại`
- Celebrate: `Tuyệt vời! Con đã luyện xong 2 từ rồi 🎉` / `Thầy Phương sẽ thấy con tiến bộ nhiều lắm.`

---

## Accessibility & motion

- All chips, toggles, and buttons are real `<button>`/interactive elements
  sized ≥44px on the smallest dimension (chips are 44px min-height with
  horizontal padding; the fix-it skip link uses padding, not font-size,
  to hit the floor).
- `minny-listening-indicator__dot` is the only new animation
  (`minny-listen-pulse`, a 1.4s scale/opacity loop). Both files wrap all
  animation-bearing rules (`minny-listen-pulse` here, plus the reused
  `spk-glow`/pulse timings implied by the reused classes) in
  `@media (prefers-reduced-motion: reduce) { *,*::before,*::after {
  animation:none!important; transition:none!important; } }` — same blanket
  pattern already used in the live `speakup-app.css`, so no per-element
  reduced-motion exceptions are needed.
- Repair-ladder and fix-it screens intentionally reuse existing landmark/
  ARIA patterns (transcript stays `role="log" aria-live="polite"` in the
  live code; option chips and repair buttons are plain buttons with visible
  text labels, so no extra `aria-label` scaffolding was invented here —
  flagging this as an open question below for Mark's implementation pass).

---

## Open design questions for Phương's approval pass

1. **Ladder step (b) exception to "tap never answers."** V1-D3's rule is
   "tapping never submits an answer, it reveals the sentence frame." Step
   (b)'s two big choice buttons are the one place a tap *does* resolve the
   turn directly (confirming what was half-heard), which is why they're
   drawn differently (oversized, no chip styling, no sentence frame
   after). Please confirm this one exception is acceptable, or if you'd
   rather even step (b) reveal a sentence frame + require a spoken repeat.
2. **Focus-word source in the sandwich.** The mock assumes exactly one
   `focus_word` per feedback object (matches V1.3's schema
   `{praise_vi, focus_word, model_sentence_en, tiny_challenge_vi,
   recast_en?}`). If a homework attempt has multiple weak words, should
   the sandwich ever show more than one focus word, or does the fix-it
   invitation (screen 3, which can list 2 words) always absorb the rest?
3. **Copy line-edit.** Per the note above, none of the Vietnamese strings
   in this handoff have had a dedicated tone pass the way shipped kid
   copy normally gets — please treat the copy as provisional even if the
   visual layout is approved as-is.
4. **Emoji placeholders.** Both mocks use the 🐨 koala-in-a-circle
   placeholder (same convention as the 7a/7b handoffs) — confirming this
   still stands in for the real Minny PNG/video assets already used live,
   not a new asset request.
