# W1 SPEC C — KID HUB & PARENT SPLIT · Cursor Agent C

**Author:** Claude (tech commander) · **Date:** 2026-06-10 · **v1.1** (post EdTech-UX audit: + in-hub create flow + anticipation wait scene, login ergonomics, parent action card, zero-streak copy) · **Executor:** Cursor Agent C
**Branch:** `v4/c-kid-hub` off `v3` → PR into `v3`. Never `main`.
**Flag:** all new UI behind `isW1Enabled()` (contract: `W1_SPEC_B_GAME_SHELL.md` §2.1). W1 off → current `/hoc-sinh` byte-identical; `/phu-huynh` may exist but unlisted.

**Files you own (EXCLUSIVE):**
- `src/pages/hoc-sinh/index.astro`
- `src/pages/phu-huynh/index.astro` (NEW)
- `tests/read2lead-parent-view.test.mjs` (NEW, if you add any pure helpers)

**Files you must NOT touch:** `lesson.astro` (A), `flags.ts`/`r2l-kid.css`/v4 components/`Header.astro`/shop/games/leaderboard (B), `functions/api/*`, `_read2lead-v2-state.js`. You CONSUME B's components per the contract — if not merged yet, build against the documented names; integration on `v3`.

---

## 1. Goal (Phương, 2026-06-10)

1. **Hook ngay từ giây đầu tiên:** con vào web là hưng phấn muốn học ngay — màn chào như mở game, không phải dashboard text.
2. **Tách hẳn phần của con và phần của bố mẹ:** con thấy game của con; bố mẹ có trang theo dõi riêng, nghiêm túc, đủ thông tin.

## 2. `/hoc-sinh` — the Kid Hub (W1 on)

### 2.1 Login screen (pre-code)
- Kid-themed (B tokens): big friendly heading `Bạn học của Minny 👋`, one big input (existing `#access-code`, keep `data-clarity-mask`), one `KidButton` lg `Vào chơi & học 🚀`.
- Input ergonomics (UX audit R4): `autocapitalize="characters"`, `autocomplete="off"`, `spellcheck="false"`, trim + uppercase on input, paste allowed. A typed lowercase/spaced code must still work.
- Keep existing localStorage remember + session bar logic EXACTLY (it works) — restyle only.
- Error copy kid-soft: `Mã chưa đúng — con nhờ ba mẹ kiểm tra lại nhé!`

### 2.2 THE HOOK — post-login hero (the dopamine entry, ≤2s to render)
Render order (skeleton shimmer while `/api/read2lead-progress` loads — never a blank screen):
1. **Monster moment:** kid's monster avatar LARGE (reuse `renderMonster` from `src/lib/monster-avatar.ts` — import only), CSS entrance: pop-in scale + a one-time wave/bounce (~600ms, respect `prefers-reduced-motion`). Beside it, speech bubble: `Chào {tên}! Hôm nay học gì nè? 🎯` (rotate 3 greeting variants by date so it doesn't go stale).
2. **Streak flame + rank strip:** `🔥 {n} ngày` + rank badge (`RankBadge` v3 component, reuse) + the near-miss line when close: `Còn {stars_to_next} sao nữa là lên {next_label_vi}!` (data already in `read2lead_state.rank_ladder` — verify field names from the API response, they exist in `computeRankLadder` output). Zero streak → welcoming, never shaming: `Bắt đầu chuỗi học mới hôm nay nha! 🔥`
3. **ONE hero CTA** (`KidButton` lg, the biggest thing on screen): existing `buildPrimaryAction` logic decides — `Học tiếp 🚀` (open pack) / `Tạo bài mới ✨` (opens the IN-HUB create flow §2.4, NOT the marketing page) / `Xem kết quả 🏆`. One tap from login to learning.
4. **Mission strip:** `QuestPath` (B) horizontal: today's flow as 3 nodes — `Đọc truyện → Làm nhiệm vụ → Nhận thưởng` with state reflecting the current pack (no pack = all locked except node 1 which IS the CTA). This is visual scaffolding for W2's real quests — keep the markup hook `data-r2l-quest-strip`.
5. Below the fold (compact, kid-relevant only): coins `CoinPill` + XP `XpBar` + truyện đã đọc (portfolio covers as a horizontal scroll of small `KidCard`s, tap = reopen story), badges row.

### 2.3 IN-HUB CREATE FLOW + ANTICIPATION WAIT (UX audit R2+R3 — fixes the journey break)

**Problem found in audit:** pack creation currently lives ONLY on the marketing page `/read2lead` (adult radio-button form, dark theme), and the 60–120s generation wait is rotating text on a dark screen — the worst dead moment in the whole loop. The kid hub's `Tạo bài mới ✨` must never dump a child onto the marketing page.

