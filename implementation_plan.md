# Implementation Plan — Read2Lead Admin UI Redesign

[Overview]
Redesign the Read2Lead admin UI by splitting the monolithic `codes.astro` into a shared admin layout with three pages — a dashboard index, a codes management page, and a class management page — with enhanced visual polish, proper modal-based editing, search/filter, pagination, and gamified live-class feedback (confetti, sounds, emoji, animations) using the project's existing libraries.

The current `src/pages/admin/codes.astro` (931 lines) crams three distinct workflows into one page: (1) Felix Class Hub (coaching classes with live rewards/attendance), (2) access code creation, and (3) code list management. The edit flow uses browser `prompt()` dialogs, there is no search/filter, and the API's cursor-based pagination is ignored. The redesign separates these into focused pages with a shared `AdminLayout.astro` that provides navigation, a consistent header, and a footer. The class management page gets significant UX enhancements — bigger student cards, animated reward bursts, confetti cannons, sound effects, emoji reactions, and a "presentation mode" for live classroom projection — all powered by the already-installed `canvas-confetti` and `howler` packages and the existing `lesson-juice.ts` / `r2l-audio.ts` modules. No new dependencies are required. No backend/API changes are needed — all existing endpoints remain unchanged.

[Types]
No new TypeScript types are strictly required since the admin pages use inline scripts (not `<script lang="ts">`). However, JSDoc type annotations will be added to shared admin helper modules for clarity.

**AdminCodeItem** (existing shape from `GET /api/admin/codes`, documented for reference):
```
{
  code: string                    // "R2L-LINH-A4F2"
  parent_name: string
  parent_zalo: string
  notes: string
  student_profile: {
    student_name: string
    age: number | null
    level: string                 // "L1"–"L5"
    child_gender: 'boy' | 'girl' | ''
  }
  progress: {
    student_name: string
    age: number | null
    child_gender: 'boy' | 'girl' | ''
    current_level: string
    rank_title: string
    badges: string[]
    packs_created: number
    current_pack: object | null
    review_history: array
  }
  issued_at: string               // ISO date
  expires_at: string              // ISO date
  uses_total: number
  uses_remaining: number
  last_used_at: string | null
  is_test: boolean
  is_shared: boolean
}
```

**AdminClass** (existing shape from `GET /api/admin/classes`, documented for reference):
```
{
  id: string
  name: string
  student_codes: string[]
  positive_presets: Preset[]
  needs_work_presets: Preset[]
  attendance_by_date: { [date: string]: { [code: string]: 'present' | 'absent' } }
  created_at: string
  updated_at: string
  order: number
  today: string                   // added by enrichClass
  students: Student[]             // added by enrichClass
}

Preset = {
  id: string
  label: string
  xp_delta: number
  coins_delta: number
  kind: 'positive' | 'needs_work'
}

Student = {
  code: string
  missing: boolean
  student_name: string
  age: number | null
  attendance_today: 'present' | 'absent' | null
  class_attendance_streak: number
  read2lead_state: PublicProgressState  // from publicProgressState()
}
```

**New shared admin state module** (`src/lib/admin-shared.mjs`):
```js
// No complex types — just exported helper functions
export function escapeHtml(s) { ... }
export function formatDate(iso) { ... }
export function formatBytes(bytes) { ... }
export function signed(value, suffix) { ... }
export function presetText(preset) { ... }
export const TEST_LEVELS = [...]
```

[Files]

**New files to create:**

1. `src/layouts/AdminLayout.astro` — Shared admin layout with header (logo + admin badge + nav tabs), `<slot />` for page content, and footer. Replaces the duplicated header/footer in each admin page. Nav tabs: Dashboard, Mã học sinh, Lớp coaching, Video. Active tab highlighted via `Astro.url.pathname`.

2. `src/pages/admin/index.astro` — Admin dashboard with quick stats (total codes, active codes, total students across classes, expiring soon), navigation cards to each sub-page, and recent activity summary.

3. `src/pages/admin/classes.astro` — Class management page (extracted from `codes.astro`). Contains: class list sidebar, class detail with student cards, preset editor, attendance, reward buttons, custom reward form. Enhanced with presentation mode, confetti, sounds, emoji, and animations.

4. `src/lib/admin-shared.mjs` — Shared client-side helpers used by both `codes.astro` and `classes.astro`: `escapeHtml`, `formatDate`, `formatBytes`, `signed`, `presetText`, `TEST_LEVELS`. Extracted from the duplicated code in the current `codes.astro`.

