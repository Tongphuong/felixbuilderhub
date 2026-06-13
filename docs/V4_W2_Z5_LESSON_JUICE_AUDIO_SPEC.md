# V4 W2 Z5 — Lesson juice + audio spec (Codex #2)

**Parent:** `docs/V4_W2_DOPAMINE_SPEC.md`
**Owner:** Codex #2 (chuyên cần kỷ luật, được phép touch lesson.astro hook lines)
**Branch:** `codex/w2-z5-juice-audio` (off `origin/main`)
**Worktree:** `D:\hub-codex-w2-z5`
**Status:** READY (Phương ack 2026-06-13: Kenney 8 file commit luôn)

---

## 1. Mục tiêu

Extend `window.__r2lJuice` với 5 method mới + add Howler.js wrapper + commit 8 Kenney CC0 audio files. Thêm MAX 5 hook lines vào `lesson.astro` (xác định trong §6). KHÔNG inline logic vào lesson.astro.

## 2. Files allowed

- `src/lib/lesson-juice.ts` (EXTEND — thêm export functions)
- `src/lib/lesson-result-chest.ts` (NEW — drives ChestOpening modal)
- `src/lib/r2l-audio.ts` (NEW — Howler.js wrapper, mute persist)
- `public/audio/kenney/*.mp3` (NEW — 8 file Kenney CC0, paths in §4)
- `src/pages/read2lead/lesson.astro` (CHỈ ADD 5 hook lines tại touchpoints §6 — KHÔNG sửa logic khác)
- `package.json` + `package-lock.json` (CHỈ thêm `howler@^2.2.4` + `@types/howler`)
- `tests/read2lead-w2-juice.test.mjs` (NEW)
- `tests/read2lead-w2-audio.test.mjs` (NEW)

Cấm sửa các file khác. Đặc biệt KHÔNG đụng:
- mic/speaking pipeline (`r2l-recorder.js`, `r2l-mic-check.js`, `read2lead-speaking-check.js`)
- Activity logic trong lesson.astro
- State-core, submit-…lesson.js

## 3. window.__r2lJuice extensions

Trong `src/lib/lesson-juice.ts` thêm exports + extend bind:

```ts
// existing
export { fireLessonPassConfetti, fireStreakConfetti, playSynthTone };

// new
export async function playKenney(name: string): Promise<void>;
export function showXpTicker(xpDelta: number, anchorSelector: string): void;
export function showComboBadge(level: 1 | 2 | 3): void;
export async function openChest(pendingChest: PendingChest): Promise<void>;
export function showNearMissBanner(text: string): void;
export function setMuted(muted: boolean): void;
export function isMuted(): boolean;
export function claimDailyChest(): Promise<{ ok: boolean; reward?: { coins: number } }>;
```

Where:
- `PendingChest = { rarity: 'common'|'rare'|'epic'; reward: { coins: number; part_id: string|null; part_name?: string }; duplicate: boolean }`

Đăng ký vào `window.__r2lJuice` tại lesson.astro existing `<script>` block (line ~5369). MAX 1 extension line:

```ts
window.__r2lJuice = {
  ...window.__r2lJuice,   // existing keys preserved
  playKenney, showXpTicker, showComboBadge, openChest, showNearMissBanner,
  setMuted, isMuted, claimDailyChest,
};
```

## 4. Kenney audio assets (8 files)

Download từ `kenney.nl/assets/casino-audio` và `kenney.nl/assets/interface-sounds` (CC0).

Commit vào `public/audio/kenney/`:

| File path | Source pack | Use |
|---|---|---|
| `public/audio/kenney/chest-shake.mp3` | Casino | chest stage 1 shake |
| `public/audio/kenney/chest-crack.mp3` | Casino | chest stage 2 crack |
| `public/audio/kenney/chest-burst.mp3` | Casino | chest stage 3 burst |
| `public/audio/kenney/coin-clink.mp3` | Interface | per correct answer + coin reward |
| `public/audio/kenney/quest-complete.mp3` | Interface | quest claim |
| `public/audio/kenney/combo-tick.mp3` | Interface | combo level up |
| `public/audio/kenney/near-miss.mp3` | Interface | near-miss banner (subtle harp) |
| `public/audio/kenney/daily-chest-claim.mp3` | Casino | daily login chest claim |

