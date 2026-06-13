# V4 W4.5 — Shop UX polish cho kid 7 tuổi (1 Cursor agent)

**Owner:** Cursor · **Branch:** `cursor-N/w4-5-kid-ux` (off `origin/v4-w2`)
**Status:** READY · **Author:** Claude · **Date:** 2026-06-13
**Trigger:** Phương 2026-06-13: "đảm bảo UX/UI một đứa trẻ 7 tuổi cũng hiểu và sử dụng được"

---

## 1. Mục tiêu

W4 đã ship shop logic + components cơ bản. W4.5 polish UI cho kid 7 tuổi: text → icons, big visual feedback, tier badges Vietnamese + mobile color, audio confirm khi buy, animation khi unlock.

## 2. Hard rules cho kid 7 tuổi (tham khảo khi build)

- **Tap target ≥ 64px** (lớn hơn cả V4 §1 yêu cầu ≥44px). Ngón tay kid nhỏ + non-fine motor control.
- **Text < 10 chữ/dòng**. Câu ngắn. Verb đầu câu ("Mua", "Đeo", "Bỏ ra").
- **Icon > text** mọi nơi possible. Text chỉ phụ trợ icon.
- **No English** in UI. "Mua" not "Buy". "Có rồi" not "Owned".
- **Color signal** (mobile game convention):
  - Common = xám (#94a3b8) — viền/badge xám nhạt
  - Hiếm = xanh dương (#3b82f6) — viền/badge xanh + glow nhẹ
  - Sử Thi = tím (#a855f7) — viền/badge tím + glow mạnh + sparkle particles
- **Audio feedback** mọi click: `coin-clink` cho buy success, `quest-complete` cho unlock part, fail buzz cho disabled.
- **Animation** khi unlock: 1-2s celebrate (scale 1→1.2→1, particle burst, confetti nhỏ).
- **Never dead end**: nếu kid không đủ xu → modal cute "Còn thiếu X xu" + suggest "Học thêm 1 bài để nhận xu".

## 3. Files allowed

- `src/components/read2lead/v4/ShopItem.astro` (EDIT — polish per spec)
- `src/components/read2lead/v4/ShopGrid.astro` (EDIT — add tier section headers)
- `src/components/read2lead/v4/RarityBadge.astro` (NEW — reusable Vietnamese tier badge)
- `src/components/read2lead/v4/InsufficientCoinsModal.astro` (NEW — friendly "thiếu xu" dialog)
- `src/components/read2lead/v4/UnlockCelebration.astro` (NEW — 1.5s animation modal khi unlock)
- `src/pages/read2lead/shop.astro` (EDIT — wire modals + audio cues)
- `src/lib/shop-ux.ts` (NEW — small helper module for shop interactions + audio)
- `tests/shop-ux.test.mjs` (NEW — SSR tests for new components)

Cấm sửa:
- `_read2lead-shop-v2.js` (backend logic OK)
- `_read2lead-chests.js`, `_read2lead-quests.js` (W2 modules)
- `monster-parts.json`
- mic/speaking, state-core, lesson.astro

## 4. Component specs

### 4.1 RarityBadge.astro

```astro
---
import { rarityLabelVi, RARITY_COLORS } from '../../../../functions/api/_read2lead-chests';
export interface Props {
  rarity: 'common' | 'rare' | 'epic';
  size?: 'small' | 'large';
}
const { rarity, size = 'small' } = Astro.props;
const label = rarityLabelVi(rarity);
const color = RARITY_COLORS[rarity];
---
<span class={`r-badge r-badge-${size}`} data-rarity={rarity} style={`--badge-color: ${color}`}>
  {rarity === 'epic' && <span class="r-sparkle" aria-hidden="true">✨</span>}
  <span class="r-label">{label}</span>
</span>
```

Sparkle ✨ chỉ trên epic. Glow CSS animation infinite on epic, fade-in on rare.

### 4.2 ShopItem polish

```astro
---
// Existing props + add:
export interface Props {
  id: string;
  rarity: 'common' | 'rare' | 'epic';
  price: number;
  name: string;
  thumbnail_url?: string;  // NEW — URL to part PNG preview
  owned: boolean;
  can_afford: boolean;
}
---
<article class="shop-item" data-rarity={rarity} data-owned={owned} data-can-afford={can_afford}>
  <div class="shop-item-art">
    {thumbnail_url
      ? <img src={thumbnail_url} alt={name} loading="lazy" />
      : <div class="shop-item-placeholder">🎨</div>}
    <RarityBadge rarity={rarity} />
  </div>
  <h3 class="shop-item-name">{name}</h3>
  <div class="shop-item-action">
    {owned
      ? <span class="shop-item-owned"><span aria-hidden="true">✓</span> Có rồi</span>
      : (
        <button class="shop-item-buy" type="button" data-part-id={id} data-price={price} disabled={!can_afford}>
          <span class="shop-item-coin" aria-hidden="true">🪙</span>
          <span class="shop-item-price">{price}</span>
        </button>
      )}
  </div>
</article>
```

CSS:
- Tap target `min-height: 80px` toàn item, button `min-height: 64px`.
- Border `data-rarity="epic"`: 3px solid #a855f7 + glow box-shadow.
- Border `data-rarity="rare"`: 2px solid #3b82f6 + soft shadow.
- Border `data-rarity="common"`: 1px solid #94a3b8.
- Disabled state (`data-can-afford="false"`): opacity 0.5, no glow, button price text becomes red.
- Owned state: border green + ✓ icon.

### 4.3 ShopGrid với tier sections

```astro
---
import RarityBadge from './RarityBadge.astro';
import ShopItem from './ShopItem.astro';
export interface Props { items: Item[]; }
const epicItems = items.filter(i => i.rarity === 'epic');
const rareItems = items.filter(i => i.rarity === 'rare');
const commonItems = items.filter(i => i.rarity === 'common');  // typically empty
---
<section class="shop-grid">
  {epicItems.length > 0 && (
    <section class="shop-section" data-tier="epic">
      <header class="shop-section-header">
        <RarityBadge rarity="epic" size="large" />
        <h2>Sử Thi — {epicItems.length} món</h2>
      </header>
      <div class="shop-section-items">
        {epicItems.map(item => <ShopItem {...item} />)}
      </div>
    </section>
  )}
  {rareItems.length > 0 && (
    <section class="shop-section" data-tier="rare">
      <header class="shop-section-header">
        <RarityBadge rarity="rare" size="large" />
        <h2>Hiếm — {rareItems.length} món</h2>
      </header>
      <div class="shop-section-items">
        {rareItems.map(item => <ShopItem {...item} />)}
      </div>
    </section>
  )}
  {/* common section omitted — common parts are free, no shop entry */}
</section>
```

### 4.4 InsufficientCoinsModal

```astro
---
export interface Props { coins_needed: number; current_coins: number; }
---
<dialog class="insufficient-modal">
  <div class="insufficient-emoji">😊</div>
  <h2>Còn thiếu {coins_needed} xu</h2>
  <p>Học 1 bài là có ngay xu nha!</p>
  <button class="insufficient-go-learn" type="button">Đi học</button>
  <button class="insufficient-close" type="button">Để sau</button>
</dialog>
```

Click "Đi học" → navigate `/hoc-sinh` (kid hub). Click "Để sau" → close.

### 4.5 UnlockCelebration

```astro
---
export interface Props { part_name: string; rarity: 'common' | 'rare' | 'epic'; }
---
<dialog class="unlock-celebration" data-rarity={rarity}>
  <div class="unlock-burst" aria-hidden="true"></div>
  <h2>Mới có {RARITY_LABELS_VI[rarity]}!</h2>
  <div class="unlock-part-name">{part_name}</div>
  <div class="unlock-sparkles" aria-hidden="true">✨ ✨ ✨</div>
  <button class="unlock-equip" type="button">Đeo ngay</button>
  <button class="unlock-later" type="button">Để sau</button>
</dialog>
```

CSS: dialog opens với `transform: scale(0)` → `scale(1)` over 300ms. Burst là radial gradient animation 1.5s. Auto-close sau 4s nếu kid không bấm.

### 4.6 shop-ux.ts helper

```ts
import { play as playAudio } from './r2l-audio';

export async function buyPart(partId: string, code: string): Promise<{ok: boolean; reward?: any; error?: string}> {
  try {
    const res = await fetch('/api/read2lead-shop-buy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, part_id: partId }),
    });
    const data = await res.json();
    if (data.ok) await playAudio('coin-clink');
    return data;
  } catch { return { ok: false, error: 'network' }; }
}

export async function showUnlock(partName: string, rarity: string): Promise<void> {
  await playAudio('quest-complete');
  // open UnlockCelebration dialog (selector .unlock-celebration)
  const dialog = document.querySelector('.unlock-celebration') as HTMLDialogElement;
  if (!dialog) return;
  dialog.dataset.rarity = rarity;
  (dialog.querySelector('.unlock-part-name') as HTMLElement).textContent = partName;
  dialog.showModal();
  setTimeout(() => dialog.close(), 4000); // auto-close
}

export function showInsufficient(needed: number, current: number): void {
  const dialog = document.querySelector('.insufficient-modal') as HTMLDialogElement;
  if (!dialog) return;
  (dialog.querySelector('h2') as HTMLElement).textContent = `Còn thiếu ${needed} xu`;
  dialog.showModal();
}
```

## 5. Tests (`tests/shop-ux.test.mjs` — ≥8 tests)

```
test('RarityBadge renders Vietnamese label per rarity')
test('RarityBadge epic includes sparkle emoji')
test('RarityBadge color CSS var matches mobile convention')
test('ShopItem rare has blue border data-rarity')
test('ShopItem epic has purple border + glow')
test('ShopItem disabled when !can_afford')
test('ShopGrid groups items into epic / rare sections')
test('ShopGrid hides empty tier section')
test('InsufficientCoinsModal opens with correct deficit number')
test('UnlockCelebration includes Vietnamese rarity label')
```

## 6. Done when

1. 5 component (3 new + 2 edit) + 1 helper module + 1 test file.
2. RarityBadge tích hợp mobile-color + Vietnamese label.
3. ShopGrid section headers `Sử Thi / Hiếm`.
4. Audio cues qua `shop-ux.ts` helper.
5. Tap target ≥ 64px on all clickable elements.
6. No English in UI (verify by grep).
7. `node --test` xanh.
8. `npx astro check` không thêm error.
9. Branch pushed.
10. AGENT_LOG START + DONE với commit hash.

## 7. Constraints

- KHÔNG sửa backend logic — chỉ frontend polish.
- KHÔNG đụng W2 components ngoài ShopItem/Grid.
- Bundle delta ≤ 5KB gzipped cho shop page.

## 8. Report

Per AGENTS.md §4 + paste `npx astro check` baseline diff + paste 1 screenshot mô tả shop sau (text description nếu không có browser).