**Create sheet (in `/hoc-sinh`, W1 on):**
- Tap `Tạo bài mới ✨` → full-screen sheet: `Hôm nay con muốn đọc về gì? 🎨` + **12 topic picture cards** (grid 3×4 mobile; each = big emoji + 2-word VN label, from the existing topic list on `read2lead.astro` — copy the value/label pairs, render as `KidCard`s with a selected state) + a 13th card `🎲 Minny chọn giúp con!` (sends empty topic — the autonomy + surprise option). Optional interests stay OFF this sheet (parent territory — the marketing form keeps them).
- One tap on a card → confirm bar slides up: `Tạo truyện về {chủ đề}? ✨` → `KidButton` go. POST the existing `/api/generate-read2lead-pack` with the saved access code (same payload as the marketing form: `access_code`, `topic`; no interests).
- **The marketing-page form stays untouched** (parents' funnel, positioning LOCKED). Two entry points, one API.

**Anticipation wait scene (replaces dead time, same sheet):**
- Port the polling logic from `read2lead.astro` (`/api/check-generation-status`, 5s interval, 60 attempts) — **copy into hoc-sinh's script, do not import across pages, do not modify the original**.
- Scene: Minny PNG (existing `/assets/minny/` moods) center, gentle CSS bob; staged storyline messages tied to elapsed time, kid-voiced: `Minny đang nghĩ truyện về {chủ đề}... 💭` → `Đang viết những câu thật hay ✍️` → `Đang thu âm giọng đọc 🎙️` → `Sắp xong rồi, hồi hộp quá! 🤩`; a 3-node `QuestPath` (Viết truyện → Thu âm → Sẵn sàng) advancing on stage thresholds (time-based is fine — the API gives no granular progress).
- Tap Minny while waiting → she bounces (CSS only). Small touch, big patience.
- Done → celebratory transition: `Truyện của con xong rồi! 🎉` + hero CTA `Đọc ngay 🚀` → `/read2lead/lesson?...` (same URL the marketing flow produces).
- Failure/timeout → soft recovery: `Minny cần thêm thời gian. Con quay lại sau 1 phút nhé!` + button back to hub (the existing resume/`pending` logic on reload must keep working — verify against the current marketing-page behavior for double-submit/`uses_remaining`).

### 2.4 What LEAVES the kid hub (W1 on)
Weekly growth chart, streak-freeze explainer text, `parent_note_vi`, `next_suggestion_vi` detail, admin-ish stats → ALL move to `/phu-huynh`. The kid hub keeps a single quiet footer link: `Dành cho ba mẹ →` → `/phu-huynh?code={code}`.
W1 off → current page untouched (keep the existing render functions; the W1 path branches at `renderDashboard`).

## 3. `/phu-huynh` — Parent dashboard (NEW page)

- **Audience:** no-tech Vietnamese parents on Zalo browser. Sober, trustworthy, NOT kid-themed (regular site styling, light surface, readable 16px+ text). `robots: noindex`.
- Auth = same access code: read `?code=` param, else show a plain code input. Data: **read-only, existing endpoints only** — `/api/read2lead-progress` (state + weekly_growth + portfolio) and, for section 5's notes, `/api/read2lead-lesson` for the latest pack id from progress (that endpoint returns `parent_note_vi` / `next_suggestion_vi`). No new endpoints, no state writes; if the lesson fetch fails, hide section 5 gracefully.
- Sections (top→down):
  1. Header: `Báo cáo học tập của {tên}` + level label + this-week summary sentence (reuse `weekly_growth` data: `Tuần này {tên} hoàn thành {n} bài, điểm trung bình {x}%`).
  2. **Tiến bộ theo tuần** — port `renderGrowthSection` (6-week columns) from hoc-sinh.
  3. **Truyện đã học** — full portfolio list with dates + scores (the detailed version that left the kid hub).
  4. **Chuỗi ngày học** — streak + freeze explainer (`STREAK_FREEZE_HINT_VI` text via API payload).
  5. **Việc cho tuần này** (UX audit R5 — parents need an action, not just data): a highlighted card at the TOP of the notes area turning `next_suggestion_vi` into one concrete ask (`Tuần này ba mẹ thử: nhờ con kể lại truyện "{title}" bằng tiếng Anh trước bữa tối`), then `parent_note_vi` below it as the explainer.
  6. Quiet footer: link back `/hoc-sinh` + Felix contact line (reuse footer copy from coaching page).
- Copy tone: ấm, ngắn, không jargon. Every number gets one plain-VN sentence of meaning (`Điểm 80% nghĩa là con tự làm đúng phần lớn câu hỏi`).
- Zalo-share friendly: og:title `Báo cáo Read2Lead của {tên}`? NO — privacy: og tags must stay GENERIC (no child name in meta/title tag; name renders client-side only after code entry). Page `<title>` = `Báo cáo học tập | Read2Lead`.

## 4. Shared rules

- Mobile-first 360px; touch ≥48px on kid hub.
- All fetches: 15s `AbortSignal.timeout` + friendly retry button (pattern exists in hoc-sinh — keep).
- No new npm deps. No KV writes. `data-clarity-mask="true"` on every element rendering the child's name or code (both pages — check existing usage and replicate).
- Old deep links keep working: `/hoc-sinh?code=...` (yes), `/read2lead/review?code=...` redirect (don't touch).

## 5. Tests & done-when

- `node --test tests/*.test.mjs` green.
- Preview QA (`?w1=1`): login → hero hook < 2s on throttled 3G (Chrome DevTools), monster pops, greeting + streak + near-miss line correct, ONE dominant CTA, parent link works; **create sheet: pick topic card → wait scene stages advance → done → `Đọc ngay` opens the lesson; reload mid-generation resumes the wait (no double `uses_remaining` burn); timeout shows soft recovery**; `/phu-huynh?code=` renders all sections from a real test code incl. the "Việc cho tuần này" card; W1 off → legacy hoc-sinh identical AND marketing-page create flow untouched; no child name in any `<meta>`/`<title>`.
- Devices: cheap Android Chrome + iPad Safari + **Zalo in-app browser** (parents open links there — verify /phu-huynh renders).
- Report: branch hash, screenshots (kid hub 360px, parent page in Zalo webview), test counts.

## 6. Do NOT
- Do not add QR login or leaderboard tab (that's W6). Do not add daily chest/quest logic (W2 — only the visual mission strip hook).
- Do not modify any API or state file; read-only consumption.
- Do not put the child's name or access code into URLs you generate beyond the existing `?code=` pattern, page titles, or meta tags.
- Do not redesign the marketing `/read2lead` landing (parents' funnel — positioning copy is LOCKED per Phương rule; not in W1 scope).
