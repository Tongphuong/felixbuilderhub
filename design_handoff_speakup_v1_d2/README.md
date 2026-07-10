# Handoff: SpeakUp V1 — Wave D2 (L3–L5 Free Talking: Topic Spark)

> Status: draft, awaiting Phương's approval (Wave D2 acceptance in
> `_ops/specs/SPEC_SPEAKUP_V1.md`: Packet 2 build starts only after this
> handoff is approved + Packet 1 lands). Nothing here is shipped code — no
> product file was touched to produce this handoff.

One self-contained HTML mock, phone (390) + desktop (1280) boards per
state, built directly against the CSS classes **already shipped** in
`src/styles/speakup-app.css` / `src/pages/speak-up.astro` (Phase 7a/7b)
and the Wave D Set 1 hands-free/listening-indicator classes, so the
extending build packet (V1.2 Packet 2) can copy class names 1:1. New
classes are called out per section and summarized below.

## Files

```
design_handoff_speakup_v1_d2/
├── README.md                                              ← you are here
└── SpeakUp V1 Free Talking Topic Spark (L3-L5).dc.html     ← Wave D2 (V1-D3 L3–L5)
```

Plain static HTML with an inline `<style>` block — open directly in a
browser, no build step, no external requests (fonts fall back to system
sans-serif; the live app already loads Manrope/Inter via Astro, so this
only affects how the mock itself looks, not the build).

---

## Scope reminder (per `SPEC_SPEAKUP_V1.md` §V1-D3, rewritten 2026-07-10 evening)

L3–L5 is **not guided** — no choice chips, no sentence starters, no
sentence frames, and **no photos anywhere** (photos stay in homework mode
by founder decision). This is a hard visual constraint on every screen in
this file: none of Wave D Set 1's `minny-option-chip` /
`minny-sentence-frame` / `minny-starter-hint` classes appear here, and no
screen shows an image. The only two production/help mechanisms L3–L5 gets
are the topic-pick at session start and the on-demand hint button —
everything else is open, unscaffolded conversation.

| Level | What's added on top of the base conversation screen |
|---|---|
| L3 | Topic pick at session start (§A1) + hint on demand (§B) |
| L4–L5 | Everything L3 gets, **plus** three optional games (§A2, §C) |

## §A — Topic-pick session start

**Screens:** A1 (L3, topics only) · A2 (L4–L5, topics + 3 game cards)

### Design rationale

This screen replaces "jump straight into turn 1" — the session now opens
with Minny asking "Hôm nay con muốn nói về gì?" and the kid picking one of
the 12 `HUB_TOPICS` tiles (exact `[value, label_vi, emoji]` triples from
`src/pages/ho-so/ho-so-topics.ts`, unchanged) or "🎲 Minny chọn" to let
Minny pick instead. The tile itself is a direct visual port of
`TopicTile.astro`'s rendered look (`fx-topic` / `fx-topic__emoji` /
`fx-topic__label` / `fx-topic--selected`, values copied from
`design-system.css`, not re-derived), and the grid is the same
`grid-template-columns: repeat(3, 1fr)` pattern used in `r2l/start.astro`
— reused rather than reinvented per the reuse-before-building rule, since
this is the exact interaction R2L already ships (pick 1 of N labeled
tiles) applied to a new context. The topic is session-scoped
(`starter_topic` on the conversation KV record) and is never written to
the student profile — it resets every session. For L4–L5 (A2), three game
cards sit **above** the topic grid, deliberately built from a different
shape (large, gold-tinted, one-line description, ~stacked rows) so they
never get mistaken for more topic tiles — picking a game still requires a
topic underneath it for vocabulary seeding, so the topic grid is always
present, never replaced.

### New classes introduced

| Class | Purpose |
|---|---|
| `.fx-topic-grid` | 3-column grid wrapper for the 13 tiles (12 topics + dice), values match the `grid-cols-3 gap-3` pattern from `r2l/start.astro`. |
| `.fx-topic--random` | Modifier on the reused `.fx-topic` tile for "Minny chọn 🎲" — dashed gold border, full-width row, larger label — visually distinct from a topic choice since it's an action ("pick for me"), not a topic. |
| `.minny-topic-picker` / `__prompt` / `__section-label` | Wrapper + section labels ("🎮 Hoạt động hôm nay", "Hoặc chọn một chủ đề tự do") separating the game-card row from the topic grid in A2. |
| `.minny-game-cards` / `.minny-game-card` (`__emoji`, `__body`, `__title`, `__desc`) | The three L4–L5 activity cards — real `<button>`s, ≥44px tall via padding, gold-gradient background so they read as "featured," never chip-styled. |