**Total target: ≤ 200KB.** Pick the shortest, most compressed variants (mp3 64-96kbps, mono).

Add `public/audio/kenney/CREDITS.md` ghi rõ CC0 + tên pack + URL.

## 5. r2l-audio.ts — Howler wrapper

```ts
import { Howl } from 'howler';

const SOUND_PATHS: Record<string, string> = {
  'chest-shake': '/audio/kenney/chest-shake.mp3',
  'chest-crack': '/audio/kenney/chest-crack.mp3',
  'chest-burst': '/audio/kenney/chest-burst.mp3',
  'coin-clink': '/audio/kenney/coin-clink.mp3',
  'quest-complete': '/audio/kenney/quest-complete.mp3',
  'combo-tick': '/audio/kenney/combo-tick.mp3',
  'near-miss': '/audio/kenney/near-miss.mp3',
  'daily-chest-claim': '/audio/kenney/daily-chest-claim.mp3',
};

const cache = new Map<string, Howl>();
const MUTE_KEY = 'r2l-w2-muted';

export function isMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function setMuted(muted: boolean): void {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {}
  for (const howl of cache.values()) howl.mute(muted);
}

/** Lazy-load Howl on first call. No-op if muted. */
export async function play(name: string): Promise<void> {
  if (isMuted()) return;
  const path = SOUND_PATHS[name];
  if (!path) return;
  let howl = cache.get(name);
  if (!howl) {
    howl = new Howl({ src: [path], html5: false, preload: true, volume: 0.6 });
    cache.set(name, howl);
  }
  howl.play();
}

/** Preload a sound without playing — call after first user interaction. */
export function preload(name: string): void {
  if (cache.has(name)) return;
  const path = SOUND_PATHS[name];
  if (!path) return;
  cache.set(name, new Howl({ src: [path], html5: false, preload: true, volume: 0.6 }));
}
```

Lazy-load: chỉ tạo `Howl` instance khi `play(name)` lần đầu. Không preload tại module load.

## 6. lesson.astro hook lines (MAX 5)

Locate touchpoints:

**T1** (existing): line ~5369 `<script>` block — extend `window.__r2lJuice` registration (1 line edit).

**T2**: trong activity correct-answer handler (find via grep `playSynthTone\\('correct'`) — add ONE line after existing tone:
```ts
window.__r2lJuice?.showComboBadge?.(currentComboLevel);
```

**T3**: trong lesson pass / result render (find `fireLessonPassConfetti`) — replace section with:
```ts
window.__r2lJuice?.fireLessonPassConfetti?.();
// NEW:
window.__r2lJuice?.showXpTicker?.(packXpDelta, '.r2l-score-summary');
if (passResult.pending_chest) {
  await window.__r2lJuice?.openChest?.(passResult.pending_chest);
}
if (rankLadder?.stars_to_next === 1) {
  window.__r2lJuice?.showNearMissBanner?.(`Còn 1 sao nữa là lên ${rankLadder.next_label}!`);
}
```

That's the spot — **4 added lines max**, không thay đổi flow gốc.

**T4**: nếu chưa có mute toggle UI — KHÔNG thêm. Mute control sẽ ở W2 hub page (Z4 / future).

Total lines added vào lesson.astro: **≤ 5**. Diff tối thiểu.

## 7. lesson-result-chest.ts

Driver cho ChestOpening modal:

