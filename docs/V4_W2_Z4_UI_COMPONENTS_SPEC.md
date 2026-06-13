# V4 W2 Z4 — UI Components spec (Cursor #3)

**Parent:** `docs/V4_W2_DOPAMINE_SPEC.md`
**Owner:** Cursor #3 · **Branch:** `cursor-3/w2-z4-ui` (off `origin/main`)
**Worktree:** `D:\hub-cursor-3-w2-z4`
**Status:** READY

---

## 1. Mục tiêu

6 component Astro + CSS animations cho W2 dopamine UI. Pure components — nhận props, render. KHÔNG fetch API, KHÔNG state mutation. Z1 integration sẽ pass real data sau.

## 2. Files allowed (TẤT CẢ NEW)

- `src/components/read2lead/v4/QuestCard.astro` (NEW)
- `src/components/read2lead/v4/QuestList.astro` (NEW — wraps 3 QuestCard)
- `src/components/read2lead/v4/ChestBox.astro` (NEW — closed chest icon, clickable)
- `src/components/read2lead/v4/ChestOpening.astro` (NEW — 3-stage animation modal)
- `src/components/read2lead/v4/ComboCounter.astro` (NEW — overlay badge)
- `src/components/read2lead/v4/NearMissBanner.astro` (NEW — banner strip)
- `src/components/read2lead/v4/DailyLoginChest.astro` (NEW — small button + claim animation)
- `tests/read2lead-w2-ui.test.mjs` (NEW — render snapshots)

Cấm đụng file nào khác. Đặc biệt không sửa lesson.astro, hoc-sinh/index.astro, hoặc state-core.

## 3. Component contracts

### 3.1 QuestCard

```astro
---
export interface Props {
  quest: {
    id: string;          // 'q1'
    label_vi: string;    // 'Xong 1 bài học hôm nay'
    target: number;      // 1
    progress: number;    // 0..target
    reward_coins: number;
    reward_rp: number;
    claimed: boolean;
  };
}
const { quest } = Astro.props;
const complete = quest.progress >= quest.target;
const pct = Math.min(100, Math.round((quest.progress / quest.target) * 100));
---
<article class="w2-quest-card" data-quest-id={quest.id} data-complete={complete} data-claimed={quest.claimed}>
  <header class="w2-quest-label">{quest.label_vi}</header>
  <div class="w2-quest-progress"><div class="w2-quest-progress-fill" style={`width: ${pct}%`} /></div>
  <footer class="w2-quest-reward">
    <span class="w2-coin">🪙 +{quest.reward_coins}</span>
    {quest.reward_rp > 0 && <span class="w2-rp">⭐ +{quest.reward_rp} RP</span>}
  </footer>
  {complete && !quest.claimed && (
    <button class="w2-quest-claim" data-quest-id={quest.id} type="button">Nhận thưởng</button>
  )}
  {quest.claimed && <span class="w2-quest-done">✓ Đã nhận</span>}
</article>
```

Styling: navy-950 base + accent yellow/green. Big tap target ≥44px. Pre-readers: progress bar dominant, label secondary.

### 3.2 QuestList

```astro
---
export interface Props { quests: QuestCardProps['quest'][]; }
const { quests } = Astro.props;
---
<section class="w2-quest-list" aria-label="Nhiệm vụ hôm nay">
  <h2>Nhiệm vụ hôm nay</h2>
  <div class="w2-quest-grid">
    {quests.map(q => <QuestCard quest={q} />)}
  </div>
</section>
```

Empty state: nếu `quests.length === 0` → message "Đang tải nhiệm vụ…".

### 3.3 ChestBox (closed, on result screen / profile)

```astro
---
export interface Props {
  rarity: 'common' | 'rare' | 'epic';
  preview_text: string;          // 'Hộp này chứa 10–20 xu.'
  pending: boolean;              // true = available to open
  data_test_id?: string;
}
const { rarity, preview_text, pending } = Astro.props;
---
<button class="w2-chest-box" data-rarity={rarity} data-pending={pending} type="button" aria-label={`Mở hộp ${rarity}`}>
  <div class="w2-chest-art" data-rarity={rarity}>
    <!-- SVG or PNG closed chest, rarity tint -->
  </div>
  <p class="w2-chest-preview">{preview_text}</p>
</button>
```

Animations:
- `data-pending="true"`: gentle bounce + glow loop CSS.
- Click triggers `window.__r2lJuice?.openChest()` (Z5 implements).

### 3.4 ChestOpening (modal, 3-stage)

```astro
---
export interface Props {
  rarity: 'common' | 'rare' | 'epic';
  reward: { coins: number; part_id: string | null; part_name?: string };
  duplicate: boolean;
}
---
<dialog class="w2-chest-modal" data-rarity={rarity}>
  <div class="w2-chest-stage" data-stage="closed">
    <!-- Stage 1: closed chest, shaking -->
  </div>
  <div class="w2-chest-stage" data-stage="cracking" hidden>
    <!-- Stage 2: cracking, light spilling -->
  </div>
  <div class="w2-chest-stage" data-stage="burst" hidden>
    <!-- Stage 3: burst + confetti + reveal -->
    <div class="w2-chest-reward">
      <span class="w2-reward-coins">🪙 +{reward.coins}</span>
      {reward.part_id && !duplicate && <span class="w2-reward-part">Mới: {reward.part_name || reward.part_id}</span>}
      {duplicate && <span class="w2-reward-dup">Trùng → +xu bonus 🎉</span>}
    </div>
    <button class="w2-chest-close" type="button">Tiếp tục</button>
  </div>
</dialog>
```