5. `src/lib/admin-juice.mjs` — Admin-specific gamification module: enhanced confetti bursts (reward cannon, level-up celebration, attendance streak), sound effect wrappers (reusing `lesson-juice.ts` and `r2l-audio.ts`), emoji burst animations, and a "presentation mode" toggle (larger fonts, hide admin chrome).

6. `src/components/admin/EditCodeModal.astro` — A proper modal dialog for editing code records (replaces `prompt()` chains). Fields: parent_name, parent_zalo, student_name, student_age, child_gender, notes. Uses `.fx-field` styling. Pure HTML/CSS modal with `<dialog>` element or custom overlay.

**Existing files to modify:**

7. `src/pages/admin/codes.astro` — Major rewrite. Remove all Class Hub code (moved to `classes.astro`). Keep only: code creation form, code list with search/filter/pagination, edit modal integration, and bulk actions (sync bot, reset levels). Use `AdminLayout.astro`. Import shared helpers from `admin-shared.mjs`. Replace `prompt()` edit flow with `EditCodeModal`.

8. `src/pages/admin/portfolio.astro` — Minor update: switch from custom header/footer to `AdminLayout.astro` for nav consistency. No functional changes.

**Files NOT modified:**
- All `functions/api/admin/*` endpoints — no backend changes
- `src/layouts/BaseLayout.astro` — AdminLayout wraps it
- `tailwind.config.mjs` — no new colors needed
- `src/styles/design-system.css` — use existing `.fx-*` classes
- `src/lib/lesson-juice.ts` — reuse as-is
- `src/lib/r2l-audio.ts` — reuse as-is

[Functions]

**New functions:**

1. `escapeHtml(s)` — `src/lib/admin-shared.mjs` — HTML-escape user input for safe template-literal injection. (Extracted from current `codes.astro`.)

2. `formatDate(iso)` — `src/lib/admin-shared.mjs` — Format ISO date to `dd/mm/yyyy` using `Intl.DateTimeFormat('vi-VN')`.

3. `formatBytes(bytes)` — `src/lib/admin-shared.mjs` — Human-readable file size. (Extracted from `portfolio.astro`.)

4. `signed(value, suffix)` — `src/lib/admin-shared.mjs` — Format signed delta with `+`/`-` prefix. (Extracted from current `codes.astro`.)

5. `presetText(preset)` — `src/lib/admin-shared.mjs` — Format preset XP/coins delta as readable string. (Extracted from current `codes.astro`.)

6. `fireRewardCannon(xpDelta, coinsDelta)` — `src/lib/admin-juice.mjs` — Fire a directional confetti burst from the reward button location. Uses `canvas-confetti` directly with custom colors based on reward magnitude.

7. `fireLevelUpConfetti()` — `src/lib/admin-juice.mjs` — Bigger confetti celebration when a student levels up after a reward. Multi-burst with gold/diamond colors.

8. `playRewardSound(kind)` — `src/lib/admin-juice.mjs` — Play appropriate sound for reward type: `playSynthTone('coin')` for coins, `playSynthTone('correct')` for XP, `playSynthTone('level-up')` for level-up. Wraps `lesson-juice.ts` functions.

9. `showEmojiBurst(anchorEl, emoji)` — `src/lib/admin-juice.mjs` — Spawn floating emoji animation from a DOM element (e.g., 🎉 from reward button). Uses Web Animations API.

10. `showXpPopup(anchorEl, text)` — `src/lib/admin-juice.mjs` — Floating "+10 XP / +5 xu" popup near the reward button. Enhanced version of the current `rewardBurst()` with better styling and animation.

11. `togglePresentationMode()` — `src/lib/admin-juice.mjs` — Toggle a `data-presentation` attribute on `<body>` that enlarges fonts, hides admin chrome (nav, footer, non-essential buttons), and optimizes the layout for projector display during live classes.

12. `filterCodes(items, query, filters)` — `src/pages/admin/codes.astro` (inline) — Filter code list by search query (code, parent name, student name) and status filters (active, expired, exhausted, test, shared).

13. `renderPagination(cursor, listComplete)` — `src/pages/admin/codes.astro` (inline) — Render "Load more" button using the API's cursor-based pagination.

14. `openEditModal(code, record)` — `src/pages/admin/codes.astro` (inline) — Open the `EditCodeModal` dialog, populate fields from the code record, handle save via `PATCH /api/admin/codes/:code`.

15. `renderStudentCardEnhanced(student, klass)` — `src/pages/admin/classes.astro` (inline) — Enhanced version of the current `renderStudentCard()` with bigger avatar, emoji badges, animated XP bar, and presentation-mode-aware sizing.

