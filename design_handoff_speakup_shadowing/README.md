# Handoff: SpeakUp — Shadowing (kids' video speaking practice)

## Overview

Shadowing is a new SpeakUp page for Vietnamese kids (~6–10, phone-first 390px). The child watches a YouTube cartoon one sentence at a time, records themselves saying the sentence (≥50% word match unlocks the next), answers quick tap-questions at story moments, and collects stars + streaks. Teacher is always **thầy Phương** (never "cô"); the child is "con"; the mascot **Minny is a red robot** (PNG assets in `assets/`).

**Visual direction: "night arcade / theater marquee"** on the Felix Coaching navy-gold brand — sentence words are marquee tiles that light up when said correctly, the mic is a big glowing gold coin, progress is a 12-bulb marquee strip. One dominant action per screen; every tap target ≥44px.

The HTML files are **a specification, not source** — recreate them inside the existing codebase (see build contract below).

## About the design files (READ FIRST — how to consume `.dc.html`)

Each `NN *.dc.html` file is a design reference authored in a component format. To read one:
- The design markup is everything between `<x-dc>` and `</x-dc>`. **All styling is inline** on each element — treat those inline styles as the exact spec (colors, px values, radii, shadows, fonts).
- Ignore `support.js`, `<script data-dc-script>`, and `{{ … }}` / `<sc-if>` wrappers — they are preview-tooling. `<sc-if value="{{ starsOn }}">` simply means "this block is the star layer; render it (it's on by default)".
- The `<helmet><style>` block at the top holds the only non-inline CSS: font imports, `@keyframes`, body background, and the reduced-motion override. Port these as-is.
- File 04 also defines `--shd-*` CSS variables in `:root` — these are the theme tokens; their default values are the approved theme.
- Screenshots of every screen are in `screenshots/` — the implementation must match them.

## Implementation contract (non-negotiable)

