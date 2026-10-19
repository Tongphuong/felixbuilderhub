# Screen-by-screen spec — "Đảo phiêu lưu"

Screens in priority order. For each: the reference images, the one primary action, the element list (top → bottom at 390), states, motion, and how it changes at 1280. Copy in **bold quotes** is existing wording from the code unless README §7 lists it as new.

Shared top bar (kid screens): rank chip (shield icon tier-coloured + "Bạc ★★"), streak chip (flame + "3 ngày"), diamonds chip (💎 icon + "55"). White pills, 48px tall, sky-blue hard shadow. Inner screens instead use a white **"← Về đọc sách"** / **"← Về nhà"** back pill (48px) at top-left.

Scene: sky `#9BDDFF` ground, sun top-right, 1–2 drifting clouds, two hill bands across the bottom of the hero (~y 280–430 at 390). Decoration is `aria-hidden`.

---

## 1. Kid home — "Góc đọc sách của con"
Refs: `01-home-390.png`, `01-home-1280.png`, `S1-home-mid-story-390.png`, `S5-empty-no-story-390.png`
**Primary:** "Mở truyện →" (first visit) / "Đọc tiếp →" (mid-story) / "Mở thư viện →" (no story yet).

1. Top bar (rank, streak, diamonds).
2. Hero: label **"Góc đọc sách của con"** + H1 **"Chào [tên]!"** (Baloo 46) on the left; the child's monster (≈180px) on the right standing on the hill, with a speech bubble ("Hôm nay có truyện mới!" / "Mình đọc tiếp nhé!"). Monster bobs; greeting pops in.
3. Story card ("Chuyến phiêu lưu hôm nay", tag "Mới"): cover thumbnail 112px, English title, level tag + page count, then the one big yellow button. Mid-story: replace tags with "Con đang ở trang 3 / 6" + progress bar. The card overlaps the hero by only 16px so the monster stays visible.
4. Map panel "Bản đồ hôm nay" (sand): dotted path through 3 stops — **1 · Đọc**, **2 · Trả lời Minny** (Minny face in the node), **3 · Kể qua tranh** — states: done = leaf + white tick; now = white/yellow node with halo + ink tag "Bắt đầu ở đây"; next = dashed, never locked-looking. Finish row: flag + "Về đích: nhận kim cương và XP cho cả 3 bước".
5. Rank progress card: "Sắp lên Bạc ★★★" + bar + "320 / 400 XP" (only if the rank ladder provides this — see README §7).
6. Leaderboard panel (leaf): **"Bảng xếp hạng"**, two cream columns side by side — XP top-3 and Kim cương top-3 (medal circle 1/2/3 gold/silver/bronze, avatar 34px, name with ellipsis, value). Link below: **"Đọc truyện để lên bảng nhé!"** · Xem cả bảng.
7. **"Đổi bạn đồng hành"** — full-width white button with the child's avatar.
8. **"Dành cho ba mẹ"** — underlined link, 48px tall.

Empty state (S5): monster sleepy with floating "z"; card shows a dashed book tile + "Truyện mới đang trên đường tới!" + explanation + "Mở thư viện →".
1280: 3 columns — left: greeting (56px) + bubble + big monster (250) + "Đổi bạn đồng hành"; centre: horizontal story card (220 cover, 40px title, 72px button) + wide map; right: rank progress, leaderboard (XP block then Kim cương block, coloured rows), "Dành cho ba mẹ".

## 2. Reading a book, page by page
Refs: `02-reading-390.png`, `02-reading-1280.png`, `S2-reading-last-page-390.png` — **lesson.astro is protected: style only.**
**Primary:** "Trang tiếp →"; last page: "Hoàn thành trang →", then "Lưu chiến công 💾".

1. Back pill **"Về nhà"** + segmented page progress (done leaf, current sun, next cream) + "Trang 3 / 6".
2. Page picture in a 26px-radius ink-outlined frame with hard shadow; story title tag top-left.
3. Story text card (cream): English, Nunito 800 25px, line-height 1.5; the word being read can be highlighted sand. Small monster peeks from the card corner.
4. Two equal white buttons, icon above label: **"🎤 Con nói"** (red mic icon) and **"🔊 Nghe Minny đọc lại"** (blue speaker). 84px tall.
5. Question card: Minny face (48px, red ring) + "Minny hỏi · chọn 1 nhé" + English question; two full-width option buttons (64px, letter badge). Chosen correct → green tint, leaf tick, "Giỏi lắm!" pops in. Wrong → never red: soft sand tint, "Gần đúng rồi!" + show the right answer.
6. Yellow **"Trang tiếp →"**.