```ts
import { play as playAudio } from './r2l-audio';

export type PendingChest = { rarity: string; reward: { coins: number; part_id: string|null; part_name?: string }; duplicate: boolean };

export async function openChest(pendingChest: PendingChest): Promise<void> {
  if (!pendingChest) return;

  // Render or mount the ChestOpening dialog with props.
  // The dialog markup may already be inserted by lesson.astro at result render;
  // here we control its data-stage attr + play audio.

  const dialog = document.querySelector('.w2-chest-modal') as HTMLDialogElement | null;
  if (!dialog) return;

  dialog.showModal();
  setStage(dialog, 'closed');
  await playAudio('chest-shake');
  await wait(1500);

  setStage(dialog, 'cracking');
  await playAudio('chest-crack');
  await wait(800);

  setStage(dialog, 'burst');
  await playAudio('chest-burst');
  // confetti burst already wired via existing fireLessonPassConfetti or new call
  await playAudio('coin-clink');
}

function setStage(dialog: HTMLElement, stage: 'closed'|'cracking'|'burst') {
  for (const el of dialog.querySelectorAll<HTMLElement>('.w2-chest-stage')) {
    el.hidden = el.dataset.stage !== stage;
  }
}

function wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }
```

Note: Z4 provides ChestOpening.astro markup; Z5 drives it. Z5 may need to render the dialog if not already in DOM — use `document.createElement('dialog')` + innerHTML clone of a template. Cleaner: lesson.astro spec calls Z4 Astro component conditionally if pending_chest exists.

## 8. Tests

### `tests/read2lead-w2-juice.test.mjs`

```js
test('window.__r2lJuice extends with new keys without dropping existing', () => { /* simulate global setup, verify keys present */ });
test('showXpTicker creates DOM ticker near anchor', () => { /* jsdom-like test */ });
test('showComboBadge sets data-level on combo element', () => { /* */ });
test('showNearMissBanner sets visible attr then hides after 3s', async () => { /* fake timers */ });
test('openChest sequences stages closed→cracking→burst', async () => { /* */ });
test('setMuted persists to localStorage', () => { /* */ });
test('isMuted reads localStorage', () => { /* */ });
test('claimDailyChest posts to API, returns ok+reward', async () => { /* mock fetch */ });
```

### `tests/read2lead-w2-audio.test.mjs`

```js
test('Howler import works (module loads)', () => { /* */ });
test('play returns early when muted', async () => { /* set localStorage, call, assert no Howl created */ });
test('play creates Howl on first call only (cache)', async () => { /* spy on Howl ctor */ });
test('setMuted mutes all cached Howls', () => { /* */ });
test('preload populates cache without playing', () => { /* */ });
test('unknown sound name is no-op', async () => { /* */ });
```

Aim: 12+ tests across both files. Use jsdom or skip DOM-specific tests with a `if (typeof document !== "undefined")` guard if hub tests don't have DOM env.

## 9. Done when

1. 8 audio files committed `public/audio/kenney/`, total ≤ 200KB, CREDITS.md present.
2. `howler` installed via `npm install howler @types/howler`, package-lock committed.
3. `src/lib/r2l-audio.ts`, `lesson-juice.ts` (extended), `lesson-result-chest.ts` created.
4. `lesson.astro` modified ≤ 5 hook lines (zero logic changes elsewhere).
5. Tests ≥12 green.
6. `node --test` toàn bộ xanh.
7. `npx astro check` không thêm error.
8. Branch `codex/w2-z5-juice-audio` pushed origin.
9. AGENT_LOG START + DONE với commit hash.

## 10. Constraints

- Howler ~7KB gzipped — chấp nhận. Audio total ≤ 200KB.
- Lazy-load: KHÔNG import Howler ở module top-level của lesson.astro. Use `import('./r2l-audio')` dynamic inside lesson-juice extensions if bundle check shows growth.
- Mute toggle persistence qua localStorage.
- Audio chỉ play sau first user interaction (browser autoplay policy) — Howler tự handle.
- Graceful degrade: nếu audio fail → visual still works.

## 11. Bundle budget

Trước commit, chạy `npm run build` + check `dist/` size. Lesson route's JS bundle KHÔNG được tăng > 8KB gzipped (chỉ Howler import được phép). Audio assets ở `public/` không count vào JS bundle.

Nếu vượt → dynamic import Howler, không static import.

## 12. Report

Theo format AGENTS.md §4. Đặc biệt báo cáo: bundle size delta của lesson route, audio total size, mute toggle test.
