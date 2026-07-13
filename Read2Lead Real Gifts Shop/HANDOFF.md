# Quà thật (Real Gifts) — Build spec for Claude Code

Rebuild target: `Qua-That-Gift-Shop.dc.html` (7 screens). Follow this file
literally — every value below is taken from the repo, not invented. If a value
here conflicts with your instinct, this file wins.

## 0. Rules that get a build REJECTED (check these first)
1. Dark only. No light background, no light mode, ever.
2. Vietnamese only in every label/button/hint. Numbers `10.000` not `10,000`.
3. Diamonds are **💎 kim cương**. Coins are **🪙 xu**. This shop spends 💎 ONLY.
   Never put 🪙 on a shop action.
4. `cost_vnd` (Giá thật ₫) and `₫/💎` appear ONLY in the two admin panels
   (§6, §7), never on a kid or parent screen.
5. No inventory language anywhere in kid view: no "hết hàng", "còn lại N",
   "tồn kho", "sold out". Supply is unlimited (buy-on-demand).
6. No "locked"/greyed unaffordable gift. Unaffordable = **in progress** with a
   progress bar + "Con đã đi được X% chặng đường".
7. Banned: orange accents, Baloo 2 font, `r2l-kid-*` classes.
8. Honor `prefers-reduced-motion: reduce` (disable pulse/shimmer/float).
9. Tap targets ≥44px; kid primary buttons 56–64px.
10. **The teacher is "Coach Felix" and he is MALE.** Never write "cô" (female
    teacher). `Coach Felix đang chuẩn bị quà cho con`, never `Cô đang…`. It is
    a name — no classifier in front of it. Applies to every screen.

## 1. Exact tokens (from src/styles/design-system.css — use the CSS vars, don't hardcode)
```
--navy-950 #10273a (page)  --navy-900 #17354a (card band)
--navy-850 #1d3f58 (raised) --navy-800 #244a64 (hover)
--gold #c88f38  --gold-light #f2cc7e
--cream #f5e6c8  --cream-muted #d9c7a4  --cream-dim #aa9673
--success #6fcf97  --danger #f87171
--surface-card = navy-900 @70%   --accent-border = gold @40%
--border-subtle = cream-dim @20%
--radius: md .5rem / lg .75rem / xl 1rem / 2xl 1.5rem / full 9999px
--shadow-card, --shadow-2xl, --ring-accent (gold halo)
font: Manrope (display, 600–800) + Inter (body). Vietnamese subset.
```
Reuse the existing primitive CLASSES, do not re-style raw HTML to imitate them:
`.fx-btn` (`--primary`/`--secondary`/`--ghost`/`--block`), `.fx-card`
(`--accent`/`--raised`), `.fx-badge` (`--accent`/`--gold`/`--neutral`/`--solid`),
`.fx-field`, `.fx-label`, `.fx-eyebrow` (11px uppercase .1em gold-light 800),
`.fx-progress` + `.fx-progress__fill` (`--gradient` = moving gold gradient).
This is the SAME set the monster shop and ho-so pages use.

## 2. The photo well (the core component — get this exact)
Named `GiftPhotoWell`. Aspect 4/3 (banner variants 16/9).
```
background: radial-gradient(120% 120% at 50% 22%, #274563 0%, #14304600 62%),
            linear-gradient(180deg,#1d3f58,#11283b);
box-shadow: inset 0 0 0 1px rgba(245,230,200,.10),   /* hairline */
            inset 0 -46px 54px -34px rgba(0,0,0,.72); /* bottom vignette */
border-radius: 12px; overflow: hidden;
```
- Real photo (Shopee/Lazada cut-out on white): render with **object-fit:contain**
  + padding so the cut-out floats inside the tinted well and the white edge
  does NOT glare against navy. In the reference this is an `<image-slot fit="contain">`
  layered over the well (well sits behind at z-index:-1).
- Fallback (no photo yet): the SAME well with a large centered emoji (52–66px):
  🌟 sticker · 🖊️ bút · ✏️ hộp bút · 🧋 trà sữa · 🧱 lego · 📚 sách · ⚽ bóng · 🎁 generic.
  Must look deliberate, never broken. In code: `<img onerror>` → emoji fallback.

## 3. Real data (use verbatim — no dummy numbers)
Balances: Hieuenzo 4.295 · Percy 3.135 · Ryan 1.250 · Mina 1.160 · Hoang 375 · Pilot 0.
Catalogue (price 💎 / emoji / real ₫ / ≈₫per💎 — last two admin-only):
```
Sticker    1.000  🌟   2.000₫   ≈2₫
Bút        5.000  🖊️   8.000₫   ≈2₫
Hộp bút    7.000  ✏️  25.000₫   ≈4₫
Trà sữa   10.000  🧋  30.000₫   ≈3₫
Bộ Lego   20.000  🧱 400.000₫   ≈20₫   ← 6× worse value than tea (quiet signal)
Sách      20.000  📚  90.000₫   ≈5₫
Quả bóng  30.000  ⚽ 150.000₫   ≈5₫
```
Main shop demo child = Hieuenzo 4.295 → sticker affordable (100%), bút 86%,
hộp bút 61%, trà sữa 43% (pinned goal), lego/sách 21%, bóng 14%.

