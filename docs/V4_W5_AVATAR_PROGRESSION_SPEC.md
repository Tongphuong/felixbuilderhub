# V4 W5 — Avatar progression + inventory lock + equip ceremony

**Owner:** Codex · **Branch:** `codex/w5-avatar-progression` (off `origin/main`)
**Status:** READY — Phương locked 2026-06-14
**Author:** Claude · **Date:** 2026-06-14

> **Problem statement (Phương 2026-06-14):** Học sinh hiện tại đang FREE chọn TẤT CẢ 148 parts (incl. rare/epic) trong `/hoc-sinh` MonsterBuilder — vô hiệu hóa shop. Plus chưa có "hatching" progression: L1 phải là trứng, L2 mới hé monster cơ bản. Cần lock + ceremony.

---

## 1. Goal

3 thay đổi cốt lõi:

1. **Egg state L1** — học sinh mới (L1) thấy 1 quả trứng (như ClassDojo monster), KHÔNG có MonsterBuilder.
2. **Basic monster L2 (Bạc)** — khi đạt L2 lần đầu, trứng nở → monster mặc định **toàn trắng** (whiteA body + arm + eye basic + mouth basic + no detail). MonsterBuilder mở ra NHƯNG chỉ cycle qua parts đã unlock.
3. **Lock mechanic** — `unlocked_parts` + common-default rule là source of truth cho parts kid có thể equip. Rare/epic CHỈ available sau khi mua shop hoặc chest reward.
4. **Equip ceremony** — khi kid pick 1 part mới (rare/epic vừa unlock), play particle + audio + brief animation 1.2s.

## 2. Files allowed

- `functions/api/_read2lead-v2-state.js` — add `avatar_stage` field + migrate logic + `getEggOrMonsterView()` helper
- `src/lib/avatar-rarity.ts` — already exists from W3; verify `isPartUnlocked` works
- `src/lib/monster-builder.ts` — gate part cycling to unlocked only
- `src/lib/egg-renderer.ts` (NEW) — render egg SVG/PNG state
- `src/components/read2lead/v3/avatar/MonsterBuilder.astro` — minor wire
- `src/components/read2lead/v4/EggAvatar.astro` (NEW) — egg display component
- `src/components/read2lead/v4/EquipCeremony.astro` (NEW) — particle burst dialog
- `src/pages/hoc-sinh/hoc-sinh-w1.ts` — branch render egg vs monster + hook ceremony
- `src/pages/hoc-sinh/hoc-sinh-w1.css` — egg + ceremony styles
- `tests/avatar-progression.test.mjs` (NEW)
- `tests/avatar-lock.test.mjs` (NEW)
- `tests/egg-renderer.test.mjs` (NEW)
- `public/assets/monsters/egg-basic.svg` (NEW — inline SVG placeholder until Research-Claude finds CC0 egg art)

CẤM:
- Sửa lesson.astro, mic/speaking pipeline, shop endpoints
- Sửa W2 quest/chest modules
- Sửa rank/season logic

## 3. State schema additions

Trong `normalizeProgressState`:

```js
avatar_stage: normalizeAvatarStage(raw?.avatar_stage, currentLevel),
```

`avatar_stage` enum: `'egg' | 'basic' | 'custom'`

```js
function normalizeAvatarStage(raw, currentLevel) {
  if (raw === 'egg' || raw === 'basic' || raw === 'custom') return raw;
  // Migration default: L1 = egg, L2+ = basic
  if (currentLevel === 'L1') return 'egg';
  return 'basic';
}
```

**Stage transitions** (happen automatically on state read, idempotent):
- L1 → `egg` (locked, no MonsterBuilder)
- L2 reach → `basic` (default white monster, MonsterBuilder unlocked)
- After first equip in MonsterBuilder → `custom` (user has customized)

`basic` defaults (frozen constants):
```js
export const BASIC_MONSTER_CONFIG = {
  body: 'png-default-body-whitea',
  arms: 'png-default-arm-whitea',
  eyes: 'png-default-eye-large-blue', // pick the friendliest "default" eye
  mouth: 'png-default-moutha',
  detail: '', // no detail by default
  color: 'mint',
};
```
Phương validate eye/mouth picks during QA.

## 4. Stage-aware render

Replace existing `state.avatar.monster` direct render with stage gate:

```js
// in publicProgressState
{
  ...,
  avatar_stage: state.avatar_stage,
  monster_basic_defaults: BASIC_MONSTER_CONFIG, // exposed for client convenience
}
```

In `hoc-sinh-w1.ts:renderHook`:
```js
const stage = read2LeadState.avatar_stage || 'basic';
if (stage === 'egg') {
  // render <EggAvatar> instead of monster slot
  monsterSlot.innerHTML = renderEggHtml(name);
  // Hide MonsterBuilder section entirely
} else {
  // existing renderMonster path
  // if stage === 'basic' AND monster config is the BASIC_MONSTER_CONFIG, show "Tap to customize" hint
}
```

## 5. MonsterBuilder lock mechanic

In `monster-builder.ts`:

```ts
import { isPartUnlocked, getPartRarity } from './avatar-rarity';

function getAvailablePartsForSlot(
  slot: MonsterSlot,
  state: { unlocked_parts?: string[] },
): MonsterPartEntry[] {
  const all = MONSTER_MANIFEST[slot] || [];
  return all.filter((part) => isPartUnlocked(state, part.id));
}
```

When MonsterBuilder mounts:
- Build cycleable list per slot = `getAvailablePartsForSlot(slot, state)`
- Common parts always in list (default unlocked per W3 spec)
- Rare/epic only if `state.unlocked_parts.includes(partId)`
- If list has only 1 item for a slot → disable `<` `>` arrows for that slot (no cycling possible)

**Locked indicator** in MonsterBuilder:
- After last available part in cycle, append 1 "lock card" showing `🔒 Mua thêm ở Cửa hàng` with link to `/read2lead/shop`. Tap → navigates to shop.
- This is visible per slot if there are rare/epic parts NOT yet unlocked.

## 6. Equip ceremony

When user clicks `>` or `<` to cycle parts AND the new part is:
- A **rare** or **epic** part (just bought, first time equipping)
- OR transition from `basic` → `custom` stage (first customize ever)

Trigger ceremony:
1. Mount `EquipCeremony` dialog programmatically (`document.createElement('dialog')` if not in DOM)
2. Show 3-stage animation:
   - **Stage 1 (0-300ms)**: particle ring burst around monster (use CSS animation, no external lib)
   - **Stage 2 (300-800ms)**: brief flash + monster scale 1→1.1→1 with new part visible
   - **Stage 3 (800-1200ms)**: Vietnamese label "✨ Mới: [part name] ✨" floats up + fade
3. Play `window.__r2lJuice?.playKenney?.('quest-complete')` (audio existing from Z5)
4. Auto-close after 1.2s
5. Save: state.avatar_stage = 'custom' (idempotent)

`EquipCeremony.astro` skeleton:
```astro
---
export interface Props { partName: string; rarity: 'common'|'rare'|'epic'; }
const { partName, rarity } = Astro.props;
---
<dialog class="r2l-equip-ceremony" data-rarity={rarity}>
  <div class="ceremony-stage" data-stage="burst">
    <div class="ceremony-ring"></div>
    <div class="ceremony-sparkles" aria-hidden="true">
      <span></span><span></span><span></span><span></span><span></span><span></span>
    </div>
    <p class="ceremony-label">✨ Mới: {partName} ✨</p>
  </div>
</dialog>
```

CSS:
- 6-12 `<span>` sparkles positioned radial via `--angle: 60deg` per child
- Ring expanding from scale 0 to 1.5
- Sparkles fly outward + fade
- All keyframes ≤ 1.2s total

## 7. EggAvatar

```astro
---
export interface Props { name: string; level: string; }
---
<div class="r2l-egg-shell" data-level={level}>
  <svg viewBox="0 0 200 240" class="r2l-egg-svg" aria-hidden="true">
    <!-- inline egg shape with subtle wobble animation -->
    <ellipse cx="100" cy="140" rx="80" ry="100" fill="#fef3c7" stroke="#d97706" stroke-width="4" />
    <!-- TODO: replace with Research-Claude finding (CC0 egg PNG) -->
  </svg>
  <p class="r2l-egg-greeting">Chào {name}! Khi con học lên Bạc, trứng sẽ nở 🐣</p>
</div>
```

Subtle wobble: 4s ease-in-out infinite, ±2deg rotation.