Previous implementation attempts drifted from this design. To pass review, the build MUST:
1. Copy colors, spacing, radii, shadows, and font sizes **verbatim from the inline styles** — do not substitute design-system defaults, Tailwind approximations, or "close enough" values.
2. Use the exact fonts: Baloo 2 (700/800, Vietnamese subset) for display/tiles/buttons/numbers, Manrope 800 for uppercase eyebrows, Inter for body. No other fonts.
3. Keep every Vietnamese string character-for-character (including punctuation and emoji) as written in the files.
4. Reproduce the star layer, 12-bulb strip, marquee word tiles (3 states), and gold-coin mic exactly as specced in Design tokens below.
5. Preserve the region ids listed in Build contract as DOM ids or data-testids.
6. After building each screen, screenshot it and diff against `screenshots/NN.png`; iterate until visually identical at 390px width (desktop file: 1280/820).
7. Never introduce: red for errors/streaks (only the recording dot is #f87171), digit-cell code inputs, external-link affordances on video, or any punitive copy.

## Fidelity

**High-fidelity.** Colors, spacing, type, radii, shadows, and all kid-facing copy are final. Vietnamese strings from the brief are used verbatim. Video thumbnails and the video region are striped placeholders — the video region is a real 16:9 YouTube iframe in production (design specifies its frame/chrome only, never its contents; no external-link affordance anywhere).

## Files

| File | Screen | States shown |
|---|---|---|
| `01 Code Gate - Video Picker.dc.html` | Code entry + picker | main · empty picker · unplayable video · tablet 820 · desktop 1280 |
| `02 Watching.dc.html` | Watching | watching (bulb 5 pulsing) · tablet 820 · desktop 1280 |
| `03 Tap Question.dc.html` | Tap question | correct-selected · gentle wrong reveal · tablet 820 · desktop 1280 |
| `04 Record - Karaoke.dc.html` | Record + karaoke (core) | mic idle · recording with 3 live word states |
| `05 Celebration - Waiting.dc.html` | Pass celebration | star pop + streak tick · waiting overlay · tablet 820 · desktop 1280 |
| `06 Retry - Third Miss.dc.html` | Warm retry | retry · third miss (calm 🔥 0) · rest state · tablet 820 · desktop 1280 |
| `07 Video Complete.dc.html` | Video complete | celebration + stat tiles · tablet 820 · desktop 1280 |
| `08 Tablet - Desktop.dc.html` | Responsive | desktop 1280 (browser chrome) · tablet 820 |

## Design tokens

Base: Felix Coaching Design System (`--navy-950 #10273a` surfaces… `--cream-dim #aa9673`), page canvas brightened to `#143050` on an `#0b1c30` backdrop (owner-approved "night sky full of stars": every screen carries a layer of 2–3px twinkling cream-gold stars behind the content).

Shadowing-specific recipes:

```
page bg           #143050 on #0b1c30 backdrop (+ radial gold vignettes)
star dots         2–3px #fff3d6 / #ffe9b8; big ones glow 0 0 6px rgba(255,240,200,.8);
                  twinkle (opacity .2→1, 2.4–3.4s staggered); static at reduced motion
surface card      #1d4468 → #173a58 gradients; raised tile #1b3a57; pills rgba(35,72,102,.8)
bulb lit          #f2cc7e; box-shadow 0 0 10px 2px rgba(242,204,126,.5)
bulb current      lit + pulse (scale 1→1.15, 1.3s)
bulb unlit        #1b3a57; 1px rgba(170,150,115,.2); inset 0 2px 4px rgba(0,0,0,.5)
word not-yet      bg #1b3a57; text rgba(217,199,164,.6); 1px rgba(170,150,115,.22); inset shadow
word close (warm) bg rgba(200,143,56,.22); text #f2cc7e; 1px rgba(200,143,56,.55); soft gold glow
word correct      bg linear-gradient(180deg,#f8d98f,#dfae52); text #132c42; 1px #f2cc7e;
                  0 0 18px rgba(242,204,126,.45) + 0 3px 0 #8f5f1d
mic coin          radial-gradient(circle at 35% 28%, #ffe9b0, #f2cc7e 38%, #d9a247 66%, #a9752a);
                  3px #8f5f1d rim; 0 10px 0 #7a4f16 bevel; recording adds expanding ring pulse
primary CTA       linear-gradient(180deg,#f2cc7e,#c88f38); text #10273a; 0 6px 0 #7a4f16; radius 18–20
secondary CTA     transparent; 2px rgba(217,199,164,.32); text #d9c7a4
header pills      rgba(23,53,74,.7); 1px hairline; radius 999 (streak pill gold-bordered; 🔥 0 = dim, never red)
video frame       radius 18–22; 1px rgba(200,143,56,.4); 0 0 36px rgba(200,143,56,.12–.14)
danger #f87171    ONLY the recording caption dot — never scores, CTAs, or backgrounds
```

### Typography
- Kid-facing display (headlines, word tiles, buttons, big numbers): **Baloo 2** 700–800 (Vietnamese subset) — added for the game voice; approved fallback is Manrope 800.
- Eyebrows/labels: **Manrope** 800, 11–12px, letter-spacing 0.12–0.14em, uppercase, gold.
- Body/captions: **Inter** 400–600.
- Minimum kid-facing text 14px; word tiles 18–22px; hit targets ≥44px.

### Iconography
Emoji as written in the copy (⭐ 🔥 💛 🔊 🎤 🌙) — no icon font. Mic and play glyphs are inline SVG (stroke 2.4, round caps).

## Per-screen layout notes

### 1 — Code gate + video picker (390)
Stack, 20px gutters: logo row → **ticket-booth code card** (`shd-code-card`: gold border, 5 marquee bulbs, heading, ONE wide 58px input `shd-code-input` with placeholder `VD: R2L-LINH-8F3KQ2` — never digit cells, code font Manrope 700 centered) → 58px "Vào xem!" CTA → picker (`shd-video-picker`): 2-col poster grid. Poster card: 16:10 thumb (striped placeholder + play disc; played = gold disc, unplayed = dimmed cream disc), Vietnamese title, L1–L5 gold pill, ⭐ count or "Chưa luyện". Draft videos: `BẢN NHÁP` cream badge top-left of thumb. Edge states shown beside phone: empty picker, unplayable video.

### 2 — Watching (390)
Header: 44px back circle + ⭐ pill (`shd-stars`) + 🔥 pill (`shd-streak`). 16:9 gold-framed video (`shd-player-host` with `shd-player-overlay` vignette) → 12-bulb strip (`shd-progress`, always exactly 12; lit as overall progress passes each twelfth; current pulses) → single instruction line → Minny bust bobbing + caption. **No competing buttons.**

### 3 — Tap question (390)
Dimmed video strip stays on top. `shd-question-card`: Minny face + speech bubble (radius 4 20 20 20), 3 stacked 64px tap options. Correct-selected: gold gradient + ✨ pop. Wrong reveal (frame 2): correct answer softly gold-outlined, chosen one calmly dimmed with "con đã chọn", third faded — no red, no shaming — then one "Xem tiếp ▸" CTA.

### 4 — Record + karaoke (390) — the core
Paused video (dim + pause bars) → 12-bulb strip → sentence as marquee word tiles (`shd-words`) → **gold coin mic** 112px (`shd-mic-btn`) → caption → "🔊 Nghe lại câu" pill (`shd-replay-btn`, dimmed while recording). Idle: all tiles unlit, caption "Bấm micro rồi nói cả câu nhé!". Recording: expanding ring pulse on the coin, red blinking dot + "Đang ghi âm… nói cả câu nhé!", tiles show all 3 live states (correct / close-warm / not-yet).

### 5 — Pass celebration + waiting (390)
Celebration: gold confetti falls, ⭐ pop with "+1", "Tuyệt vời!", glowing "🔥 Chuỗi 4!" pill, Minny bounces, header pills tick to ⭐ 13 / 🔥 4, ONE CTA "Câu tiếp theo →" (`shd-next-btn`). Waiting variant: record screen blurred underneath, centered card with Minny + 5-bar gold equalizer + "Minny đang nghe…" animated dots — alive, never frozen.

### 6 — Warm retry + third miss (390)
Retry: Minny with floating 💛, "Gần đúng rồi! Nghe lại nha", **already-lit tiles stay lit**, helper line, primary "Thử lại 🎤" + secondary "🔊 Nghe lại câu". Third miss: "Nghe lại rồi mình qua câu tiếp nhé! 💛", streak pill calmly shows 🔥 0 (dim style, never red, never announced), stars unchanged, one "Câu tiếp theo →". Rest state card: 🌙 + "Nghỉ một chút nhé!" + passive timer bar.

### 7 — Video complete (390)
All 12 bulbs lit and twinkling, confetti, big Minny, "Con làm được rồi!", `shd-summary` stat tiles (Tổng sao ⭐ 14 · Chuỗi dài nhất 🔥 6), reward CTA "Xem trọn video" with inline play triangle (**no external-link affordance** — plays inline), quiet "← Chọn video khác" link.

### 8 — Tablet 820 / Desktop 1280 (record screen deep dive)
Every screen file (01–07) now also carries its own tablet 820 and desktop 1280 frames below the phone frames — same elements, wider layout: desktop uses browser chrome + app header (logo · "SpeakUp · Shadowing · thầy Phương" · pills) with content either centered (max ~880px) or split video-left/interaction-right; tablet keeps the "‹ Quay lại" pill header. File 08 is the record-screen deep dive: video + 12 bulbs + Minny caption left; gold-bordered recorder panel right (word tiles, mic coin 104–120px, caption, replay). Desktop adds browser chrome + app header (logo · "SpeakUp · Shadowing · thầy Phương" · pills). Tablet keeps a "‹ Quay lại" pill, touch-first.

## Reduced-motion notes (per screen)

All files include `@media (prefers-reduced-motion: reduce){*{animation:none;transition:none}}`. Semantics per screen:
1. Bulbs render statically lit; no bob.
2. Current bulb: static brighter glow instead of pulse; Minny bob off.
3. ✨ pop renders at final state instantly.
4. Mic ring pulse off (keep static outer glow); red dot solid; word "close" glow static.
5. No confetti or star pop — show final composition; equalizer bars replaced by a static "Minny đang nghe…" with ellipsis; never a frozen-looking spinner-less blank.
6. Heart float off.
7. No confetti; bulbs statically lit; Minny static.
8. Same as 2/4.

## New copy for teacher review (everything not verbatim from the brief)

- "Tấm vé vào rạp của Minny đây!" (code card subtitle)
- "Nhập mã của con" (code card heading)
- "Chọn phim để luyện" (picker eyebrow)
- Video titles: "Bé Gấu Làm Bánh", "Chú Sói Nhỏ Đi Học", "Mèo Tom Phiêu Lưu", "Robot Và Khu Vườn" (sample data)
- "Chọn phim khác" (unplayable-state CTA)
- Question sample: "Chú sói nhỏ đang đi đâu?" / "Đến trường" / "Đi chợ" / "Về nhà"
- "Đáp án là "Đến trường" nha. Mình xem tiếp nhé!" (gentle wrong reveal)
- "· con đã chọn" (wrong-pick suffix), "Xem tiếp ▸" (post-question CTA)
- "Từ nào sáng rồi thì vẫn sáng mãi nha!" (retry helper line)
- "Đến lượt con" (desktop recorder panel eyebrow)
- Sample sentence: "The little wolf goes to school."

## Build contract

Region ids preserved in the HTML: `shd-code-card`, `shd-code-input`, `shd-video-picker`, `shd-player-host`, `shd-player-overlay`, `shd-words`, `shd-mic-btn`, `shd-replay-btn`, `shd-next-btn`, `shd-question-card`, `shd-stars`, `shd-streak`, `shd-progress`, `shd-summary`. Where a file shows the same screen in two states, the id sits on the first (canonical) frame.

Behavior notes: ≥50% word match (server-side) unlocks the next sentence; wrong tap-answers reveal gently and move on (never blocking); progress (lit words) is never taken away; streak reset shows calmly (🔥 0), stars never decrease; the grading wait (1–3s) must always show the live "Minny đang nghe…" treatment.

## Decisions taken in this pass (owner to confirm)

- Direction: "night arcade / marquee" on a brighter starry-night navy (owner-approved). Screen 4 carries the live theme tweaks (skyTone / goldTone / starrySky); approved defaults: bright sky, brand gold, stars on.
- Baloo 2 added as the kid-facing display face (headlines, tiles, buttons, numbers). Drop to Manrope 800 everywhere if you prefer zero new fonts.
- All 4 Minny pose slots currently use the same M0 artwork (crops in `assets/`). When distinct pose PNGs land, map: idle→watching, listen→recording/waiting, celebrate→screens 5/7, encourage→screen 6.