Last page (S2): progress all green + "Trang 6 / 6 · Trang cuối!"; after "Hoàn thành trang" the button turns into a green "✓ Hoàn thành trang" pill, and a white card rises with the dancing monster, "Con đọc hết 6 trang rồi!", "Bấm Lưu để giữ chiến công và nhận thưởng nhé." and the yellow **"Lưu chiến công 💾"** (72px).
1280: picture 55% left (640px tall); right column: text (32px), the two voice buttons side by side, question with options side by side, "Trang tiếp" right-aligned.

## 3. Minny voice story
Refs: `03-minny-voice-390.png`, `03-minny-voice-1280.png`, `S4-minny-resting-390.png`
**Primary:** the big mic "Bấm rồi nói câu trả lời".

1. Back "Về nhà" + "Câu 2 / 4" + 4 dots.
2. "Bước 2 · Trả lời Minny"; Minny talking face 168px in red-ring porthole with halo; audio-bars pill while she speaks.
3. Question card: "Minny đang hỏi:" + English question (Baloo 26) + white "🔊 Nghe lại câu hỏi".
4. Big round sun mic button 128px (aria-label "Con nói") + label.
5. Feedback row at the bottom: monster + bubble — **"Great job!"** in green, or **"Good try! The answer is…"**, with a Vietnamese line.
States to style from the existing cues in `read2lead-story-voice.mjs`: Minny speaking (talk face + bars), listening (use `minny-listen.svg` or face + pulsing mic), thinking/grading, reply.

Minny resting (S4): sky goes paler `#CBE6F7`, moon, Minny sleeping face, floating "zZ", ink tag "Minny đang nghỉ ngơi", card "Minny ngủ một chút nha!" + **`VOICE_POOL_REST_VI`** verbatim (bold "Bài của con đã được lưu."), dashed info row "Phần nói với Minny tạm nghỉ. Đọc sách vẫn mở như bình thường.", monster bubble, yellow "Về đọc sách →". No red, no error tone.
1280: Minny + question left, mic + feedback right.

## 4. Finish & reward + rank-up
Refs: `04-reward-390.png`, `04-reward-1280.png`, `S3-rank-up-390.png`
**Primary:** **"Xong hôm nay"** (D4); secondary white **"Đọc thêm truyện"**.

Reward: confetti (6–7 pieces) + ink-outlined sand starburst behind the dancing monster (190px) → H1 "Con đã đọc xong “[title]”" → two cream tiles "+35 kim cương" / "+20 XP" (Baloo 40, popping in 0.5s / 0.8s) → white card with three leaf ticks "Về đích!" + XP bar filling to the new value → buttons. Values come from `gradeRewards()` (S/A/B/F); grade F (0/0) must still celebrate finishing, never "you lost".
Rank-up (S3): full-screen leaf `#237A41` with soft rays, "HẠNG MỚI CỦA CON", big tier-coloured shield with stars (new star pops in + "Sao mới!" tag), "Bạc ★★★" (44px white), one line, dancing monster, yellow "Tuyệt vời!". Show after reward when the rank changes.

## 5. Companion — "Bạn đồng hành"
Refs: `05-companion-390.png`, `05-companion-1280.png`
**Primary:** **"Lưu bạn đồng hành"**.
Back **"Về đọc sách"**; label **"GÓC CỦA CON"** → H1 **"Bạn đồng hành"** + **"Chọn dáng con thích. Tất cả đều miễn phí."**; stage card (sand, hill, sparkle effect) with the live avatar preview bobbing + bubble "Đẹp quá!"; card **"Con muốn đổi phần nào?"** with 12 wrapping category buttons (Thân, Mắt, Miệng, Mũi, Lông mày, Sừng, Râu, Chi tiết, Mũ, Cánh, Thú cưng, Hiệu ứng — from `monster-builder.ts`); option tiles grid (3 cols / 4 at 1280; first tile "Không dùng" dashed; selected tile sun with thicker border); ← / → round buttons (**"Lựa chọn trước" / "Lựa chọn tiếp"**) with name + "2 / 21"; status **"Chưa lưu · Bấm Lưu khi con ưng ý."**; save button. Keep existing errors ("Chưa lưu được. Con thử lại nhé." etc.) styled as the friendly-error pattern.
1280: stage left 520px, picker right.