## 4. Per-screen build notes
**§1 Shop (/read2lead/gifts):** header with big 💎 balance ("Kim cương của con"),
pinned goal card (photo+name+price+bar+"Con đã đi được 43%…"), then catalogue in
**3 bands** (order by proximity, NEVER badges-only): "✓ Con có thể đổi ngay" (green
border) · "Sắp đủ rồi" (gold) · "Con đang xây dựng" (neutral). Mobile 390 shows
~4 cards in a phone frame + back arrow; desktop is the 3-col grid, all 7. Every
card has a progress bar; far cards say "mục tiêu cả năm ⚽" not "locked".

**§1c 5 card states + near-miss + empty:**
- Đang tiết kiệm: neutral badge, gradient bar, "Đặt làm mục tiêu ★".
- **Near-miss (loudest state):** gold-light 1.5px border + `qt-pulse` glow, bar 99%,
  "Chỉ còn 10 💎 nữa thôi! 🔥" + "Buổi học tới của con là đủ rồi!". This is TuAnh
  990/1000. Design it as the best moment in the app.
- Đổi được rồi: green badge, `fx-btn--primary` 56–64px "Đổi quà ngay 💎".
- Đang chờ Coach Felix duyệt: neutral "⏳", disabled action, "-10.000 💎".
- **Đang chuẩn bị quà:** warm/active NOT a cold spinner — `qt-shimmer` gold well +
  "Coach Felix đang chuẩn bị quà cho con — sắp mang tới lớp rồi! 💛". Kills the
  "app stole my diamonds" fear during the buy-it-in-real-life delay.
- Đã nhận quà: green ✓ badge + 🏆 + "Nhận ngày 12/03/2026".
- Empty: dashed border, 🎁, "Chưa có quà nào" + back link.

**§2 Confirm modal:** photo, "Con muốn đổi 10.000 💎 lấy Trà sữa?",
"Kim cương sẽ bị trừ ngay.", balance before→after chip (12.400 → 2.400),
primary 64px "Đúng rồi, đổi quà! 💎" + equally-easy secondary "Để con nghĩ thêm".
(Modal uses an affordable near-future balance because no child can afford tea today.)

**§3 Success modal:** gold orb + 🧋, "Tuyệt vời! 🎉",
"Coach Felix sẽ chuẩn bị và trao Trà sữa cho con ở lớp nhé 🧋", + a 💛 note that sets the
"arrives in class after a short wait" expectation, new balance, CTAs.

**§4 GiftGoalCard (reused 4×):** wide (lesson-end/desktop) + narrow (mobile).
On the lesson-end screen: show "+40 🪙 xu" earned from reading, THEN the goal card
with "🧋 Trà sữa — 3.400/10.000 💎 · Kim cương đến từ lớp học và SpeakUp!" —
never make the reading feel worthless; diamonds come from class, gently.

**§5 Parent view:** inside weekly report, "Con đang tiết kiệm cho: 🧱 Bộ Lego — 34%",
photo + bar + a 💎 note that diamonds come from live class (300–1.000/buổi) → bring
the child to class. Warm, proud, no cost_vnd.

**§6 Admin gift manager:** "chỉ Felix thấy 🔒". Table cols: Ảnh · Tên · Giá 💎 ·
Giới hạn · Bật(toggle) · **Giá thật ₫ 🔒** · **₫/💎 🔒**. One row expanded showing
BOTH photo paths equally: 🔗 paste URL (badge "Đang dùng") AND 📁 upload file, live
thumb either way. "+ Thêm quà" + one "✓ Đã lưu" button. "Giới hạn" = budget guard,
blank=unlimited (the normal case); only Lego:2, bóng:1. Note explains it's NOT stock.

**§7 Redemption queue (a shopping list):** monthly total "455.000₫ 🔒". 3 lanes:
Yêu cầu mới (Nhận & đi mua → / Từ chối+hoàn 💎) · Đang chuẩn bị = to-buy list with
**waiting-time urgency** (Ryan "⚠ chờ 9 ngày" in danger tint = breaking promise) ·
Đã trao quà history with ₫. A green reassurance box: "Từ chối tự động hoàn toàn bộ
💎 cho con ngay" so Felix never fears rejecting.

## 5. Motion (keyframes, all gated by reduced-motion)
`qt-pulse` gold ring (near-miss) · `qt-shimmer` moving gold gradient (preparing) ·
`qt-float` 5px bob (hero emoji). Transitions 250ms ease-standard, color not scale.

## 6. Component names I introduced (name them the same in code)
GiftPhotoWell · GiftCard (state prop: saving | nearmiss | affordable | pending |
preparing | delivered) · GiftGoalCard (wide|narrow) · AdminGiftRow · RedemptionRow.
