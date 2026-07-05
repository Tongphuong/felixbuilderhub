# Handoff: SpeakUp — Phase 7a (Speaking Practice Flow)

## Overview

SpeakUp is a Vietnamese kids' English-speaking practice app used to complete speaking homework set by **thầy Phương** (a male teacher — always "thầy", never "cô"). Target users are children ~6–12 in Vietnam. A koala mascot named **Minny** guides them through recording a short story built from 6 sentence stems, then shows a friendly result screen and a per-word summary the parent can review.

This handoff covers 4 screens of that flow, adapted for phone, tablet, and desktop:

1. **Recording** — child speaks all 6 stems in one ~60s take
2. **Good result (5/6)** — celebrate
3. **Needs more practice (2/6)** — encourage, never a failure screen
4. **End-of-set summary** — parent-facing, per-word color chips, listen-again, back to profile

## About the Design Files

The files in this bundle are **design references created in HTML** — prototypes showing the intended look and behavior, not production code to copy directly.

Your task is to **recreate these designs in the target codebase's existing environment** (React Native, Flutter, SwiftUI, React web, whatever the SpeakUp app is built in) using its established patterns and libraries. If no environment exists yet, pick the most appropriate framework for a Vietnamese-market mobile app that also runs on tablet/desktop web, and implement there.

The HTML is a specification, not source.

## Fidelity

**High-fidelity (hifi).** Colors, spacing, typography, border radii, shadows, and copy are all final. Recreate pixel-perfectly using the codebase's existing components. Where a component doesn't exist, build it to these values.

## Design System

The visuals derive from the **Felix Coaching Design System** (blue-night-sky aesthetic — deep navy surfaces, single gold accent, warm cream text, Manrope for display + Inter for body). If the app already uses this system, reuse its components (`Button`, `Card`, `Badge`, `Avatar`, `ProgressBar`). If not, treat the tokens below as the source of truth for this feature.

## Screens

### Screen 1 — Recording ("Bài tập nói")

**Purpose.** Child records themselves saying all 6 sentence stems in one continuous take (~60 seconds).

**Layout — Phone (390px)**
- Vertical stack, single column, 20px horizontal padding
- Top bar (58px): back button (40×40 circular), centered title "Bài tập nói" + subtitle "Thầy Phương · Tuần 3", close button (40×40 circular)
- Minny bubble row (avatar 56×56 + chat bubble w/ tail top-left, `border-radius: 4px 18px 18px 18px`)
- Story card (translucent navy `#17354a` @ 60% + 1px gold border @ 30%, radius 20, padding 18): eyebrow "MY TRIP STORY", meta "6 câu · ~60 giây", ordered list of 6 stems. Each stem: numbered circle (22×22, gold-tinted bg) + text with a dashed-gold underlined blank where the child fills in.
- Timer row: label + `0:18` (Manrope 800 40px, tabular-nums) on the left, progress ring (72×72, gold arc) on the right with `30%` centered inside
- Record button: 96×96 red circle (`#f87171 → #d64545` linear gradient), white square icon inside (28×28), pulsing `box-shadow` ring
- Caption row: 6px red dot with red glow + "Minny đang lắng nghe 🎧"

**Layout — Tablet (820px)**
- Header row with taller "Quay lại" pill button (44px) + title
- Minny bubble becomes a full-width card (72×72 avatar + inline heading + subtitle)
- Content becomes a **2-column grid** below the Minny row:
  - Left (1fr): story card, same as phone but font-size 16px, blank padding 32px
  - Right (300px): dedicated recorder card — target-time label, big timer `0:18` (44px), 148×148 ring, 108×108 red button, "Minny đang lắng nghe" caption, "Nhấn để dừng" hint

**Layout — Desktop (1280px)**
- Browser chrome (macOS traffic lights + address bar `speakup.thayphuong.vn/bai-tap/tuan-3/my-trip-story`)
- App header: "SpeakUp · Bài tập của **thầy Phương** · Tuần 3" left, "Bé Minh · Lớp 3" + user avatar right
- Content becomes a **3-column grid** (320px | 1fr | 320px), padding 28px 40px:
  - Left rail: 160×160 Minny avatar (bobbing), a bubble with encouragement, a dashed-gold "💡 Gợi ý" hint
  - Center: story card with 17px stems, 30×30 numbered circles, wider blanks (padding 0 44px)
  - Right rail: recorder panel with 200×200 ring wrapping a 120×120 red button in the center, timer 56px, "phím Space" keyboard hint, live 20-bar gold waveform strip below

**Interactions**
- Tap red button → start/stop recording; pulse animation runs while recording
- Ring fills clockwise as elapsed / target
- Timer counts up (mm:ss)
- Space bar toggles record (desktop)
- Long-press stem → play example audio (optional)
- Reduced motion: kill pulse + Minny bob

