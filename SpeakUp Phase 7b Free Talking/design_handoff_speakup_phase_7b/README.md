# SpeakUp — Phase 7b · Free Talking (Nói chuyện với Minny)

Design handoff for the one new SpeakUp V0 screen: open, time-boxed spoken
conversation with the Minny mascot, capped at **5:00** or **12 turns**.

**Design file:** `SpeakUp Free Talking.dc.html` — a single canvas doc,
5 screens × 3 breakpoints, all copy final.
**Target file:** `src/pages/read2lead/speaking.astro`.

---

## For Claude Code — how to use this bundle

You are implementing Phase 7b of SpeakUp inside an existing **Astro +
vanilla-JS** codebase. This folder contains a design **reference**, not
production code.

1. **Read this whole README first**, then open
   `SpeakUp Free Talking.dc.html` in a browser to see all 15 boards
   (5 screens × phone/tablet/desktop) laid out side-by-side.
2. **Recreate the visuals in `src/pages/read2lead/speaking.astro`** using
   the codebase's existing class vocabulary — `minny-hero`,
   `minny-avatar`, `minny-bubble`, `minny-btn`, `minny-btn--record`,
   `minny-mode-card`, `fx-card`, `fx-btn`. Do **not** port the inline
   styles from the .dc.html verbatim; port the *values* (hex, px, radii)
   into the codebase's CSS modules.
3. **Reuse Phase 2 / Phase 7a components as-is** — the mode picker,
   mic-check, homework recording flow, RankBadge, XP bar, and the red
   96×96 record button (with pulsing ring while recording) are all
   already shipped. Do not redesign them.
4. **Ask before adding scope.** No settings UI, no cross-session history,
   no daily-kill-switch empty state (that is a one-line text change on
   the mode picker, not part of this task).

If any code path here is ambiguous (e.g. how STT→LLM→TTS is wired), read
the Phase 7a homework recording flow in the same codebase — it is the
canonical reference for mic permissions, recording state machine and
audio playback.

---

---

## What this handoff is (and isn't)

- **Is** a high-fidelity visual reference. Colors, spacing, typography,
  radii, shadows and Vietnamese copy are all shippable.
- **Isn't** production code. The .dc.html is a design canvas built on the
  Felix Coaching Design System (`fx-*` classes) with inline styles for
  the SpeakUp-specific pieces (`minny-*`, timer, dots, transcript). Sonnet 5
  should recreate this inside Astro/vanilla-JS, reusing the Phase 2/7a class
  vocabulary — do not port class names 1:1 from this doc.
- Uses the **koala emoji 🐨** as a stand-in for the real Minny asset. The
  live product already ships PNG + looping MP4 per mood (`idle`, `listen`,
  `celebrate`, `encourage`) — swap the `🐨`-in-a-circle placeholder for the
  actual `<img>`/`<video>` element from Phase 7a.

---

## Screen index

| # | State | Purpose | Frames |
|---|---|---|---|
| 1 | Conversation (main) | The chat loop. Most time spent here. | phone · tablet · desktop |
| 2 | "Minny đang nghĩ..." | Waiting for STT→LLM→TTS reply (~2–3.5s). | phone · tablet · desktop |
| 3 | Tap-to-play fallback | iPad Safari autoplay blocked. | phone · tablet · desktop |
| 4 | Wrap-up | Cap reached (5:00 or 12 turns). | phone · tablet · desktop |
| 5 | Session summary | Kid-facing close-out. | phone · tablet · desktop |

---

## Tokens used (Felix Coaching DS — do not invent)

```
--navy-950  #10273a   page bg
--navy-900  #17354a   card bg / section bands
--navy-850  #1d3f58   raised surfaces (recorder panel)
--navy-800  #244a64   hover
--gold      #c88f38   primary accent, CTAs, filled dots
--gold-light #f2cc7e  hover/highlight, timer digits, chip glow
--cream     #f5e6c8   strong text, headings
--cream-muted #d9c7a4 body text, transcript
--cream-dim #aa9673   captions, unused dots (at ~18% alpha)
--success   #6fcf97   (unused this screen)
--danger    #f87171   record button
```

Fonts: **Manrope** (600–800) for timer digits, stat numbers, headings,
Minny bubble in wrap-up. **Inter** (400–700) for everything else.

Radii: pill (999px) for chips, dots, avatars; 14–16px for bubbles;
20–24px for cards/panels; 28px for the hero.

---

## New visual states — what Sonnet 5 needs to build

### 1. Minny "thinking" state (Screen 2)

**No new mascot asset needed.** Use the existing **idle** PNG/MP4 and layer
a CSS breathing animation on it:

```css
@keyframes minny-breathe { 0%,100%{transform:scale(1)} 50%{transform:scale(1.03)} }
.minny-avatar--thinking { animation: minny-breathe 2.4s ease-in-out infinite; }
```

The **three-dot indicator** lives inside the bubble as DOM (not a raster):

```html
<div class="minny-bubble minny-bubble--thinking">
  <span></span><span></span><span></span>
</div>
```

```css
@keyframes minny-thinking-dot {
  0%,80%,100% { opacity:.25; transform:translateY(0) }
  40%         { opacity:1;   transform:translateY(-3px) }
}
.minny-bubble--thinking span {
  width:10px; height:10px; border-radius:50%;
  background:var(--gold-light);
  animation: minny-thinking-dot 1.2s infinite;
}
.minny-bubble--thinking span:nth-child(2) { animation-delay:.2s }
.minny-bubble--thinking span:nth-child(3) { animation-delay:.4s }
```

Eyebrow copy shifts from `Minny · idle` to **`Minny đang nghĩ...`**
(color: `--gold-light` instead of `--cream-dim`).

Record button in this state: `disabled`, opacity 0.5, background
`color-mix(in srgb, var(--danger) 40%, var(--navy-850))`.

### 2. Timer color shift (Screen 1 → 4)

```
5:00 → 0:31   color: var(--gold-light)   /* default */
0:30 → 0:01   color: #f2a86b             /* warm amber, not red */
0:00          color: var(--gold); opacity: 0.5  /* settled */
```

Do **not** shift to `--danger` red — that reads as "you did something wrong",
wrong voice for this product.

### 3. Turns-left dots

12 dots in a horizontal row, `gap: 5–7px` depending on breakpoint. Same
`renderProgressDots` pattern from the homework flow — filled = used,
`color-mix(in srgb, var(--cream) 18%, transparent)` = remaining. Sizes:
`8px` phone, `9px` tablet, `10px` desktop.

### 4. Tap-to-play chip (Screen 3)

Lives **inside** Minny's latest bubble, not as a standalone banner. Solid
gold pill with navy label + inline SVG speaker icon + glowing halo:

```css
.minny-play-chip {
  background: var(--gold);
  color: var(--navy-950);
  border-radius: 999px;
  padding: 10px 20px;
  box-shadow:
    0 4px 20px -4px color-mix(in srgb, var(--gold) 60%, transparent),
    0 0 0 4px color-mix(in srgb, var(--gold) 15%, transparent);
  animation: minny-glow 2s ease-in-out infinite;
}
```

On tap: fade out 200ms, play audio, don't reappear until the next blocked
reply in the same session.

### 5. Record button (reused from Phase 7a — do NOT redesign)

Existing `minny-btn minny-btn--record`:
- **96×96 phone / 104×104 tablet / 120×120 desktop**
- Circle, `background: var(--danger)`
- White rounded-square icon (26px / 28px / 34px, `border-radius: 6–8px`)
- Shadow: `0 12px 32px -8px rgba(248,113,113,.55), inset 0 -4px 0 rgba(0,0,0,.15)`
- Recording state: add pulsing gold/red ring (existing Phase 7a
  `@keyframes minny-pulse-ring` — same one used on the homework mic).

### 6. Waveform (desktop recorder panel)

12–15 vertical bars, `width:3px`, heights 8–20px, `--cream-dim` fill.
Idle: static random heights. Recording: bars animate up/down (~200–400ms
per bar, staggered). Reuse Phase 7a `minny-waveform` if it exists;
otherwise:

```css
@keyframes minny-wave { 0%,100%{height:8px} 50%{height:28px} }
```

---

## Layout — per breakpoint

### Phone (390px, single column)

```
[Kết thúc]  [4:23]           ← top bar
[• • • • • ○ ○ ○ ○ ○ ○ ○]    ← 12 dots
┌─────────────────────────┐
│ [🐨64] │ minny-bubble    │  ← minny-hero (16px padding, 24px radius)
└─────────────────────────┘
scrolling transcript...
     ⋮
        [REC 96×96]           ← record button
        "Nhấn để nói"
```

Vertical spacing: 12px between top bar / dots / hero / transcript.
Padding: `8px 16px` horizontal.

### Tablet (820px, 2-column)

- Full-width **minny-hero** row (avatar 112×112, bubble at right, 17px text).
- Below: `grid-template-columns: 1fr 280px; gap: 20px` — transcript on
  the left, dedicated **recorder panel** on the right (raised
  `--navy-850`, 104×104 button).

### Desktop (1280px, 3-column)

`grid-template-columns: 320px 1fr 320px; gap: 20px`