## 6. Leaderboard
Refs: `06-leaderboard-390.png`, `06-leaderboard-1280.png`
**Primary:** "Đọc truyện để leo bảng" (link back to reading).
Back pill; **"TẤT CẢ CÁC BẠN CÙNG ĐỌC"** → **"Bảng xếp hạng"** + **"Đọc thêm một truyện, con leo thêm một bậc nhé!"**; full-width tabs **XP / Kim cương** (ink track, sun active); **"Xếp hạng tất cả các bạn, tính từ trước đến nay."**; leaf podium (2-1-3, crown on #1, bobbing #1); list from #4 with alternating rows; **the child's own row** in sun with ink border, bigger avatar and "Con đây!" tag (keep it visible even if far down — e.g. pin a copy at the bottom when off-screen); footnote **"XP tính tổng từ trước đến nay. Kim cương là số con đang có. Bảng này không tặng thêm kim cương."**
1280: podium left, list right.

## 7. Library — "Mỗi ngày một câu chuyện"
Refs: `07-library-390.png`, `07-library-1280.png`
**Primary:** **"Đọc và nghe →"** on today's story.
Back; label + H1 **"Mỗi ngày một câu chuyện"** + counts **"N câu chuyện · M quyển sách"**; search input ("Tìm truyện theo tên"; no-result copy **"Chưa tìm thấy câu chuyện. Con thử tên khác nhé."**); book filter chips (**"Tất cả các quyển"**, Quyển 1…); featured card "Truyện hôm nay"; grid of story cards (2 cols / 4 at 1280) — whole card is the tap target, cover, title, **"Bộ X · Quyển Y · Bài N"**, tag **"Có bài nghe"** / **"Chưa có bài nghe"** / "Đã đọc".

## 8. Shop đổi quà
Refs: `08-shop-390.png`, `08-shop-1280.png`
**Primary:** depends on state — can redeem: **"Đổi quà ngay 💎"**; goal not reached: "Đọc truyện kiếm kim cương" (new copy, links to reading).
Back; label "Quà thật từ Coach Felix" + H1 **"Shop đổi quà"** + gift icon; wallet card **"Kim cương của con"** 55; line **"Kim cương đến từ lớp học — Coach Felix thưởng mỗi buổi."**; goal card **"★ Mục tiêu của con"** with item, price, bar, **"x% chặng đường · còn N 💎"**, **"Đổi mục tiêu"**; grid of gifts with all existing statuses styled: **"🔥 Sắp đổi được!"** + **"Còn thiếu N 💎"**, **"Đặt làm mục tiêu ★"**, **"✓ Con có thể đổi ngay"**, **"⏳ Đang chờ Coach Felix duyệt"**, **"🎁 Coach Felix đang chuẩn bị"**, **"✓ Đã nhận quà"**, **"Tạm thời chưa mở"**; card link **"Con cũng có thể đổi kim cương lấy phụ kiện quái vật"** → accessory shop. Price shown as encouragement (progress), never as "not enough" in red.

## 9. Public page for parents (logged out)
Refs: `09-parents-390.png`, `09-parents-1280.png`
Calmer: cream ground, one sky hero band, fewer animations (only the monster bob).
Header logo "Read2Lead" (+ "Nhập mã" button at 1280); hero: Minny face 96px + H1 "Con đọc truyện và luyện nói cùng Minny" + one-liner + 3 step cards (**Đọc / Trả lời Minny / Kể qua tranh**) + yellow **"Nhập mã ↓"**; live top-3 (XP and Kim cương columns); code card **"Góc đọc sách đang chờ con"**, **"Nhập mã học sinh để mở truyện của con nhé."**, **"Mã học sinh của con"** input "R2L-…", yellow **"Mở góc đọc sách →"**, **"Con cũng có thể mở link riêng Coach Felix đã gửi."**, link **"Nhờ ba mẹ nhận mã từ Coach Felix"**; sign-up card **"Chưa có mã? Tạo mã miễn phí"** with **"Tên của con"** (+ public-name helper), **"Con mấy tuổi?"**, **"Con là"** Bé trai / Bé gái, the real Turnstile widget, leaf **"Tạo mã miễn phí →"**; donation card **"Dành cho ba mẹ"** with QR, account holder and bank line exactly as live.
1280: hero 2 columns (text + steps | Minny + top-3), then code and sign-up side by side, donation full width.

## Friendly error pattern
Ref: `S6-friendly-error-390.png`. Surprised ("oops") monster with two floating paper pages, bubble "Ối!", card with a playful headline + the existing specific message (e.g. **"Chưa mở được câu chuyện. Con bấm “Mở lại câu chuyện” để thử lại nhé."**) + reassurance "Bài con đã đọc vẫn được giữ nguyên.", yellow retry (**"Mở lại câu chuyện"** with refresh icon), white "Về nhà", footnote **"…Ba mẹ nhắn Coach Felix nhé."** Use this pattern for every kid-facing error string already in the code (library, companion, shop, voice).