Click trứng → toast "Còn {X} bài nữa nở nhé!" (X = packs_until_level_up).

## 8. Migration safety

Old kids đang có monster config với rare/epic parts (no `unlocked_parts` history):

```js
// in normalizeProgressState, AFTER avatar normalization:
if (raw?.avatar?.monster) {
  const currentParts = [
    raw.avatar.monster.body,
    raw.avatar.monster.arms,
    raw.avatar.monster.eyes,
    raw.avatar.monster.mouth,
    raw.avatar.monster.detail,
  ].filter(Boolean);
  const unlocked = new Set(raw.unlocked_parts || []);
  for (const pid of currentParts) {
    if (getPartRarity(pid) !== 'common') unlocked.add(pid);
  }
  state.unlocked_parts = [...unlocked];
}
```

**Grandfather rule:** kid đang dùng rare/epic part nào, tự động add vào unlocked_parts để không break experience.

## 9. Tests

### `tests/avatar-progression.test.mjs` (≥10 tests)
- Stage L1 default 'egg'
- Stage L2+ default 'basic'
- Stage transition basic → custom on first equip
- Stage persisted through state write
- Old records (no avatar_stage field) migrate correctly per level
- getEggOrMonsterView returns egg config when stage='egg'

### `tests/avatar-lock.test.mjs` (≥10 tests)
- getAvailablePartsForSlot returns only common when unlocked_parts=[]
- getAvailablePartsForSlot returns common + rare when rare in unlocked_parts
- isPartUnlocked default true for common
- isPartUnlocked false for rare not unlocked
- isPartUnlocked respects unlocked_parts list
- Migration adds rare from current config to unlocked_parts
- Migration is idempotent (re-run doesn't duplicate)

### `tests/egg-renderer.test.mjs` (≥3 tests)
- renderEggHtml includes svg + name + greeting
- Egg-stage data attribute set per level
- No monster config leaked when stage='egg'

## 10. Done when

1. State has `avatar_stage` field, normalizers + migration applied
2. publicProgressState exposes stage + basic defaults
3. `/hoc-sinh` shows egg for L1, basic monster for L2 first-time, custom after equip
4. MonsterBuilder filters parts per `unlocked_parts` (rare/epic locked until owned)
5. Shop purchase → unlocked_parts updated → next render shows new part cycleable in MonsterBuilder
6. EquipCeremony fires on first rare/epic equip with audio + animation
7. Old kids migrated: their existing rare/epic parts auto-added to unlocked_parts
8. Tests ≥23 across 3 files green; full suite stays at 469+ green
9. `npx astro check` no NEW errors
10. Branch pushed; AGENT_LOG START + DONE with commit hash

## 11. Hard constraints

- Live students! State changes additive only — never rename field.
- MonsterBuilder must not crash if state.unlocked_parts undefined (default to []).
- Egg state must not query Avatar parts (zero render risk).
- Ceremony dialog must close automatically (no infinite loop).
- Audio failure must not block ceremony (graceful per Z5 pattern).
- No client-side mutation of unlocked_parts — only server (via shop-buy + chest-open endpoints).

## 12. Phương decision gates

| Gate | Question | Default |
|---|---|---|
| G1 | Egg art: SVG inline OR wait Research-Claude PNG? | SVG inline now, swap to PNG later |
| G2 | Basic monster eye choice: large-blue / red / cyclone? | large-blue (friendliest) |
| G3 | Basic monster mouth: mouthA (happy) / closed-happy / smile? | mouthA |
| G4 | Equip ceremony also fires for common parts on first cycle? | NO — only rare/epic first equip |
| G5 | Migration: grandfather existing rare/epic OR force reset to basic? | grandfather (no disruption) |

Codex implement với defaults; Phương override sau qua chat.

## 13. Spec for Research-Claude follow-up

`D:\_ops\inbox\research\2026-06-14_egg-and-vfx.md` (queued separately):
- Egg PNG art (CC0) — ClassDojo-style cartoon egg với shape variety (cracked, glowing, hatching frames)
- Particle effect spritesheets (CC0) — sparkle, ring burst, magic glow — for equip ceremony
- Optional: kid-friendly cocoon → hatch animation frames

Codex KHÔNG đợi research — ship với SVG placeholder. Research output sẽ improve visual later.