### Reused, unmodified

`fx-topic` / `fx-topic__emoji` / `fx-topic__label` / `fx-topic--selected`
(values from `design-system.css`), the `r2l/start.astro` 3-column grid
pattern, `spk-topbar`/`spk-back` (page-level back nav, matches the
practice-screen header already shipped), `ft-hero`/`ft-hero__avatar`/
`ft-hero__eyebrow`/`ft-hero__line`, `spk-btn`/`spk-btn--gold` (the
"Bắt đầu nói chuyện 🚀" CTA — same button family as the homework "Bắt đầu"
CTA already shipped, not a new button style).

---

## §B — In-conversation hint states

**Screens:** B1 (idle) · B2 (offered — kid stalled) · B3 (revealed)

### Design rationale

The whole point of L3–L5 is unscaffolded production, so the hint has to
be the opposite of the L1–L2 chip system: invisible until asked for, and
gone again the instant it's used. B1 is the resting state for every
single L3–L5 turn — a small, quiet "💡 Gợi ý" button near the recorder
that does nothing until tapped. B2 is what happens after the app detects
a stall (mic armed, no speech for a few seconds): the button gets a soft
`box-shadow` pulse and a small dashed "Cần gợi ý không?" affordance
appears beside it — proactive, but never blocking (no modal, no dimming
the rest of the screen, the kid can keep trying to speak and it just sits
there). B3 is what a tap reveals: exactly one small card, either a topic
word (EN + VN, with a "hear it" chip reusing the existing
`minny-play-chip`) or a nudge question — never both, never a list. Using
it or dismissing it (the small "×") both return the screen to B1, so a
kid can never accumulate open hint cards or get a second hint without a
new stall. This directly implements the acceptance criterion "hint button
reveals at most one hint per tap and re-hides."

### New classes introduced

| Class | Purpose |
|---|---|
| `.minny-hint-btn` (`.is-pulsing`) | The idle/pulsing hint button; pulse is `box-shadow` only (no scale/movement) to read as gentle, not urgent. |
| `.minny-hint-affordance` | The small "Cần gợi ý không?" dashed pill shown next to the pulsing button in B2. |
| `.minny-hint-card` (`__eyebrow`, `__word-row`, `__word-en`, `__word-vi`, `__question`, `__dismiss`) | The revealed hint card; `__word-row` and `__question` are alternate content for the same shape (word-hint vs nudge-question), swapped by the hint's `type`, not two different components. |

### Reused, unmodified

`ft-topbar`, `minny-end-btn`, `minny-timer`, `minny-turn-dots`/
`minny-turn-dot`, `ft-hero`/`ft-hero__avatar`/`ft-hero__eyebrow`/
`ft-hero__line`, `minny-transcript__reply`/`minny-transcript__kid-chip`,
`spk-rec-btn`/`spk-rec-btn__icon`, `minny-play-chip`, `minny-handsfree`
(`.is-on`), `minny-listening-indicator`, `minny-manual-prompt` — the
entire Wave D Set 1 hands-free/listening system is shown unchanged since
it's an independent axis from level or hint state.

---

## §C — Game in-conversation framing

**Screens:** C1 (build-a-story) · C2 (friendly debate) · C3 (would-you-rather)

### Design rationale

All three screens prove the same point: a game doesn't get its own screen
shape, it adds one framing element on top of the identical L3–L5
conversation chrome (topbar, hero, transcript, recorder, hint button all
present and behaving exactly as in §B). Build-a-story (C1) adds a
`minny-story-strip` recapping the last two lines with Minny's most recent
line bolded, so a kid always knows where the story left off without
having to scroll the full transcript. Friendly debate (C2) adds a
`minny-debate-banner` stating Minny's playful, founder-approved position
("Cats are better than dogs! 😼") that persists at the top of the hero
area for the whole game, not just one turn — no scoreboard, no "winner,"
because V1-D3 explicitly rules out debate-winner scoring. Would-you-rather
(C3) adds two `minny-wyr-card`s showing the two options Minny just
offered — deliberately built as plain `<div>`s, not `<button>`s, with no
hover/focus/press affordance at all, so a kid never mistakes them for
tappable answers the way an `fx-topic` tile or a game card legitimately
is; the kid must speak the choice and a reason, which is the entire
point of a production-mode game.

### New classes introduced