16. `applyClassRewardEnhanced({ code, xpDelta, coinsDelta, reason, kind, sourceEl })` — `src/pages/admin/classes.astro` (inline) — Enhanced reward handler that fires confetti cannon, plays sound, shows emoji burst, checks for level-up, and updates the card with animation.

**Modified functions:**

17. `renderItem(item)` — `src/pages/admin/codes.astro` — Modified to support search highlighting, cleaner card layout using `.fx-card`, and an "Edit" button that opens the modal instead of `prompt()`.

18. `loadList()` — `src/pages/admin/codes.astro` — Modified to support search query, status filter, and cursor-based pagination (append vs. replace).

19. `loadClasses()` — `src/pages/admin/classes.astro` — Moved from `codes.astro`, unchanged logic but calls `renderStudentCardEnhanced` instead of `renderStudentCard`.

20. `renderClassDetail()` — `src/pages/admin/classes.astro` — Moved from `codes.astro`, enhanced with presentation-mode class toggling.

**Removed functions:**

21. All Class Hub functions removed from `codes.astro` and moved to `classes.astro`: `renderClassList`, `renderPresetRows`, `renderPresetEditor`, `renderStudentCard`, `renderClassAvatars`, `renderClassDetail`, `renderClasses`, `loadClasses`, `patchClass`, `collectPresets`, `rewardBurst`, `applyClassReward`, `currentClass`. No migration strategy needed — they move to the new file.

22. `prompt()`-based edit flow in `codes.astro` — replaced by `openEditModal()` / `EditCodeModal`.

[Classes]

No new classes. The project uses Astro components and functional JS modules, not OOP classes. The `R2LRecorder` class in `r2l-recorder.js` is unrelated.

[Dependencies]

No new dependencies. The project already has:
- `canvas-confetti@^1.9.4` — confetti animations (already used in `lesson-juice.ts`)
- `howler@^2.2.4` — audio playback (already used in `r2l-audio.ts`)
- `@fontsource-variable/baloo-2@^5.2.7` — playful display font (available, will use for presentation-mode headings)
- `tailwindcss@^3.4.19` — utility CSS (already configured with navy/cream/accent/gold tokens)

No version changes. No integration requirements beyond importing existing modules.

[Testing]

**Test approach:** Manual testing + existing `node --test` suite.

**Manual test checklist:**
1. `npx astro build` succeeds with no new errors (baseline has 395 pre-existing `astro check` errors)
2. `node --test tests/` passes (existing tests must not break)
3. `/admin` dashboard loads, shows stats, nav links work
4. `/admin/codes` — create code, search/filter, edit via modal (not prompt), pagination, bulk actions
5. `/admin/classes` — create class, add students, reward with confetti/sound/emoji, attendance, preset editor, presentation mode toggle
6. `/admin/portfolio` — still works with new layout
7. Mobile responsive — all admin pages usable on phone (Felix may use phone to create codes)
8. Presentation mode — fonts enlarge, admin chrome hides, student cards are readable on projector

**Existing test modifications:** None expected. The `tests/` directory contains frontend tests that don't cover admin pages. If any test imports `codes.astro` path, it will need updating — but a search shows no tests reference admin pages.

**Validation strategy:**
- `npx astro build` — must succeed
- `node --test` — must pass
- Manual QA of each page's core flows
- Verify no `prompt()` or `alert()` calls remain in `codes.astro` (except for destructive confirmations like revoke/reset)

[Implementation Order]

1. Create `src/lib/admin-shared.mjs` — extract shared helpers (`escapeHtml`, `formatDate`, `signed`, `presetText`, `TEST_LEVELS`) from current `codes.astro`
2. Create `src/lib/admin-juice.mjs` — gamification module (confetti cannons, sounds, emoji bursts, presentation mode, XP popups)
3. Create `src/layouts/AdminLayout.astro` — shared layout with nav tabs (Dashboard, Mã học sinh, Lớp coaching, Video)
4. Create `src/components/admin/EditCodeModal.astro` — modal dialog for editing code records
5. Create `src/pages/admin/index.astro` — dashboard with quick stats and navigation cards
6. Rewrite `src/pages/admin/codes.astro` — remove Class Hub code, add search/filter/pagination, integrate EditCodeModal, use AdminLayout
7. Create `src/pages/admin/classes.astro` — extract Class Hub from codes.astro, enhance with admin-juice (confetti, sounds, emoji, presentation mode)
8. Update `src/pages/admin/portfolio.astro` — switch to AdminLayout for nav consistency
9. Run `npx astro build` and `node --test` to validate
10. Manual QA pass of all four admin pages