CSS animations (must be in scoped `<style>`):

- `closed` stage: 1.5s shake (x-translate ±4px), 3 iterations.
- Transition closed → cracking via JS swap + CSS `crack-glow` 0.6s.
- `cracking` stage: 0.8s opacity fade + scale 1→1.2 + bright glow.
- `burst` stage: 1s scale 1.2→1.0 + confetti burst (re-use existing `canvas-confetti` if loaded by lesson).

Sequencing exposed via data-stage attr — JS controller (Z5) swaps stage. Z4 provides CSS + HTML only.

### 3.5 ComboCounter

```astro
---
export interface Props { level: 1 | 2 | 3; visible: boolean; }
const { level, visible } = Astro.props;
---
<aside class="w2-combo-counter" data-level={level} data-visible={visible} aria-hidden={!visible}>
  {level >= 2 && <div class="w2-combo-badge">x{level} COMBO</div>}
</aside>
```

CSS: floating top-right inside activity area. `data-level="3"`: gold gradient + small bounce. Disappears at `level=1`.

### 3.6 NearMissBanner

```astro
---
export interface Props { text: string; visible: boolean; }
const { text, visible } = Astro.props;
---
<div class="w2-nearmiss-banner" data-visible={visible} role="status" aria-live="polite">
  <span class="w2-nearmiss-icon">✨</span>
  <span class="w2-nearmiss-text">{text}</span>
</div>
```

Visible: slides down from top, 3s, then slides up. JS (Z5) toggles.

### 3.7 DailyLoginChest

```astro
---
export interface Props {
  available: boolean;       // true if not claimed today
  reward_preview: number;   // computed by Z1 via formula
}
---
<button class="w2-daily-chest" data-available={available} type="button" disabled={!available}>
  <span class="w2-daily-chest-icon">🎁</span>
  {available
    ? <span>Quà hôm nay: +{reward_preview} 🪙</span>
    : <span>Đã nhận hôm nay — quay lại mai!</span>}
</button>
```

Click → `window.__r2lJuice?.claimDailyChest?.()` (Z5 implements).

## 4. CSS tokens — reuse W1 game shell

Use existing kid theme tokens (Baloo 2, navy-950, accent yellow/green). KHÔNG đẻ tokens mới. Reference `src/styles/r2l-kid-theme.css` (existing).

Chest rarity color tints:
- common: `--w2-chest-common: #94a3b8` (slate)
- rare: `--w2-chest-rare: #60a5fa` (blue)
- epic: `--w2-chest-epic: #fbbf24` (gold)

Add to component scoped style; KHÔNG global.

## 5. Tests (`tests/read2lead-w2-ui.test.mjs`)

Astro components test = SSR render với fixed props → assert HTML contains expected strings + attrs. Use `node --test` + `@astrojs/test` if available, else simple regex check on rendered HTML via `container.renderToString` pattern (xem hub tests có pattern này không).

```js
import { test } from 'node:test';
import assert from 'node:assert';
// Import via: const { default: QuestCard } = await import('../src/components/read2lead/v4/QuestCard.astro');
// If Astro test framework not available, render via experimental container:
import { experimental_AstroContainer as AstroContainer } from 'astro/container';

test('QuestCard renders label + progress + claim button when complete', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(QuestCard, {
    props: { quest: { id: 'q1', label_vi: 'Xong 1 bài', target: 1, progress: 1, reward_coins: 10, reward_rp: 0, claimed: false } },
  });
  assert.ok(html.includes('Xong 1 bài'));
  assert.ok(html.includes('w2-quest-claim'));
});

test('QuestCard hides claim button when not complete', async () => { /* */ });
test('QuestCard shows "Đã nhận" when claimed', async () => { /* */ });
test('QuestList renders 3 cards', async () => { /* */ });
test('QuestList empty state when no quests', async () => { /* */ });
test('ChestBox sets data-rarity attr', async () => { /* */ });
test('ChestBox preview text from props', async () => { /* */ });
test('ChestOpening has 3 stage divs', async () => { /* */ });
test('ChestOpening duplicate path shows bonus message', async () => { /* */ });
test('ComboCounter hidden when level=1', async () => { /* */ });
test('ComboCounter shows badge when level≥2', async () => { /* */ });
test('NearMissBanner role status', async () => { /* */ });
test('DailyLoginChest disabled when !available', async () => { /* */ });
```

Aim: 12+ tests, all green. If AstroContainer not available, fall back to simple unit-style HTML string assertion via prop transforms (skip SSR test, test props math separately).

## 6. Done when

1. 7 components created + each has scoped `<style>` ≤ ~80 lines.
2. CSS animations: chest 3-stage, near-miss slide, combo bounce.
3. Tests ≥12 green.
4. `node --test` toàn bộ xanh.
5. `npx astro check` không thêm error.
6. Branch `cursor-3/w2-z4-ui` pushed origin.
7. AGENT_LOG START + DONE với commit hash.

## 7. Constraints

- KHÔNG sửa lesson.astro, hoc-sinh/, leaderboard.astro, shop.astro, games.astro.
- KHÔNG sửa state-core, AGENTS.md.
- KHÔNG thêm npm dep (canvas-confetti đã có).
- Mỗi component file < 250 dòng (HTML + style + ít script).
- Tap target ≥ 44px (kid-first UI).
- A11y: aria-label, role="status" cho banner.
- Bundle: KHÔNG import library nặng. Astro auto-tree-shakes nếu chỉ dùng <style scoped>.

## 8. Report

Theo format AGENTS.md §4.