| Class | Purpose |
|---|---|
| `.minny-story-strip` (`__eyebrow`, `__line`, `--minny-last`) | Recap strip above the transcript; `--minny-last` bolds/brightens Minny's most recent story line. |
| `.minny-debate-banner` (`__emoji`, `__eyebrow`, `__text`) | Banner stating Minny's debate position, gold-gradient background to match the "featured" treatment used for game cards. |
| `.minny-wyr-cards` / `.minny-wyr-card` (`__emoji`, `__en`, `__vi`) | The two illustrative option cards; explicitly non-interactive markup. |

### Reused, unmodified

Same full conversation chrome list as §B, plus the hint button/card
system from §B (production mode does not remove hints, only chips/frames).

---

## Vietnamese copy used in the mock (provisional — pending Phương's line-edit)

As with Wave D, none of this copy has had a dedicated tone pass yet —
treat it as part of what's being approved alongside the visuals, not
final strings to hard-code without a second look.

- Topic prompt: `Hôm nay con muốn nói về gì?`
- Random tile: `Minny chọn` (🎲)
- Start CTA: `Bắt đầu nói chuyện 🚀`
- Game cards: `Kể chuyện cùng Minny` (📖) / `Tranh luận vui` (⚖️) / `Con chọn gì?` (🤔), each with a one-line description
- Hint idle: `💡 Gợi ý`
- Hint offered: `Cần gợi ý không?`
- Hint dismiss: `×` (`aria-label="Đóng gợi ý"`)
- Hint word chip: `🔊 Nghe từ này`
- Story strip eyebrow: `📖 Câu chuyện của chúng ta`
- Debate banner eyebrow: `Minny nghĩ`
- Would-you-rather Vietnamese glosses: `đi biển` / `đi núi`

---

## Accessibility & motion

- All chips/tiles/cards/buttons that ARE interactive (`fx-topic`,
  `minny-game-card`, `minny-hint-btn`, `minny-hint-card__dismiss`,
  `spk-btn`) are real `<button>` elements sized ≥44px on the smallest
  dimension (dismiss is a 28px visual circle inside a padded hit area —
  flagged below as an open question, since it reads under 44px as drawn).
- The would-you-rather option cards (§C3) are intentionally **not**
  `<button>`s and carry no `aria-pressed`/focus styling — they are
  reference content, not controls, matching the "kid speaks, never taps
  to answer" rule for L3–L5.
- New animations: `.minny-hint-btn.is-pulsing` (`box-shadow` pulse) and
  the reused `minny-listen-pulse` dot. Both are wrapped in the same
  blanket `@media (prefers-reduced-motion: reduce) { *,*::before,*::after
  { animation:none!important; transition:none!important; } }` pattern
  already used in Wave D and in the live `speakup-app.css` — no
  per-element reduced-motion exceptions needed.
- Transcript stays `role="log" aria-live="polite"` in the live code (not
  redrawn here since it's unmodified chrome); the hint card should get an
  `aria-live="polite"` region when it appears so screen-reader users get
  the same "something new appeared" signal a sighted kid gets from the
  pulse — flagged for Mark's implementation pass, not shown as a visual
  difference in the mock.

---

## Open design questions for Phương's approval pass

1. **Dismiss button size.** `.minny-hint-card__dismiss` is drawn as a 28px
   visual circle. It should get a padded 44px hit area in the real
   component (same technique as the fix-it skip link in Wave D Set 2),
   but please confirm the *visual* size (small, unobtrusive "×") is
   correct — a bigger dismiss button might read as more prominent than
   intended for something meant to disappear quietly.
2. **Random-tile placement.** "Minny chọn 🎲" is drawn last (13th tile,
   full-width row) so the 12 real topics get first visual priority. Please
   confirm, or say if it should lead the grid instead for kids who are
   most likely to want the path of least effort.
3. **Game-card ↔ topic interaction.** A2's notes assume tapping a game
   card doesn't skip the topic grid — a topic is still required
   underneath every game for vocabulary seeding. Please confirm this
   two-tap flow (pick game, then pick/confirm topic) is acceptable, versus
   a game auto-picking "Minny chọn" for the topic to keep it one tap.
4. **Hint content source.** The word-hint variant (§B3) assumes the
   revealed word comes from the chosen topic's word list (per V1-D2). If
   a kid picked "Minny chọn 🎲," please confirm the same list still
   applies (i.e. the rolled topic, once picked, behaves identically to a
   manually chosen one for hint purposes).
5. **Copy line-edit.** Per the note above, none of the Vietnamese strings
   here have had a dedicated tone pass — please treat copy as provisional
   even if the visual layout is approved as-is.
