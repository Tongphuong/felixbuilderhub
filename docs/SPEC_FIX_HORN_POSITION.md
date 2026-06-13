# SPEC — Fix sừng monster bị lệch

**Owner:** Claude · **Executor:** Codex · **Branch:** `codex/horn-position-fix` (off `origin/main`)
**Created:** 2026-06-13 · **Status:** READY

---

## Vấn đề

Phương QA mắt prod 2026-06-13: tay monster đã ổn (sau arm-direction fix `87354b3`), nhưng **sừng vẫn lệch** trên một số combinations. Root cause giống arm-direction: anchor hiện tại tính từ canvas center (`0.5, 10/165`) thay vì measured pivot từ alpha PNG. Khi body shape khác A (B/C/D/E/F có body_box khác `FULL_CANVAS_BOX`), sừng dịch chuyển nhưng vị trí gốc-sừng-trên-head không khớp.

Code hiện tại: `src/lib/monster-slot-layout.ts:220`

```ts
if (base.includes('horn')) return at(0.5, 10 / 165, 0.85, 0.9);
```

`fx=0.5` (giữa), `fy=10/165` (gần top), `maxScale=0.85`, `widthFrac=0.9` — đều là eyeball estimate, KHÔNG đo từ pixel.

## Mục tiêu

Sừng đặt đúng đỉnh đầu mọi body shape × mọi horn color × mọi horn size (large/small). Cùng cách đo + verify như arm-direction fix.

## Files allowed (KHÔNG đụng ngoài list)

- `src/lib/monster-slot-layout.ts` (sửa `resolvePartAnchor` cho horn)
- `src/lib/monster-avatar.ts` (chỉ nếu cần điều chỉnh render call)
- `public/assets/monsters/monster-parts.json` (nếu cần thêm horn-specific geometry metadata)
- `scripts/measure_horn_pivots.py` (NEW — đo alpha PNG, output JSON)
- `tests/monster-horn-position.test.mjs` (NEW)
- `docs/HORN_AUDIT_RESULTS.md` (NEW — kết quả đo + kết quả contact test)

## Allowed tools

- Pillow (Python) để đo alpha PNG — copy pattern từ existing `scripts/measure_arm_*.py` (nếu có) hoặc viết mới.
- Node `--test` cho test mới.

## Approach (giống mẫu arm-direction fix)

### Step 1 — Đo pivot từ alpha PNG cho tất cả 10 horn parts

PNG list: `public/assets/monsters/PNG/Default/detail_<color>_horn_<size>.png` × {blue, dark, green, red, white} × {large, small}.

Cho mỗi PNG (165×165):
- Tìm alpha-nonzero bounding box → `(min_x, min_y, max_x, max_y)`
- **Horn-base pivot** = `(centroid_x_of_alpha, max_y)` — điểm sừng tiếp xúc đầu monster (bottom-center của visible pixel cluster)
- Output: `{ file, pivot_x_frac: centroid_x/165, pivot_y_frac: max_y/165, width_frac: (max_x-min_x)/165 }`

Lưu kết quả JSON vào `public/assets/monsters/horn-pivots.json` (tương tự `monster-parts.json` đã có).

### Step 2 — Resolve horn anchor dùng measured pivot per body shape

Thay anchor hardcode bằng:

```ts
if (base.includes('horn')) {
  const pivot = HORN_PIVOTS[base];  // load từ horn-pivots.json
  return at(
    pivot.pivot_x_frac,             // fx: nơi sừng cắm vào đầu, theo X
    pivot.pivot_y_frac,             // fy: nơi sừng cắm vào đầu, theo Y
    0.85,                           // giữ maxScale
    pivot.width_frac * 1.05         // 5% margin, không quá to
  );
}
```

Lưu ý:
- `bodyBox.y + fy * bodyBox.h` → khi shape khác A, `bodyBox.y` lớn hơn → sừng tự dịch theo đỉnh đầu của shape đó.
- Test fallback: nếu file không có trong `HORN_PIVOTS` → quay về anchor cũ `(0.5, 10/165, 0.85, 0.9)`.

### Step 3 — Contact test (90 combinations)

Bắt chước arm-direction QA:
- 6 body shape × 5 color × 3 horn (no-horn / horn-large / horn-small variants tổng hợp) = 90 combinations.
- Render mỗi combo ra PNG → assert `(horn_pivot_y_after_transform - body_top_y) < 5px tolerance`.
- Lưu evidence vào `docs/HORN_AUDIT_RESULTS.md`.

### Step 4 — Unit tests `tests/monster-horn-position.test.mjs`

- Test `resolvePartAnchor('detail', 'detail_blue_horn_large.png', bodyBoxA)` → returns measured pivot.
- Test fallback khi part không có trong PIVOTS.
- Test khi shape khác A, anchor dịch theo bodyBox.y proportionally.

## Done when

1. `node --test tests/monster-horn-position.test.mjs` xanh.
2. `node --test` toàn bộ xanh (không gãy tests cũ).
3. `npx astro check` không thêm error mới.
4. `docs/HORN_AUDIT_RESULTS.md` có bảng 90 combo + ảnh thumbnail mẫu.
5. Push branch `codex/horn-position-fix`, append AGENT_LOG DONE với commit hash.

## Spec phạm vi RÕ — không drift

KHÔNG sửa:
- `lesson.astro`, `r2l-recorder.js`, `r2l-mic-check.js`, mic/speaking flow.
- Arm anchor logic (đã ship).
- Body / eyes / mouth anchor logic.
- Color filter / hue-rotate logic.
- Manifest entries của các slot khác.

KHÔNG thêm:
- New cosmetic categories.
- New horn parts.
- New shop items.

Hỏi Phương qua Claude nếu thấy cần mở rộng zone.

## Constants gốc (giữ nguyên)

- 5 body shapes (A-F), 5 colors (mint/coral/sky/lemon/grape).
- 5 horn colors (blue/dark/green/red/white) × 2 sizes (large/small) = 10 horn parts.
- Tolerance 5px sau transform.

## Verify protocol

Phương sẽ QA mắt sau khi Codex push branch + preview URL `<branch>.felixbuilderhub.pages.dev` build. Nếu sừng đúng trên 5-6 combo Phương check → Claude merge main.
