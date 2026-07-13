/**
 * The ONE place a gift photo URL is built.
 *
 * There used to be three copies of this — gift-ux.ts (the shop), admin-gifts.ts
 * (the admin preview), and gift-goal-card.ts (the child's profile, the
 * end-of-lesson card, and the parent's weekly report). When the year-long-cache
 * bug below was fixed, two of the three were updated. The third was not — and it
 * was the one on the parent's report, exactly the screen Coach Felix looks at
 * first. Buffet found it. A fourth copy would have appeared eventually.
 *
 * So: one function, three importers. The duplication is deleted, not patched.
 *
 * ---
 *
 * Why the `v` param exists, and why it must never be dropped:
 *
 * `functions/api/read2lead-gift-image.js` answers
 * `Cache-Control: public, max-age=31536000, immutable`. The URL used to be just
 * `?id=<id>` — identical before and after an upload — so REPLACING a photo was
 * invisible to any browser or CDN edge that had already cached the old one. For a
 * year. Coach Felix would swap a wrong photo for a right one, reload, still see
 * the wrong one, and conclude the upload was broken. He reported exactly that
 * symptom once, and it was the true cause the second time.
 *
 * `image_key` now carries a unique stamp per upload (see
 * `functions/api/admin/gifts/upload.js`), so the key changes whenever the bytes
 * do, which makes this URL change, which makes `immutable` finally honest instead
 * of a lie. The server ignores `v` entirely and resolves the photo through
 * `gift.image_key` looked up by `id`, so `v` exists only to be different and
 * cannot be used to reach another gift's image.
 */
export type GiftPhotoRef = {
  id: string;
  image_key?: string | null;
  image_url?: string | null;
};

/** Precedence per HANDOFF §2: uploaded photo → pasted URL → none (emoji fallback). */
export function giftPhotoSrc(gift: GiftPhotoRef): string | null {
  if (gift.image_key) {
    return `/api/read2lead-gift-image?id=${encodeURIComponent(gift.id)}`
      + `&v=${encodeURIComponent(gift.image_key)}`;
  }
  if (gift.image_url) return gift.image_url;
  return null;
}