- **Left rail** — 200×200 avatar, mood label, "Lượt còn lại N/12" counter.
- **Center** — transcript, scrollable, `72%` max-width per bubble.
- **Right** — recorder panel: 120×120 button + live 15-bar waveform strip
  at the bottom, separated by hairline border.

Top bar: `[← Kết thúc cuộc trò chuyện]` left, `[dots + 4:23]` right.

---

## Vietnamese copy — final strings

### Chrome
| ID | String |
|---|---|
| `endBtnPhone` | `Kết thúc` |
| `endBtnDesktop` | `← Kết thúc cuộc trò chuyện` |
| `micLabel` | `Nhấn để nói` |
| `waitLabel` | `Đợi Minny trả lời...` |
| `thinkingEyebrow` | `Minny đang nghĩ...` |
| `moodCelebrate` | `Đang cổ vũ con` |
| `moodIdle` | `Đợi con nói` |
| `turnsRemainingLabel` | `Lượt còn lại` |
| `playChip` | `Nghe Minny` |

### Wrap-up (Screen 4)
- **5-minute cap:** *"Hôm nay nói chuyện vui quá! Hẹn gặp lại con nhé!"*
- **12-turn cap:** *"Con nói giỏi quá! Nghỉ tay một tí rồi tiếp nhé!"*
- **Kill-switch:** *"Mai nói chuyện tiếp với Minny nhé!"* (skip Screen 5)
- **Primary CTA:** `Xem tóm tắt →`
- **Secondary:** `Về trang chính`

### Summary (Screen 5)
- Header: **`Tóm tắt hôm nay`** (eyebrow) · **`Con đã trò chuyện rất giỏi!`** (h3)
- Stat labels: `lượt trò chuyện` · `câu con đã nói` · `phút trò chuyện` · `N ngày liên tiếp`
- Minny line: *"Con nói rõ ràng và tự tin lắm. Ngày mai kể tiếp cho Minny nghe nhé!"*
- XP line: *"Con đã nhận 40 XP hôm nay"* · *"Hạng: Bạc · Còn 60 XP nữa lên Vàng"*
- Primary: `Nói chuyện nữa với Minny` · Secondary: `Về trang chính`

### Transcript chips (child side)
- Default: `con đã nói`
- Latest (before Minny's reply lands): `con vừa nói xong`
- Desktop shows duration suffix: `con đã nói · 6 giây`

---

## Reduced-motion variants

All wrapped in a single `@media (prefers-reduced-motion: reduce)` block:

| Element | Default | Reduced |
|---|---|---|
| Minny "thinking" breathe | 2.4s scale loop | Freeze at 100% |
| Thinking three dots | Staggered bounce | Static, uniform 50% opacity |
| Record button pulse ring | 1.4s expanding ring | Static solid ring at rest state |
| Tap-to-play chip glow | 2s halo pulse | Solid halo, no pulse |
| Wrap-up avatar glow | 60–100px gold halo (static) | Same (already static) |
| Waveform bars | Height animation while recording | Static bars with recording-state color shift only |
| Timer color amber | 250ms color transition | Instant color swap |

---

## Accessibility

- All tap targets ≥ 44px.
- Record button: `aria-label="Nhấn để nói"` idle, `aria-label="Dừng ghi âm"`
  recording.
- Timer: `role="timer" aria-live="off"` — do not announce every second;
  only announce at 1:00, 0:30, 0:10.
- Turns-left dots: single `aria-label="Còn N lượt trong tổng 12"` on the
  container; hide individual dots from AT.
- Tap-to-play chip: real `<button>`, `aria-label="Nghe Minny nói"`.
- Focus ring: DS default (2px `--gold-light` at 4px offset).
- Transcript container: `role="log" aria-live="polite" aria-atomic="false"` —
  only new Minny bubbles announced.
- Child-side chips are **not** announced (no ASR text = nothing to read).

---

## Interaction states table

| Element | idle | active | disabled |
|---|---|---|---|
| Record button | red circle, static shadow | red + pulsing ring, white square → red square (stop icon) | 40% red mix, opacity .5, cursor not-allowed |
| End-session button | 1px `--border-subtle`, `--text-body` | border → `--accent`, text → `--accent` | n/a |
| Play chip | glowing gold pill | pressed: translateY(1px) | (disappears on tap) |
| Primary CTA | `fx-btn fx-btn--primary` | 1px down, gold-light bg | opacity .6 |

---

## Files in this bundle

```
design_handoff_speakup_phase_7b/
├── README.md                       ← you are here
└── SpeakUp Free Talking.dc.html    ← the design canvas
```

Open the .dc.html to see all 15 boards laid out. Section IDs (`#s1`–`#s5`)
map to the screens listed above.