---

### Screen 2 — Good result (5/6)

**Purpose.** Celebrate a successful take. All 4 rubric items met except one (a "—" dash, not a red X). Ends with a **smile reminder** — always shown, never scored.

**Layout — Phone (390px)**
- Top bar (back / "Kết quả" · "Lần thử 1" / spacer)
- Minny hero: 96×96 avatar with a soft gold radial glow behind it + two ✨ sparkles floating; heading "Tuyệt vời con ơi!" + subtitle "Con kể chuyến đi rất mượt. Thầy Phương sẽ vui lắm."
- Score card: gold gradient bg + gold border, "ĐIỂM HOÀN THÀNH" eyebrow, `5/6` (52px Manrope 800), bar-chart glyph on the right
- Rubric card: "BẢNG ĐÁNH GIÁ" eyebrow, 4 rows. Each: 26×26 circle (green ✓ or muted `—`) + label. Muted rows carry an encouraging subtext under the label.
- **Smile reminder chip**: dashed gold border, `😄` emoji, "Nhắc nhẹ từ Minny" + "Nhớ cười thật tươi khi con quay video gửi thầy Phương nhé!" — visually distinct from the rubric so it never reads as a failed item.
- Buttons (52px, radius 16px, gap 10px): secondary "Luyện lại" (transparent + cream border) + primary "Xong 🎯" (green gradient `#6fcf97 → #4fae78`, navy `#0a1622` text)

**Layout — Tablet (820px)**
- Hero row: Minny (128×128) + heading/subtitle + score (5/6, 76px) in one gold-tinted card
- 2-column grid below:
  - Left: rubric card
  - Right stack: smile reminder chip (larger — 40px emoji), "Tiến độ tuần" mini bar-chart (5 days, "Nay" highlighted with glow, T6 dashed placeholder), buttons row

**Layout — Desktop (1280px)**
- Browser chrome
- Content: 2-column grid (420px | 1fr):
  - Left: centered Minny (190×190) + heading + subtitle + gold score card (72px `5/6` + bar chart)
  - Right stack: rubric in a 2-col grid inside the card, smile chip full-width, buttons row (secondary "Luyện lại" + primary "Xong 🎯 · Về trang cá nhân")

**Rubric items (all 3 breakpoints)**
1. ✓ Nói đủ 6 câu
2. ✓ Có nhắc tới cảm xúc — subtext: "I felt happy"
3. ✓ Thời lượng ~60 giây — subtext: "58s"
4. — Nói to và rõ ràng — subtext: "Có một đoạn hơi nhỏ tiếng — không sao nha."

---

### Screen 3 — Encourage (2/6)

**Purpose.** A low-score screen that is **never a dead end** — always leads to a retry. Uses **gold** instead of red, warm encouraging voice, primary CTA is "Thử lại 🎤".

**Layout — Phone (390px)**
- Same structure as Screen 2, but:
  - Minny avatar carries a floating 💛 heart badge in the bottom-right (not sparkles)
  - Heading: "Sát rồi con ơi!" · subtitle: "Mình cùng thử lại lần nữa — Minny tin con làm được."
  - Score card is gold (not red): "ĐÃ ĐẠT" eyebrow, `2/6` in Manrope 800 52px, "Còn 4 mục để chinh phục" caption. Bars show 2 gold, 4 dim.
  - Rubric card titled "CÙNG NHÌN LẠI NÀO". Every unmet item has a soft coaching subtext (see below).
  - Same smile reminder chip
  - Buttons: secondary "Xem câu mẫu" + **primary "Thử lại 🎤"** in gold gradient `#f2cc7e → #c88f38` (navy text). Never red. Never "Fail".

**Layout — Tablet (820px)**
- Same 2-col structure as Screen 2 tablet, with an extra "Câu mẫu để tham khảo" reference card on the right showing an inline example: `Last summer, I went to Đà Nẵng. I went with my family. …I felt super excited.`

**Layout — Desktop (1280px)**
- Same 2-col structure as Screen 2 desktop
- Primary CTA reads "Thử lại 🎤 · Minny tin con làm được"

**Rubric items — Screen 3**
1. ✓ Nói đủ 6 câu — giỏi lắm!
2. — Chưa nhắc tới cảm xúc — "Thử thêm 'I felt happy' hoặc 'excited' nha."
3. — Hơi nhanh (28 giây) — "Kể chậm lại một chút, hít thở giữa các câu."
4. — Có đoạn hơi nhỏ tiếng — "Nói to hơn một xíu, như đang kể cho bạn nghe."

---

