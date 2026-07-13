# Release — Read2Lead

- Candidate version: R2L-REAL-GIFTS — "Quà thật" real-life gift shop — **SHIPPED to production 2026-07-13, merge commit 7ff8816**
- Staging URL: `https://claude-r2l-real-gifts.felixbuilderhub.pages.dev` (production: `https://felixbuilderhub.com/read2lead/gifts`)
- Rollback commit or deployment: revert the single feature commit on main; Cloudflare Pages auto-redeploys
- Scope and UI approved: yes
- Targeted tests passed: yes
- Relevant full tests passed: yes
- Core browser flow passed: yes
- Mobile check passed: yes
- Desktop check passed: yes
- Console and API errors checked: yes
- Privacy and cost checked: yes
- Screenshot or video proof ready: yes
- Founder production approval: yes
- Production smoke test passed: yes

## Evidence

- **Scope and UI**: built to Claude Design's approved handoff bundle (`Read2Lead Real Gifts Shop/`); all 7 screens screenshot-verified at 390px and 1280px.
- **Tests**: 1372/1372 `node --test`, 0 fail. `npx astro build` clean (27 pages).
- **Core browser flow — on the deployed preview against REAL Cloudflare KV**: catalogue seeded (7 gifts) → redeemed Sticker as `R2L-PILOT-CYJS` (1.000 → 0 💎) → founder rejected it in the live admin queue → **all 1.000 💎 refunded**, gift returned to the shop. The redemption ledger also survived a real load→mutate→save cycle — the exact bug that would otherwise have destroyed the refund path.
- **Mobile/desktop/console**: 390px and 1280px on the live deploy, zero console errors.
- **Privacy and cost**: `cost_vnd`/₫ never reaches a kid or parent surface (stripped by `publicGift`, regression-tested). No new paid API calls. R2 storage is a handful of ~200KB gift photos on the existing bucket. Diamonds verified isolated from progression: a live redemption left `coins`, `total_xp`, rank and `completed_packs` byte-identical.
- **Proof**: `_ops/gifts-{hieuenzo,nearmiss,states}-{390,1280}.png`, `gifts-LIVE-390.png`, `gifts-manager-*.png`, `gifts-queue-focus.png`, `ho-so-parent-view.png`.
- **Independent review**: Buffet returned REQUEST CHANGES once (an inactive or cap-exhausted gift still told a child *"chỉ còn 500 💎 nữa thôi! 🔥"* about something no diamonds could ever unlock), then **SHIP** after the fixes.

## Notes

- **Rollback safety**: KV writes are additive-only (`config:gifts:v1`, `admin:gift-redemptions:v1`, plus `gift_goal`/`redemptions` on progress records). A revert leaves those keys orphaned but harmless; no existing key is overwritten or migrated.
- **Known residual (accepted)**: Cloudflare KV has no cross-key transactions, so a crash inside `restoreCap`'s two-write window can leave a gift's budget cap over-counted. Deliberately ordered to fail *closed* — the slot stays counted as used and the founder raises the limit himself — rather than fail open and silently commit him to buying more than he budgeted. Touches budget bookkeeping only; never diamonds, never kid-facing state. Buffet reproduced it and accepted it.
- **Not shipped, blocked on a concurrent session**: the site-header gift link (`src/components/Header.astro`) and the admin nav tab (`src/layouts/AdminLayout.astro`) — the logo-rebrand session owns those files. Entry points exist meanwhile: the ho-so kid nav, the R2L home action card, and the `/admin` index card. Add both once logo-rebrand merges.
- **Founder action (optional)**: `R2L_MEDIA` must be bound in the **Production** Cloudflare environment for gift photo *upload* to work. Pasting an image URL — the path the founder actually uses, since he does not own the gifts and cannot photograph them — needs no binding.
- **Economy on day one**: the diamond payout is unchanged (300–1.000 by hand per class), so the milk tea is ~2–3 months away and the football most of a year. The 1.000💎 sticker is reachable by 6 of 14 children immediately, and TuAnh (990💎) is **10 💎 short** — the single most motivating moment available anywhere in this product.

## Production smoke test (2026-07-13, post-merge)

- Deploy verified FULLY propagated via `_ops/scripts/wait-for-deploy.sh` — the marker went live BEFORE the `/_astro` stylesheets did, exactly the half-deploy trap the script exists to catch.
- `https://felixbuilderhub.com/read2lead/gifts` renders all 7 gifts, correct prices, correct bands, **zero console errors** at 390px.
- Catalogue seeded correctly on first production read.
- `cost_vnd` confirmed absent from the production kid-facing API response.
- R2L-PILOT-CYJS shows 1.000 💎 (the refunded diamonds), the Sticker affordable, his goal pinned, and his rejected redemption still in the ledger — i.e. the live-KV refund survived the merge.
- Both nav entry points now live: the child's header (`🎁 Quà thật`, code carried onto the link) and the admin nav tab.