### Screen 4 — End-of-set summary

**Purpose.** Parent-facing. Overall % match to what thầy taught, per-sentence read-aloud with per-word color chips, rubric + smile reminder, listen-again, back-to-profile.

**Layout — Phone (390px)**
- Top bar with a "share" icon (list glyph) on the right
- Compact Minny row (68×68 avatar + "Minny nói" eyebrow + line "Ngon lành! Con đã sẵn sàng gửi cho thầy.")
- **Big % card**: gold gradient, eyebrow "KHỚP VỚI BÀI CỦA THẦY", `82%` (64/28), thin gold gradient progress bar underneath (82% filled), right meta "Thầy Phương · 3 câu tốt · Sẵn sàng gửi"
- **Sentences card** ("TỪNG CÂU CON NÓI"): legend chip row (Rõ / Hơi / Chưa). For each sentence, a row with numbered dot + per-sentence % + play button, then the sentence rendered as word chips. Word chip = colored underline + tinted background:
  - Green `#6fcf97` (18% bg) — correct/clear
  - Amber `#f2cc7e` (18% bg) — partial
  - Muted `rgba(170,150,115,0.5)` — unclear/missed
  - 3 sentences shown; last row has "3 câu còn lại · Xem tất cả 6 →" link
- **Rubric card**: 4-line rubric (compact, no subtext), followed by an inline dashed smile chip (13px)
- **Listen again** button (full width, 48px, secondary): "🔊 Nghe lại bản thu"
- **Primary CTA** (full width, 52px, gold): "Về trang cá nhân →"

**Layout — Tablet (820px)**
- Header includes "Chia sẻ" text button on the right
- Hero: full-width gold card with Minny (112×112) + big % (80px) + progress bar + right-side text
- 2-column content:
  - Left (1.4fr): sentences card with each sentence in its own inner card (14px padding, 14px word-chip font). "Xem tất cả 6 câu →" pill at bottom of the stack.
  - Right (1fr): rubric card + smile chip (larger emoji)
- Actions row: "🔊 Nghe lại" secondary + "Về trang cá nhân →" primary

**Layout — Desktop (1280px)**
- Browser chrome
- 2-column grid (420px | 1fr):
  - Left: centered Minny + line, then big % card (92px number + 12px progress bar + "3 câu tốt · 2 câu khá · 1 câu chưa rõ" | "Sẵn sàng gửi ✓"), then full-width "🔊 Nghe lại" secondary, then primary "Về trang cá nhân →"
  - Right (scrollable): sentences card with a **2×2 grid** of 3 sentence cards + a "+3 câu khác · Xem tất cả →" placeholder tile. Below, another 2-col grid: rubric card | smile chip card.

---

## Design Tokens

### Colors
```
/* Page background (darker than DS navy-950) */
--bg-page:        #0a1622

/* Navy palette (surfaces) */
--navy-950:       #10273a   /* device/page surface */
--navy-900:       #17354a   /* section bg */
--navy-850:       #1d3f58   /* raised surface */
--navy-800:       #244a64   /* hover / hairline-on-navy */
--navy-darker:    #0e2233   /* browser chrome bg */

/* Gold (accent) */
--gold:           #c88f38   /* primary accent */
--gold-light:     #f2cc7e   /* hover / highlight */

/* Cream (text) */
--cream:          #f5e6c8   /* strong text */
--cream-muted:    #d9c7a4   /* body text */
--cream-dim:      #aa9673   /* caption / hairline */

/* Status */
--success:        #6fcf97
--danger:         #f87171   /* used ONLY for the red REC button */

/* Translucent surfaces (used inline) */
surface-card:      rgba(23,53,74, 0.55–0.7)
surface-gold-hero: linear-gradient(180deg, rgba(200,143,56,0.18), rgba(200,143,56,0.06))
border-subtle:     rgba(170,150,115, 0.20)
border-strong:     rgba(217,199,164, 0.40)
border-accent:     rgba(200,143,56, 0.40)
```

### Typography
- Display / headings / numbers: **Manrope** (weights 700, 800)
- Body / UI: **Inter** (weights 400, 600, 700)
- Both loaded with the Vietnamese subset

Scale used in this feature:
- Big hero number (82%): 64–92px, Manrope 800, line-height 1
- Section eyebrow: 11–12px, Manrope 800, letter-spacing 0.14em, uppercase, `#c88f38` or `#f2cc7e`
- Screen title (device header): 15–20px, Manrope 700–800
- Rubric label: 14–15px, Inter regular, cream
- Rubric subtext: 12–13px, Inter regular, `#aa9673`
- Timer numerals: 40–56px, Manrope 800, `font-variant-numeric: tabular-nums`

### Spacing
Native mobile: 16 / 20 / 24 gutters. Radii: `md 8`, `lg 12`, `xl 16`, `2xl 20–24`, `full 999`.

### Shadows
- Card lift: `0 10px 24px -8px rgba(200,143,56,0.5)` (gold CTA)
- Green CTA lift: `0 10px 24px -8px rgba(111,207,151,0.5)`
- Ambient card: `0 40px 80px -30px rgba(0,0,0,0.7)`
- Focus ring (per DS): 2px `--gold-light`, 4px offset

### Radii
- Buttons / inputs: `md 8–14px`
- Cards: `xl 18–22px`
- Hero panels / device: `2xl 22–44px`
- Pills / avatars / smile chip: `full`

---

## Interactions & Behavior

### Recording (Screen 1)
- Tap red button starts recording; button pulses (`box-shadow` ring, 1.6s ease-out infinite; a smaller white square dot inside blinks at 1.2s)
- Timer counts up; ring stroke-dashoffset animates toward target (60s)
- Space bar toggles start/stop on desktop
- Long-press a numbered stem could preview a spoken example (optional)
- Reduced motion: kill `recPulse`, `recDot`, `minnyBob` animations

### Result screens (2, 3, 4)
- No modal or blocking states — always a forward path
- Screen 3 must **never** use `#f87171` for score, background, or CTA
- Primary CTA text on 3 must be a forward action ("Thử lại", "Try again"), never "Fail" / "Sai" / "Không đạt"

### Smile reminder — critical rule
- Always shown on Screens 2, 3, and 4
- Rendered as a **dashed-gold pill/chip**, visually distinct from the checkmark rubric list
- Never counted in the score
- Never rendered as pass/fail (no ✓ or —)

### Voice & copy rules
- Vietnamese-first UI; English appears only inside homework content (the stems, the recorded sentences)
- Teacher is always **"thầy Phương"** — never "cô"
- "Con" for the child; warm, first-name-teacher voice
- Retry copy is warm ("Sát rồi con ơi!", "Mình cùng thử lại"), never punitive

### Responsive
- Phone (~390): single-column stack
- Tablet (~768–1024): 2-column below hero row; larger touch targets (≥44px); still touch-first
- Desktop (~1280+): content centered with a max-width, not a stretched phone; Screen 1 gets a 3-column recorder layout with a mascot rail

---

## State Model (minimum)

```
{
  studentCode: string,           // maps to a child's account
  teacherName: "thầy Phương",    // constant for this handoff
  lesson: {
    week: number,
    title: "My Trip Story",
    stems: string[6],
    targetDurationSec: 60,
  },
  attempt: {
    number: number,
    state: "idle" | "recording" | "processing" | "done",
    elapsedSec: number,
    audioUrl?: string,
  },
  result: {
    matchPct: number,            // Screen 4 overall (e.g. 82)
    rubric: {
      spokeAllSix: boolean,
      mentionedFeeling: boolean,
      durationOnTarget: boolean,
      spokeClearly: boolean,     // never pass/fail — a soft signal
    },
    sentences: {
      text: string,
      pct: number,
      words: { text: string, quality: "clear" | "partial" | "unclear" }[]
    }[],
  }
}
```

Score-to-screen mapping: `attempt.result.rubric` truthy count → Screen 2 (≥4 met) vs Screen 3 (<4 met). Screen 4 opens from the end-of-set summary regardless of scores.

---

## Assets

- **Mascot (Minny):** currently rendered as the 🐨 koala emoji inside a navy circle with a soft gold ring. Replace with a proper illustrated koala when the illustrator delivers.
- **Icons:** hand-drawn inline SVGs (chevron/close/back/share). Match stroke-width 2, `stroke-linecap="round"`, `stroke-linejoin="round"`. No icon-font dependency.
- **Fonts:** Manrope + Inter from Google Fonts, Vietnamese subset.
- **No brand logo yet** — replace the "SpeakUp" wordmark placeholder with the real logo when available.

---

## Files

- `SpeakUp Phase 7a.dc.html` — the full design canvas (all 4 screens × 3 breakpoints). Open in a browser to inspect exact values (colors, spacing, gradients) with devtools.
- `_ds/felix-coaching-design-system-.../` — the Felix Coaching design system used as the visual foundation. `tokens/*.css` files map 1:1 to the design tokens above.

## Notes for the implementing developer

- Recreate against the app's existing component library. Don't ship the raw HTML.
- The smile-reminder rule is a **product rule**, not just a visual one — if the rubric grows in the future, the smile item must stay a standalone reminder.
- Screen 3's non-punitive treatment is a **design principle** — extend it to any future low-score state.
- All animations honor `prefers-reduced-motion`.
