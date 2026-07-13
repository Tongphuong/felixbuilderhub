# Control — Read2Lead

- Product: Read2Lead
- Current goal: SHIPPED 2026-07-13 — Real-life gift shop — kids exchange 💎 diamonds for physical gifts (milk tea, Lego, books, football), with photos, a founder-editable catalogue (no deploy needed to add a gift), a teacher approval + handover queue, and a chosen-gift goal surfaced across the reading app to pull kids into class + SpeakUp. Fixes founder-reported "the shop is not cared about by students — they are not excited by the monster things".
- Latest staging URL: PRODUCTION — https://felixbuilderhub.com/read2lead/gifts (merged 2026-07-13, 7ff8816)
- Active workers: 0
- Last updated: 2026-07-13 (R2L-REAL-GIFTS SHIPPED)

## Operating team

| Agent | Role | Current authority |
|---|---|---|
| Claude | Lead + Reviewer | Plans, dispatches, reviews, and integrates |
| Aider Senior (DeepSeek V4 Pro) | Senior worker | Features, multi-file changes, complex logic via `aider-senior` |
| Aider Junior (DeepSeek V4 Flash) | Junior worker | Renames, simple edits, tests via `aider-junior` |
| Claude Sonnet (background worker) | Coding worker | General first-choice dispatch option alongside Aider — own isolated worktree/branch (`claude-bg/<topic>`), commits/pushes its own branch only. See `~/.claude/rules/claude-bg-dispatch.md`. |
| Lonewolf | Read-only bridge | Explains progress, decisions, learning, budget, and blockers |

Decision path: `Phuong -> Claude -> Aider/Claude Sonnet -> Claude review -> Phuong approval`.
Codex and Cline are retired org-wide (see `_ops/AGENTS.md`) — this table was
stale until 2026-07-05.

## Current task

- Status: active
- Started: 2026-07-13
- Completed: (in progress) — code complete, 1577/1577, Buffet reviewed. Awaiting Phương's GO to merge + the production reindex.
- Verified commit: (pending merge)
- Task ID: R2L-LINK-REVIVE + R2L-READING-LOAD
- Owner: Elon (both packets — tightly-coupled single code paths; Buffet reviews both, the author is never the final reviewer)
- Lane: product (two bugs, one P0, found from a single parent complaint)
- Problem: a parent reported "can't open link"; the link Felix opened on his laptop worked. They were NOT the same link — the parent's token was `link_exhausted` (HTTP 410, confirmed on production). ROOT CAUSE 1: `/r2l/start` is the child's HOME PAGE, and `r2l-link.js` spent one "use" of a counter on EVERY page view. Links minted before 2026-07-13 had only 50 uses (the bump to 5000 landed the same day and applies only to NEWLY minted links), so every pre-existing link is a ticking bomb; this parent's simply went off first. Checking the same student's reading history surfaced ROOT CAUSE 2, unrelated and worse: an L0 (beginner) child had been served an L4 book ("Never too late to accept your mistakes" — 5 pages but 206 words, 41 words/page). R2L-PAGE-BANDS (df9c5e4) shelves books by PAGE COUNT, which is blind to text density, so short-but-dense books land on the beginner shelf. Measured over the real 394-book corpus: **the L0 shelf holds 86 books of which only 6 are genuinely L0 text, and 30 are L4** — a beginner had a ~94% chance of drawing a book above their level. Systemic since 2026-07-12, not a fluke. NOT a regression either: SPEC_R2L_PAGE_BANDS.md line 20 logged this exact follow-up in advance — "page count != text difficulty; a words-per-page guard inside bands is the logged follow-up if pilot feedback demands it." This is that pilot feedback.
- Approach: (A) LINK — stop metering page views entirely (Phương's decision). The token is 128 bits of unguessable random; the counter never protected anything, it only ever locked the real child out. Expiry + admin revoke remain the security controls. `validateLinkRecord` no longer returns `link_exhausted` — and because dead records still sit in KV at `uses_remaining: 0`, that one line REVIVES every already-dead link on next open, with no data migration and no re-sending of links. Plus sliding expiry (an actively-used link never ages out) and write-at-most-once-per-day (the old code wrote to KV on every single request). (B) BOOKS — shelve by READING LOAD instead of page count: total words (cuts [116,202,332,531], quintiles of the corpus) plus a words-per-page ceiling that PROMOTES a short-but-dense book up a shelf. Books only ever move up, so no shelf loses stock. The selector now re-grades the book it drew and rejects+redraws anything harder than its shelf (the old `book_band_mismatch` alarm compared page count against a band derived from page count — tautological, and warn-only). The served pack now reports the shelf the child drew from, not the book's StoryWeaver tag — that tag is exactly what showed the parent "Cấp 4".
- Acceptance criteria: the parent's ORIGINAL link (`t=0a53b677…`) opens again with no new link sent; no link can die of use; expired/revoked links still refused; the beginner shelf contains ZERO L4-level books; a child is NEVER stranded with an error by a stale shelf; `node --test` green; verified on production.
- Files owned: `functions/api/r2l-link.js`, `functions/api/admin/codes/[code]/links.js`, `functions/api/publish-read2lead-book.js`, `functions/api/generate-read2lead-pack.js`, `scripts/reindex-books-by-pages.mjs`, `tests/r2l-magic-link.test.mjs` (NEW), `tests/read2lead-book-{publish,assignment}.test.mjs`, this CONTROL.md — all Elon.
- Non-goals: the access CODE's own `uses_remaining` (the lesson-pack quota) is a DIFFERENT and legitimate counter — untouched. Not backfilling `review_history` rows already stamped with a StoryWeaver level, so this child's PAST history still shows "Cấp 4" (they did read that book); only new entries report the child's lane. Not re-tuning the band cuts beyond adding the density guard.
- Stop condition: acceptance criteria pass on production + Buffet SHIP + founder gates PASS. Merge on Phương's explicit GO.
- Cost ceiling: Claude team (Max plan, not metered).
- Reuse survey: (1) the EXISTING secret-gated `reindex_only` action in `publish-read2lead-book.js` plus `scripts/reindex-books-by-pages.mjs` (dry-run, backup, `--restore` rollback, disjoint/union integrity checks) — ADOPTED wholesale for re-shelving; a new migration endpoint or script was REJECTED, the existing one already does all of it and imports the band function as a single source of truth. (2) that band function stays the ONE place the thresholds live, now shared by three callers (publish, selector guard, reindex) so the table cannot drift. (3) the selector's existing `softFallback` "never strand the child" pattern — ADOPTED and extended as the `mishelved` fallback instead of inventing a new error path. (4) `validateLinkRecord`, already exported and unit-testable — ADOPTED as the single place to drop the exhaustion rule, which is why ONE line revives every dead link. (5) a KV migration to reset `uses_remaining` on every link — REJECTED: ignoring the field achieves the same revival with zero writes and zero risk. (6) TEST TOOLING for the two new test files: Node's BUILT-IN `node:test` runner — ADOPTED (already this repo's runner, zero new dependency); adding an external framework (vitest / jest / ava) — REJECTED, it would pull a dependency tree into a Cloudflare Workers repo to gain nothing these tests need. (7) an external HTTP-mocking library (nock / msw) to fake KV and the Request/Response cycle — REJECTED: the endpoints take a real `Request` and a KV-shaped object, and the repo's OWN in-memory KV double plus `tests/helpers/book-pack-fixture.mjs` (`makeStoredBookPack`, `makeBookReaderState`) already drive the REAL production handlers end-to-end, which is strictly stronger than mocking the transport — ADOPTED.
- State inventory: LINK — resolves / expired / revoked / malformed token / rate-limited; the `exhausted` state is DELETED (it can no longer occur), which is the point, and reviving a record sitting at zero is the acceptance test. BOOK SELECTION — in-band healthy (normal); cosmetically-flawed in-band (`softFallback`); mis-shelved harder than the shelf (rejected + redrawn); and EVERY healthy book on the shelf grading too hard (`book_shelf_stale` → serve the gentlest rather than error). That last state is the dangerous one, and it is the state production is in TODAY: the guard would reject 77% of the current L0 shelf before the reindex runs, so without the fallback roughly 1 in 10 beginners would have got an ERROR instead of a lesson.
- Operational reality: parents open these links from Zalo, on phones, daily, for months. A magic link here is not a one-shot credential — it is the child's front door. Any counter that ticks down on a front door eventually locks the family out, and the only recovery was Felix hand-issuing a new URL over Zalo, one parent at a time.
- Design self-verification: (pending production smoke)
- Review history: PART 1 — Buffet APPROVED with no defects: independently verified the access-code quota is untouched, the TTL is always re-asserted (a `put` without one strips expiry and leaks keys forever), no write-storm, nothing else consumed the removed field, no security regression. He also caught me in a FALSE CLAIM: I reported "1572/1572 green" while a half-finished Part 2 rename was breaking the suite in the same tree — the gate was RED at the moment I called it green. **PART 2 — Buffet returned NEEDS CHANGES with TWO BLOCKERS, both real, both proven by running the real endpoints rather than reading the code, and both in MY work.** (1) The reading-load guard ran only inside `if (health.ok)`, so a book that was too dense AND had any cosmetic blemish (one doubled word) skipped the grading entirely, was kept as the cosmetic `softFallback` — which is served ahead of everything below it — and reached the child. The exact class of book the whole fix exists to stop could still be served, through a hole in the guard built to stop it. He demonstrated a 210-word wall of text going to an L1 child. (2) The level fix DID NOT REACH THE PARENT: `submit-read2lead-lesson.js:484` re-derives the level from `review_context` (the raw book record, carrying the StoryWeaver tag), so `review_history` still recorded "Cấp 4" — my own code comment claimed it fixed the parent's list, and it did not. FIXED: the re-grade now runs before any health branching (only an in-band book can become `softFallback`); the submit precedence is flipped so the pack's level — the child's lane — wins. Both fixes carry a test that FAILS without them (the level test reproduces the parent's screenshot exactly: `actual: 'L4', expected: 'L0'`). Buffet re-verified with fresh independent repros and gave SHIP. ELON'S OWN MISS, caught by his own test run: the first `denseBook` fixture used non-numeric slugs (`book_dense`), which `selectUnreadBook`'s `/^book_[0-9]+$/` filter silently drops — the test failed for a reason unrelated to the code under test. A fixture that cannot even be selected proves nothing. LESSON: both blockers were invisible to 1577 passing tests, and both were found by DRIVING THE REAL ENDPOINT with the awkward input (dense AND flawed; follow the value to the screen the parent actually reads) rather than by reading the diff.
- Cost spent: USD 0

## Previous task — R2L-GIFTS-FIX

- Status: complete
- Started: 2026-07-13
- Completed: 2026-07-13 — SHIPPED TO PRODUCTION (merge 1ed2645, Phương "go and merge"). Production smoke PASS on felixbuilderhub.com with a real child's code: all 8 photos render at their true size (not the Shopee overlay), every photo URL versioned, emoji correctly hidden behind photos and shown for Gundam, ZERO free gifts, cost_vnd absent from the kid API, 2 columns at 390px, smallest button 44px, 0 console errors.
- Verified commit: 1ed2645 (origin/main)
- Task ID: R2L-GIFTS-FIX
- Owner: Steve (bg worker) — UI: `src/lib/admin-gifts.ts`, `src/pages/admin/gifts.astro`, `src/lib/gift-ux.ts`, `src/styles/qua-that.css` + their tests. Elon — `functions/api/_gifts-v2.js` + `tests/read2lead-gifts.test.mjs` (two-line security fix, file set disjoint from Steve's; Buffet is its reviewer, not Elon). Buffet reviews the combined diff.
- Lane: product (gift shop follow-up — admin CRUD gap + one live security hole + one rendering bug)
- Problem: founder reported two things a day after ship — "I uploaded the photo and the link but not shown in the real shop" and "I can't delete gift in the admin either". Investigating on PRODUCTION (not by reading code) turned up FOUR facts, three of them different from the report. (1) The photo pipeline is fine: `/api/read2lead-gift-image?id=sticker` returns 200/image/png/94.362 bytes; `R2L_MEDIA` IS bound in production. The uploaded FILE is wrong — a 1200×1200 almost-entirely-transparent Shopee CAMPAIGN OVERLAY whose only opaque pixels are a "15.7 VOUCHER XTRA" badge. Right-clicking a Shopee listing saves the overlay layer, not the product. The same file (identical md5) is on both Sticker and Bút. (2) The `image_url` he pasted is a Shopee PRODUCT PAGE (`shopee.vn/…-i.1253087927.…`), an HTML page — an `<img src>` can never render it; the field accepts anything with no validation. (3) REAL BUG: `renderPhotoWell()` always stacks the emoji AND the `<img>`, so with a transparent PNG the child sees both — the emoji is supposed to be a FALLBACK. (4) REAL BUG, and the urgent one: a junk row "Quà 8" (`gift-mrj3tnzu-g47dkw`, `price_diamonds: 0`, `active: true`) is LIVE and FREE — `can_afford` is `diamonds >= price` and every balance clears 0 — so any child can claim it and each claim queues a real object Coach Felix is expected to go out and buy. He cannot remove it because the gift manager has no delete button at all.
- Approach: (A) per-row delete + "Xoá ảnh" in the gift manager — no new endpoint, `POST /api/admin/gifts` already replaces the whole array and `collectAll()` already rebuilds it. (B) `isGiftAvailable()` refuses any gift priced ≤ 0, and `progress_percent` reports 0 rather than a full green bar; the admin additionally refuses to SAVE a price-0 active gift. Belt and braces: the engine check is load-bearing because it holds for rows already sitting in KV. (C) the emoji becomes a true fallback — `onload` on the `<img>` adds `.qt-photo-well--has-img`, CSS hides the emoji; same for the admin thumb, so the ADMIN PREVIEW would have shown Coach Felix his broken transparent PNG instead of a friendly star. (D) the image-URL field validates and teaches: reject a product-page URL, tell him to right-click the image → "Sao chép địa chỉ hình ảnh".
- Acceptance criteria: Coach Felix can delete a gift, unaided, in under a minute, and clear a wrong photo; no child can ever redeem a gift priced 0, even one already in KV; a gift with a photo shows the photo and NOT the emoji, while a gift whose photo fails to load still shows the emoji; pasting a Shopee product-page link is refused with a hint that says what to do instead; deleting a gift leaves in-flight redemptions renderable and refundable; `node --test` green; `npx astro check` clean; verified on production in a real browser.
- Files owned: as per Owner above, plus `.founder-os/products/read2lead/CONTROL.md` — Elon.
- Non-goals: no change to diamond earning, the redemption lifecycle, refunds, the budget cap, or any kid-facing copy beyond the photo well. Not fixing the last-write-wins race in `POST /api/admin/gifts` (pre-existing for every edit in this manager, not introduced by delete) — flagged, deferred.
- Stop condition: acceptance criteria pass on production + Buffet SHIP + founder gates PASS. Merge to main only on Phương's explicit GO.
- Cost ceiling: Claude team (Max plan, not metered).
- Reuse survey: (1) `POST /api/admin/gifts` (full-array replace) + the existing `collectAll()` row collector — ADOPTED for delete; a new `DELETE /api/admin/gifts/:id` endpoint was REJECTED, it would add a second write path to the same KV key for no benefit. (2) the existing `fx-btn`/`fx-btn--ghost` primitives — ADOPTED for the delete button; hand-rolled button styling REJECTED per the design system. (3) the delegated click handler already serving `toggle-active`/`toggle-photo` — ADOPTED for `delete-gift`. (4) `isGiftAvailable()` as the single availability rule already reused by the goal endpoint — ADOPTED as the one place to put the price check, so the fix covers redeem, view AND goal-setting at once. (5) a schema migration to purge price-0 rows from KV — REJECTED: the engine check makes them inert without touching a live key, and the founder can now simply delete them.
- State inventory: the shop's nine states are unchanged; this task moves a gift BETWEEN them (a price-0 gift now lands in `unavailable` instead of `affordable`) and adds two admin-side states — gift row with a photo (emoji hidden) and gift row whose photo 404s (emoji restored). Both must be rendered and looked at, plus the `unavailable` band, which gains a new member.
- Operational reality: unchanged — Coach Felix still holds zero inventory and buys on demand. What changed is that he is a NON-TECHNICAL founder editing a live catalogue with no undo: "+ Thêm quà" created a row he could not remove, and that row was free to every child. Any admin surface he operates must let him undo what it lets him do.
- Design self-verification: PASS on the deployed preview against REAL production data (claude-r2l-gifts-fix.felixbuilderhub.pages.dev, R2L-PILOT-CYJS). The free gift now reports `can_afford: false`, `available: false`, `progress_percent: 0` and is banded under "Tạm thời chưa mở" instead of "Đổi được rồi!"; `cost_vnd` absent from the kid API; 0 console errors; screenshots `_ops/giftsfix-preview-390.png` and `_ops/giftsfix-preview-1280.png`. Admin flows driven end-to-end on a LOCAL wrangler instance seeded with the real catalogue (never the preview — previews write to PRODUCTION KV): delete persists to KV, blank row refused, Shopee page-link warned, "Xoá ảnh" clears a photo, mid-save mutations refused. Screenshots `_ops/gifts-admin-delete-1280.png`, `_ops/gifts-admin-photo-panel.png`.
- Review history: NINE defects on this feature now, and every one passed the test suite first. This round added: (a) the Save button read "✓ Đã lưu" in every state, so a deleted gift looked saved and was not — Coach Felix would have closed the tab with the free gift still live (Elon, reviewing Steve); (b) saveAll() snapshots the DOM before awaiting and render() repaints from the server's answer to that OLD snapshot, so a delete made during an in-flight save was RESURRECTED under a button reading "Saved" (Buffet, HIGH — the exact harm the task exists to prevent, reintroduced by the fix for it); (c) the goal card recomputed its own bar and showed a FULL GOLD BAR above "tạm thời chưa đổi được" on the child's profile, the lesson card and the parent report (Buffet, MEDIUM); (d) delete freed gift ids for reuse, so re-adding a same-named gift would capture an in-flight redemption (Buffet); (e) the "Đặt làm mục tiêu ★" button on an unavailable gift is a DEAD CLICK — the server answers 400 gift_unavailable (Elon, from a screenshot of the deployed preview). **7 of the 9 were found only by rendering a real screen with real data, or by reasoning about interleavings.**
- The test was encoding the bug: defect (e)'s guard test asserted the dead button's PRESENCE and was green throughout — it greps gift-ux.ts's source text, so it could not tell code from prose, and when the code was fixed it matched the COMMENT explaining the button's removal. Replaced with tests that render the card. Buffet then found two more grep-only tests guarding the escape hatch a stuck child depends on, plus `blocked` (untested entirely); all now rendered. A test that cannot see what a child is offered cannot defend it.
- Verified commit: aa4a55d (origin/claude/r2l-gifts-fix) — NOT merged, awaiting founder GO
- Founder handoff: pending — Phương to walk the preview and give the merge GO.
- Cost spent: USD 0

## Live-data work done on the founder's behalf (2026-07-13, explicit permission: "Full permission for photo")

**How.** His admin password (`130798`) is the **preview** environment's `ADMIN_PASSWORD`, not production's — and Cloudflare Pages previews **share the production database**. So the preview admin API reads and writes his real catalogue and real R2 bucket. This is how the work below was done, and it is also a **security hole**: a guessable preview URL plus a short password is a back door into live data and his private `cost_vnd` figures. Reported to him; his decision.

1. **The free gift is dead.** He said "quà 8 has been deleted". It was NOT — I read the live catalogue back and found `gift-mrj3tnzu-g47dkw`, price 0, active, still claimable by every child. He had tried to delete it in the PRODUCTION admin, which has no delete button — the very bug this branch fixes. Removed via a read-modify-write of the live array; re-read confirms **no gift with `price_diamonds <= 0` remains**.
2. **Two gifts added, as requested:** Quả bóng rổ 🏀 30.000💎 and Mô hình Gundam 🤖 100.000💎. Both got random server-assigned ids (`gift-mrj9rdh6-…`) — the name-derived id path was removed this session on Buffet's collision finding, and this is the first live proof it works.
3. **Eight photos sourced, processed and uploaded** (CC0/public-domain only — no attribution line may ever appear on a child's screen). All eight serve 200 with the right content type. **Gundam has NO photo and keeps its 🤖 emoji: every CC0 result for "gundam"/"gunpla" was a blue 3D-printed barrel**, because the kits are trademarked. A clean emoji beats a bad photo — pretending otherwise is exactly how the voucher badge shipped.

**Two of my own defects, both caught only by rendering the images on the navy card:**
- The first set was square, so every photo sat in the 4:3 well like a **postage stamp**. Photos are now cropped to 4:3 (the well's own aspect) and fill it; cut-outs stay square and float.
- My white-background remover **ate the pens**: they are pastel, so the flood fill treated the subject as backdrop and left a ghost. That photo is now a plain tile.

An earlier attempt at this was thrown away entirely — it had produced WordPress-conference stickers and a football with a transparency checkerboard baked into it, and would have looked *worse* than the emoji it replaced. It was only visible by looking.

## Previous task — R2L-REAL-GIFTS

- Status: complete
- Started: 2026-07-13
- Completed: 2026-07-13
- Task ID: R2L-HOME-DOI-QUA
- Owner: Claude Lead (Elon) — start.astro + r2l-start.client.ts + tests; Buffet reviews.
- Lane: product (student home; zero backend change)
- Problem: the real-gift shop ("Quà thật") shipped to production today, but the student home — which shipped this morning to Claude Design's design — knows nothing about it. Founder's product ranking, verbatim: **"Kids care more about the real shop. No kid ever talked about the monster shop. But they are all excited about this gift shop."** So the home currently gives a prime tile to a shop children ignore (🛒 Cửa hàng, the coin/monster shop) and no slot at all to the thing that motivates them.
- CORRECTION THAT SHAPED THE DESIGN: Elon first told Phương the gift card should sit under Đọc tiếp because "she reads → she gets closer to the prize". **That was wrong.** Reading earns 🪙 coins; real gifts cost 💎 diamonds, and diamonds are a **coaching-only currency granted by hand by the teacher** (`admin/_classes.js:213` `applyManualReward`, whose own comment says diamonds "do NOT affect XP, level progression, or rank points"). Neither reading nor SpeakUp grants one — Ong has 1400 coins and 0 diamonds. Placing the card under Đọc tiếp would have implied reading fills the diamond bar; the child would read a whole book, see the bar unmoved, and learn that reading is pointless. The gift shop's OWN handoff warns of exactly this ("never make the reading feel worthless; diamonds come from class, gently"). Founder was told, and re-decided.
- Approach: host Claude Design's OWN `renderGiftGoalCard()` (`src/lib/gift-goal-card.ts`, the shared "what I'm saving for" widget already used on the lesson-end screen, the kid profile and the parent report) in the home's actions column, **below SpeakUp** — deliberately NOT under Đọc tiếp — using the `wide` variant. Demote the 🛒 Cửa hàng tile; the row becomes two wider tiles (Hồ sơ, Xếp hạng).
- Founder decisions (2026-07-13): (a) card below SpeakUp, not under Đọc tiếp, with the honest "kim cương đến từ lớp học" note the card already carries; (b) monster shop demoted off the home — verified safe, Hồ sơ still links to it (`ho-so-kid-view.ts:536`), so nothing is stranded; (c) two wider tiles, not a filler third; (d) NO Claude Design round trip needed — we are placing THEIR component, so "looks exactly as Claude Design" holds by construction; screenshots to Phương before merge; (e) the fact that reading now pays only in a currency kids ignore is a real motivation hole — acknowledged, explicitly OUT OF SCOPE for this task.
- Acceptance criteria: (1) home renders the gift-goal card below SpeakUp in all its states — no goal (invitation), saving (photo + name + `x/y 💎` + bar), affordable, and card-absent when the gifts call fails; (2) 🛒 Cửa hàng tile is gone and the tile row is two wide tiles; (3) with the gift call failing, the rest of the home is unchanged and still fully usable — no dead screen; (4) the card is Claude Design's component, not a lookalike: `renderGiftGoalCard` imported, zero re-implementation of gift state rules; (5) full suite green; astro build clean; (6) verified on the deployed preview with a real student magic link.
- Files owned: src/pages/r2l/start.astro, src/scripts/r2l-start.client.ts, tests/r2l-start-hub.test.mjs, CONTROL.md.
- Non-goals: no backend change; no change to how diamonds are earned; no change to the gift shop itself; the monster shop keeps working and stays linked from Hồ sơ.
- Stop condition: Phương approves the screenshots + Buffet SHIP + gates PASS + merge GO.
- Cost ceiling: Claude team (Max plan, not metered). No new API surface; one extra call only when a child actually has a goal set.
- Reuse survey (rule 21): (1) `renderGiftGoalCard()` + `GiftGoalItem`/`GiftGoalRedemption` (`src/lib/gift-goal-card.ts`) — ADOPTED wholesale. It was built precisely to be hosted outside the shop, its own comment says the state rules must have ONE definition so "the child would not be told two different things on two different screens", and it imports the shop's own `deriveGiftCardState`. Writing a home-specific gift card would be the exact drift it was designed to prevent. (2) The profile's integration (`ho-so-kid-view.ts:527-550` `loadGiftGoalCard`) — ADOPTED as the pattern: read `gift_goal`/`diamonds`/`redemptions` from the progress payload the home ALREADY fetches, and resolve the goal id via `POST /api/read2lead-gifts-list` only when a goal exists. Best-effort and non-blocking, exactly as ho-so does it. (3) A new home-only gift component or a new backend field (`gift_goal_detail`) — REJECTED: the component exists and the second call is already the established pattern; a new field would be a second source of truth for zero gain. (4) Existing `.r2l-tile`/token styles for the demoted row — ADOPTED.
- State inventory: every state the home's gift slot can be in, each to be seen with eyes, not just asserted — (1) **no goal chosen** → the card's invitation ("chọn món quà con muốn"); this is the DEFAULT for every existing student today, not an edge case; (2) **goal set, saving** → photo/emoji + name + `x/y 💎` + progress bar (Ong today would be 0/20.000 = 0%); (3) **goal set, affordable** (`can_afford`) → the celebratory state; (4) **goal set on a gift that has since been disabled/removed from the catalog** → the id resolves to nothing; must fall back to the invitation, never a blank or broken card; (5) **a redemption already in flight for that gift** (requested / preparing / delivered / rejected) → the card's own redemption states, driven by the shop's `deriveGiftCardState`; (6) **the gifts call fails, 500s, or the gift feature is unconfigured** → NO card at all, and the rest of the home is untouched and fully usable; (7) **reduced motion** → the card ships motion-off by design; confirm nothing we add reintroduces it.
- Operational reality: 💎 diamonds are handed out BY COACH FELIX BY HAND after a live class (300–1.000 per session, `admin/_classes.js` `applyManualReward`) — there is no automatic path, and neither reading nor SpeakUp grants any. Consequences we must design for, not paper over: (a) at launch essentially every child has **0 diamonds and no goal**, so the empty/invitation state is the NORMAL state, the one Phương will actually see on most kids' screens — it has to look deliberate and inviting, not broken; (b) a child's bar only moves when they attend class, so the card must say where diamonds come from (it already carries "Kim cương đến từ lớp học và SpeakUp!") — otherwise a child reads all week, sees no movement, and concludes reading is worthless; (c) this is precisely why the card is NOT placed under Đọc tiếp. Gift photos are optional (an emoji is the fallback), so the card must not assume an image exists.
- Design self-verification: PASS — seen with eyes on the deployed preview AND on production with a real student magic link. Ong (no goal, 0 diamonds) gets the card's invitation ("Con chưa chọn quà để dành dụm — chọn ngay một món quà con thích nhé!" + Chọn quà ngay 🎁 → /read2lead/gifts?code=…). The saving state was driven with the REAL compiled component (esbuild of gift-goal-card.ts) at 390 and 1280: photo well + "CON ĐANG ĐỂ DÀNH CHO — Bộ Lego" + gold bar + "8.400/20.000 💎" + the honest "Kim cương đến từ lớp học" note. Monster shop gone (0 occurrences of "Cửa hàng"); tile row is two wide tiles. Screenshots: _ops/doiqua-PROD-390.png, doiqua-narrow-390.png, doiqua-desktop.png, doiqua-390.png.
- FIDELITY BUG THE TESTS COULDN'T SEE (3de2025): the first cut forced the card's `wide` variant everywhere. On a 390px phone that shrank the prize to a thumbnail and squeezed the progress bar — and the prize is the entire point of the feature. Claude Design had shipped a `narrow` variant (stacked, big 16:9 photo) precisely for phones. Now `matchMedia('(min-width: 768px)')` picks wide on desktop, narrow on phones. Every test was green both before and after; only looking at it caught this. Same lesson as the monster-medal bug on R2L-HOME-HUB.
- OPEN BUG FOUND, NOT INTRODUCED HERE (handed to founder): the Sticker gift's `image_url` in the LIVE catalogue is a **Shopee product-page link, not an image**. `gift-ux.ts:156-157` falls back to `image_url` as an `<img src>` when there is no uploaded `image_key`, so any child who picks Sticker as their goal sees a BROKEN IMAGE — on the home, and on the profile / lesson-end / parent screens, which already shipped. The shop page itself hides it (it paints photos as a CSS background, which fails silently), which is why nobody noticed. Two fixes offered: (a) founder replaces the photo in admin with a real image URL or an upload — one minute, zero code; (b) a code guard so a bad photo falls back to the gift's emoji — proposed as a follow-up, deliberately NOT slipped into this diff unreviewed.
- Verified commit: 4c780ec (origin/main) — the exact commit self-verified live on felixbuilderhub.com, not on a preview.
- Founder handoff: DONE — Phương gave the merge GO. Merged to main (4c780ec) and LIVE ON PRODUCTION, verified on felixbuilderhub.com with a real magic link: greeting "Chào Ong! 👋", the Đổi quà card below SpeakUp, Cửa hàng gone, tiles = [Hồ sơ, Xếp hạng], her real book and pet intact. Only console error is Sentry rate-limiting (429), unrelated. The greeting fix (Chào con Ong! → Chào Ong!, every student) shipped in the same merge at Phương's instruction.

## Previous task — R2L-REAL-GIFTS

- Status: complete
- Started: 2026-07-13
- Completed: 2026-07-13 — SHIPPED TO PRODUCTION (merge 7ff8816, Phương GO). Production smoke PASS: all 7 gifts live at felixbuilderhub.com/read2lead/gifts, zero console errors, catalogue seeded, cost_vnd absent from the kid API. Refund proven on live Cloudflare KV BEFORE merge (Pilot spent 1.000💎 → founder rejected → all 1.000 back).
- Verified commit: 7ff8816 (origin/main)
- Task ID: R2L-REAL-GIFTS
- Owner: Mark (bg worker) — backend: `functions/api/admin/_gifts.js`, `functions/api/_gifts-v2.js`, `functions/api/admin/gifts.js`, `functions/api/admin/gifts/upload.js`, `functions/api/admin/gifts/redemptions*.js`, `functions/api/read2lead-gifts-*.js`, `functions/api/read2lead-gift-image.js`, `clampDelta` fix in `functions/api/admin/_classes.js` + their tests. Steve (bg worker) — UI: `src/pages/admin/gifts.astro`, `src/pages/read2lead/gifts.astro`, `src/lib/gift-ux.ts`, `src/lib/gift-goal-card.ts`, marketing surfaces. Buffet reviews the combined diff. Elon plans, reviews line by line, integrates, commits.
- Lane: product (new kid-facing gift shop + admin catalogue/queue; coin economy, monster shop, XP, rank and leaderboard semantics all UNCHANGED)
- Problem: founder-reported — kids are not excited by the monster shop, so the reward loop does not motivate reading. Production data 2026-07-13 confirms the shop is not a driver: top reader Pilot has 60 lessons and 4,000 coins but 0 diamonds; the top diamond holder (4,295) has read 0 lessons.
- Approach: a SECOND shop ("Quà thật") priced in 💎 diamonds (coins stay monster-only, per founder). Catalogue lives in KV `config:gifts:v1`, fully editable from a new `/admin/gifts` page with PHOTO UPLOAD (reuses the existing `R2L_MEDIA` R2 bucket + `portfolio/upload.js` pattern) so the founder adds gifts with no deploy. Kid redeems → 💎 deducted → append-only `redemptions[]` ledger → request lands in an admin queue → founder marks delivered, or rejects with AUTOMATIC refund of diamonds and stock. Marketing hangs off a kid-chosen `gift_goal` with a progress bar on the lesson-completion card, kid profile, parent report, R2L home, header and leaderboard.
- Founder decisions (2026-07-13): coins = monsters, diamonds = gifts only. Catalogue is a deliberate LADDER of 7: sticker 1,000💎 · bút 5,000💎 · hộp bút 7,000💎 · trà sữa 10,000💎 · Lego 20,000💎 · sách 20,000💎 · bóng đá 30,000💎. (Founder added the three cheap rungs after Elon showed that with a 10,000💎 floor NO child could afford anything for months — the sticker makes 6 of 14 kids able to buy on day one, and puts TuAnh 10💎 away from her first gift.) Diamond payout left as-is (300–1000 awarded manually per class). Reading pays no diamonds, so the in-lesson advert funnels kids toward class + SpeakUp. Gifts need PHOTOS — sourced from online product images (Shopee/Lazada), since the founder does not own the items. FULFILMENT IS BUY-ON-DEMAND: he holds zero inventory and buys each gift only after a child redeems it — so the lifecycle is `requested → preparing (he is out buying it) → delivered`, with `rejected` (auto-refund) as a branch; and `stock` is NOT inventory but an optional per-gift budget cap (blank = unlimited, the normal case). No inventory/"hết hàng" language may ever reach a child.
- Acceptance criteria: founder can add a fifth gift with a photo, unaided, in under a minute; kid can redeem and the diamonds drop; the request appears in the admin queue; approving marks it delivered; REJECTING REFUNDS THE DIAMONDS AND RESTORES STOCK exactly; a kid can never overspend, double-redeem, or claim out-of-stock; redeeming leaves `rank_points`, `total_xp` and `coins` byte-identical; a 1,000💎 award lands as 1,000 not 500; `node --test` green; astro build clean; e2e verified in a real browser at 390px and 1280px.
- Files owned: as per Owner above, plus `.founder-os/products/read2lead/CONTROL.md`, `docs/ENV.md` (document the undocumented `R2L_MEDIA` binding) — Elon.
- Non-goals: NO change to coin earning, the monster shop, XP, level, rank points, or leaderboard ordering. NOT wiring SpeakUp to pay diamonds (it pays nothing today, is an unlaunched prototype, its practice-log endpoint has no replay protection, and its PRODUCT.md scopes gamification out of V0) — that is a separate founder decision. Not rebalancing the diamond payout rate (founder chose to keep it).
- Stop condition: acceptance criteria pass on a deployed preview + Buffet SHIP + founder gates PASS, then STOP — merge to main only on Phương's explicit GO.
- Cost ceiling: Claude team (Max plan, not metered). R2 photo storage is a handful of ~200KB images on the existing bucket, $0.
- Reuse survey: (1) `_read2lead-shop-v2.js` pure engine (buildShopView/executeBuy) — ADOPTED as the shape for `_gifts-v2.js` (catalog+view+execute as pure functions is the testable seam). (2) `R2L_MEDIA` R2 bucket + `admin/portfolio/upload.js` + `parent/video.js` — ADOPTED for gift photo upload/serving; no new storage, no new dependency. (3) `_classes.js` KV store module + the `admin/classes.astro` preset-editor rows — ADOPTED for the founder-editable catalogue. (4) Basic Auth on `/admin/*` via `functions/_middleware.js` — ADOPTED (new admin routes are protected for free). (5) `config/book-levels.js` auth shape — REJECTED for the endpoint (requires an `X-Read2Lead-Secret` header a browser cannot send); only its `config:<name>` KV key convention is reused. (6) Reusing the existing monster shop page/`unlocked_parts` set — REJECTED: a gift is consumable and needs an append-only ledger plus a fulfilment lifecycle the cosmetic shop has no analogue for. (7) A new image CDN / third-party upload widget — REJECTED: the R2 bucket already does this.
- State inventory: NINE kid-facing states, and the happy path exercises TWO — `saving` · `nearmiss` · `affordable` · `pending` · `preparing` · `delivered` · `unavailable` · empty catalogue · no-goal-chosen. Backfilled honestly: this field did not exist when the task started, and its absence is exactly why 5 of the 8 defects shipped to review. Enumerating it would have asked, on day one, "what if the child's chosen goal IS the near-miss?" (it always is — children pick what they are closest to) and "what happens to a delivered gift?" (it must return to the shop, or the shop shrinks with every present given). Both were found in round 3.
- Operational reality: Coach Felix holds ZERO inventory. He buys each physical gift only AFTER a child redeems it, then hands it over in class. Consequences the software must honour: a real-world delay (hence the `preparing` state — a child who spends four months of savings and then hears nothing concludes the app stole their diamonds); supply is unlimited, so no inventory language may ever reach a child; and `Giới hạn` is a BUDGET CAP protecting his cash flow, not a shelf count. Asked far too late — the first design proposed a physical gift shelf, twice, for gifts he does not own.
- Design self-verification: Phase 0 mocks (kid gift page, confirm/success modals, gift-goal card, admin manager + queue) approved by Phương before any UI is built, per the design-first rule.
- Build state (2026-07-13): CODE COMPLETE, Buffet SHIP. 1372/1372 `node --test`, `npx astro build` clean. All 7 Claude Design screens built (kid shop + confirm/success modals + goal card + parent view + admin gift manager + redemption queue). Screenshot-verified at 390px and 1280px.
- Review history (why this took 4 rounds): 8 defects were caught in review, and EVERY ONE passed the test suite first. (1) the "còn N 💎" figure was reconstructed from a rounded percent, telling a child 700 when the true answer was 705; (2) the near-miss state was unreachable in practice — a child's chosen goal is pulled out of the catalogue, and a child always chooses the gift they are closest to; (3) a delivered gift locked its card forever, so the shop shrank with every present given; (4) redeem CTAs stayed enabled while a request was pending, inviting a tap the server would refuse; (5) gifts in flight were banded under "Con có thể đổi ngay"; (6) `gift_goal`/`redemptions` were not on the `normalizeProgressState` whitelist, so finishing ONE reading lesson wiped a child's redemption ledger — taking the refund path with it (Elon, in review of Mark); (7) the admin queue could not tell a paid redemption from a phantom, so the founder could buy a real football for a child who never paid (Buffet); (8) an inactive or cap-exhausted gift still told a child "Chỉ còn 500 💎 nữa thôi! 🔥" about something no amount of diamonds could ever unlock (Buffet). 6 of the 8 were found by DRIVING THE RENDERED SCREEN or reasoning about crash interleavings — not by reading code and not by running tests.
- Deliberate design rulings: fail-safe ordering — the admin queue entry is written BEFORE the child's diamonds are debited (a queue row with no debit is recoverable; a debit with no queue row means a child paid for a gift the founder never learns to buy), and `restoreCap` stamps the ledger BEFORE decrementing the budget cap (fail-closed: an interrupted reject leaves the slot counted as used and the founder raises the limit himself, rather than silently committing him to buy more than he budgeted).
- Known residual (accepted, Buffet-reproduced): KV has no cross-key transactions, so a process crash inside the two-write `restoreCap` window can leave the budget cap over-counted. Fail-closed by construction; touches budget bookkeeping only, never diamonds, never kid-facing state. A fully airtight fix needs a Durable Object or a single-key redesign — out of scope, logged.
- Nav entry points: DONE. The logo-rebrand session merged before ship, so both deferred links landed in the same release — the child's header gift link (with their code carried onto it at runtime) and the `/admin/gifts` nav tab. The guard test that had pinned "AdminLayout must stay untouched" fired the moment the boundary was crossed, and was flipped to assert the tab now exists.
- Founder handoff: pending — preview walkthrough, then merge GO.

## Previous task — R2L-PAGE-BANDS

- Status: complete

## Previous task — R2L-HOME-HUB (and prior, merged from main)

- Status: complete
- Started: 2026-07-13
- Completed: 2026-07-13
- Task ID: R2L-HOME-HUB
- Owner: Claude Lead (Elon) — shared extraction, start.astro, r2l-start.client.ts, tests; Buffet reviews the diff (author ≠ reviewer).
- Lane: product (student-facing home page; zero backend change)
- Problem: `/r2l/start` is the child's daily front door but is still a topic-picker screen whose picker the server ignores. Attempt 1 (branch `claude/r2l-student-home`) was built, Buffet-reviewed and preview-verified — and Phương REJECTED THE VISUAL at the merge gate: "boring — not for a kid" and "missing the child's world" (no pet, coins, rank, current book, Minny). It never shipped.
- Approach: build Claude Design's redesign from `design_handoff_r2l_student_home/` (prose spec + 6 state screenshots + interactive mock + a production-shaped reference implementation). Two columns wrapping to one stack on a phone: LEFT = the child's world (real pet monster + rank medal + Hạng + level/streak/coins chips); RIGHT = a CONTEXTUAL primary CTA (gold "ĐỌC TIẾP" card with cover, book title and progress bar when a book is open; gold "BÀI ĐỌC MỚI" create card when not), then SpeakUp (Minny the red robot), then three tiles (Hồ sơ / Xếp hạng / Cửa hàng with her coin count). Data comes from ONE existing endpoint, `GET /api/read2lead-progress?code=` — the same one ho-so already uses. No backend work.
- FOUNDER'S GOAL, VERBATIM: "My only goal is the home looks exactly as claude design." Fidelity IS the acceptance criterion — verified by whole-screen comparison against the handoff screenshots at 390px and desktop, not by "it builds".
- Acceptance criteria: (1) the ready screen matches the design at 390 + desktop in BOTH variants (continue and create), rendering real data — pet, medal, rank, streak, coins, book title, progress; (2) the other five states match screenshots 02..06; (3) one tap creates a reading end-to-end, Đọc tiếp opens the open book, and SpeakUp/Hồ sơ/Xếp hạng/Cửa hàng all carry the access code; no topic picker anywhere; (4) `buildHeroCta`/`statusMeta` exist in exactly ONE place in the codebase; (5) ho-so is provably unbroken by the extraction; full suite green; astro build clean.
- Files owned: src/lib/r2l-hero.ts (NEW, shared), src/pages/ho-so/ho-so-kid-view.ts (imports the extracted helpers — no behaviour change), src/pages/r2l/start.astro, src/scripts/r2l-start.client.ts, tests/r2l-start-hub.test.mjs, CONTROL.md.
- Non-goals: no backend change; no new dependency; `src/pages/read2lead.astro` (legacy public typed-code page) keeps its own topic picker; no sixth button.
- Stop condition: fidelity verified against the handoff screenshots + full suite green + Buffet SHIP + founder gates PASS + Phương merge GO.
- Cost ceiling: Claude team (Max plan, not metered). No metered spend — no new API calls beyond one existing endpoint the page already has the code for.
- Reuse survey (rule 21): (1) the FOUR helpers already in `ho-so/ho-so-kid-view.ts` — `buildHeroCta` (the exact continue-vs-create rule the founder wants), `statusMeta`, `PROFILE_TIERS`, `defaultMonsterSvg` — ADOPTED by EXTRACTING them to `src/lib/r2l-hero.ts` and importing from both pages. The design handoff's reference implementation ships trimmed COPIES of these; shipping those copies is REJECTED — it would create a second source of truth for the rule deciding what a child sees first, and the two would drift. (2) `renderMonster()` (`src/lib/monster-avatar.ts`) — ADOPTED to draw the child's REAL pet (the mock's purple monster is a placeholder; Ong has a custom one, and "the screen belongs to that child" is the entire point of the redesign). (3) existing rank medal SVGs `public/assets/r2l/ranks/rank-l{0..5}-*.svg` — ADOPTED, all six already exist. (4) `Button.astro`/`Card.astro`/`ProgressBar.astro` + `design-system.css` tokens — ADOPTED; zero hard-coded hex. (5) the existing phase machine, generate/poll loop, honeypot and `activateOpenLessonWhenReady()` gate in `r2l-start.client.ts` — ADOPTED unchanged. (6) a new component library / new fonts — REJECTED (no new deps; the design is expressible in the existing token system).
- Design self-verification: PASS — verified on the DEPLOYED preview (claude-r2l-home-hub.felixbuilderhub.pages.dev) with a REAL student magic link, not a mock. Student Ong renders with real data: her own customised monster (NOT the mock's placeholder purple pet), rank medal correctly derived (tier_index 1 → rank-l2-silver.svg, matching the server's own rank_asset_url), "Hạng Bạc III", Cấp L2, 🔥 3 ngày, 🪙 1400 xu; the gold ĐỌC TIẾP card showing her real open book "The Big, Big Matchbox" at 33% with #continue-link → /read2lead/lesson?code=R2L-ONG-U5M6&pack_id=ee37d645…; SpeakUp/Hồ sơ/Cửa hàng all carrying her code; magic-link token NOT leaked into any href. All six states checked against the handoff screenshots at 390 + 1280 (ready-continue, ready-create, generating, result, error, gen-error, resolving) — MATCH. Screenshots in _ops/: hub-final-1280.png, hub-live-390.png, hub-create-variant.png, hub-generating.png, hub-result.png.
- Fidelity fix caught by the visual check (becfc7b): the design was drawn around the starter pet SVG, whose creature sits well inside its box. A real customised monster fills its box edge-to-edge, so the rank medal landed on the pet's CHEST and "Hạng …" was cramped against its feet. Inset the rendered monster to restore the design's proportions. This is exactly the class of defect that only a screenshot finds — the tests were green throughout.
- Deliberate deviation from the mock (founder-aligned): the mock draws the generic purple starter monster, but a child who has customised a monster sees THEIRS. "The screen belongs to that child" is the entire reason attempt 1 was rejected; showing a stranger's pet would defeat it. Falls back to the starter pet for a child who has not made one.
- Two artwork-derived hex values kept literal (`--minny-red #e0533f`, `--book-cover-lit #2f6285`) as named locals in the page's scoped style, and pinned by a test that allows exactly those two and no others. They are sampled from Minny's PNG and the book-cover art; mapping them onto the nearest navy token would visibly change the approved design. Everything else is a design-system token — stated honestly rather than claiming "zero hex".
- Review record: Buffet SHIP, no blocking findings. He independently proved the four extracted helpers are BYTE-IDENTICAL to the originals on origin/main (so ho-so cannot have drifted), that the two edited ho-so tests had their assertions FOLLOW the moved code rather than be weakened, that no ho-so dashboard code leaked into the start page bundle (checked dist/), that renderMonster() cannot strip the animated wrapper, and — the risk that mattered most — he could NOT construct a path where a child ends up with no primary button (every exit of resolveToken() lands on a CTA, including junk/failed progress data; he cross-checked against Ong's real record, whose `web_lesson_steps` is null and is correctly guarded). Two non-blocking notes: (a) the mid-poll copy dropped "Minny" — INTENTIONAL and consistent with the design's own copy ruling that Minny must not be credited with preparing the reading (the books are human-written), but it was not called out in the commit, which was a fair catch; (b) see follow-up below.
- KNOWN GAP (follow-up, accepted for this ship): if a child opens their magic link while a pack started elsewhere is still `generation_in_progress`, the home page shows an honest disabled "Đang chuẩn bị bài đọc cho con…" create card but does NOT auto-refresh when generation finishes — they must reload. ho-so's equivalent screen does poll. Not a dead screen (SpeakUp, the three tiles and the profile all remain usable) and the window is short, but it is a real UX gap. Deliberately NOT fixed minutes before merge: adding a new polling path would introduce unreviewed behaviour into a diff that is currently verified end-to-end.
- Founder handoff: DONE — Phương gave the merge GO after walking the preview. Merged to main (a39cdb0) and LIVE ON PRODUCTION, rule-20 verified on the real site with a real student magic link: felixbuilderhub.com/r2l/start renders the continue variant for Ong with her REAL customised monster, medal rank-l2-silver (tier_index 1), Hạng Bạc III, Cấp L2, 🔥 3 ngày, 🪙 1400 xu, her open book "The Big, Big Matchbox" at 33%, #continue-link → /read2lead/lesson?code=R2L-ONG-U5M6&pack_id=ee37d645…, SpeakUp/Hồ sơ/Cửa hàng all carrying her code, topic picker gone, magic-link token NOT leaked. Screenshot _ops/hub-PROD-390.png. 1403/1403 tests on the merged tree; astro build clean; founder build gate PASS.

## Previous task — R2L-TEST-CODE-UNLIMITED

- Status: complete
- Started: 2026-07-13
- Completed: 2026-07-13
- Task ID: R2L-TEST-CODE-UNLIMITED
- LIVE VERIFICATION ON PRODUCTION (0bcd88e, ~20s after merge): POST /api/generate-read2lead-pack with R2L-ONG-U5M6 — the code that had `uses_remaining: 0` and was returning `code_exhausted` — now returns `{ok: true, status: "done", story_title: "The Big, Big Matchbox", lesson_link: /read2lead/lesson?code=R2L-ONG-U5M6&pack_id=ee37d645…}`. Acceptance criterion #7 PASS: the test code generates again with no admin credit top-up. Criteria #1-#6 PASS via the 1270-test suite (15 new), including the four-path coverage and the six real-student regression guards. Criterion #2's no-decrement behaviour is not directly observable on prod (no machine-readable read of `uses_remaining` without the admin password) — it is covered by unit tests on all four completion paths plus the targeted mutation proof; and since the code was already clamped at 0, a decrement would have been a no-op there anyway. Stated honestly rather than claimed.
- Founder handoff: DONE — Phương approved the expiry scope call (keep the kill switch) and gave the merge GO; merged to main 0bcd88e and deployed. Real students remain metered.
- Owner: Claude Lead (Elon) — functions/api/generate-read2lead-pack.js + tests; Buffet reviews (author ≠ reviewer).
- Lane: product (bug fix; no UI surface)
- Problem: test codes are supposed to have unlimited testing, and they ALREADY bypass the "must review your previous pack" gate (`shouldRequireReviewBeforeNextPack` exempts `is_test`/`is_shared`) — but nobody ever exempted them from the LESSON-CREDIT gate. So a test code burns `uses_remaining` like a real student and eventually hits `code_exhausted` ("Mã đã hết lượt"), which is exactly what happened to R2L-ONG-U5M6 (verified `is_test: true` on prod) during the r2l-student-home live test: one generate consumed its last credit and the code is now dead for testing.
- Approach: `isUnlimitedCode(codeData)` (= `is_test === true`) and `spendUse(codeData)` live in the SHARED module `functions/api/_read2lead-v2-state.js`, because a pack is finalised — and a credit spent — from FOUR places, not one: generate-read2lead-pack.js (×2 branches), check-generation-status.js (client polling an async job) and read2lead-progress.js (dashboard self-heal of a stranded job). Every one of them now calls `spendUse()`; a test code therefore never burns a credit on any path, and `checkCodeAvailability()` skips the exhaustion gate for it. The clear-open-lessons refund path also skips test codes (it would otherwise inflate a meter that never decrements). Deliberately NOT extended to `is_shared`: a shared code is by definition handed to several people, so unlimited generation on it is a cost/abuse hole — shared codes stay metered.
- SCOPE CALL (Buffet, ratified by Elon): **expiry is still ENFORCED for test codes.** It is the only time-based kill switch on a code that now has no credit ceiling — without it a leaked test code (pasted in a doc, screenshotted into Zalo) would be a permanently live, review-gate-free generator costing real money per call. An admin bumps `expires_at` to keep a test code alive. The reported bug was exhausted USES, not expiry. FOUNDER QUESTION OPEN: Phương said "unlimited test time"; if she wants literal never-expiring test codes, we set `expires_at` far in the future per code (keeps the off-switch) rather than removing the gate.
- Acceptance criteria: (1) a test code with `uses_remaining: 0` can still generate a pack (no `code_exhausted`); (2) a test code's `uses_remaining` is NOT decremented by a successful generate — on ANY of the four completion paths, including the async/legacy polling path; (3) an EXPIRED test code is still refused (kill switch retained — see scope call); (4) REGRESSION GUARD — a normal student code with `uses_remaining: 0` still gets `code_exhausted`, and still decrements exactly once on success, on both the sync and async paths (the meter must keep working for real students); (5) an `is_shared` code is still metered and still exhausts; (6) full suite green; (7) live check on prod: R2L-ONG-U5M6 can generate again without a manual credit top-up.
- Files owned: functions/api/_read2lead-v2-state.js, functions/api/generate-read2lead-pack.js, functions/api/check-generation-status.js, functions/api/read2lead-progress.js, functions/api/_read2lead-clear-open-lessons.js, tests/read2lead-test-code-unlimited.test.mjs, tests/read2lead-book-assignment.test.mjs (fixture flip), CONTROL.md (Elon).
- Review record (two rounds, both NEEDS CHANGES, both adopted in full — the fix shipped is materially better than the one Elon first wrote):
  - **Round 1:** caught TWO missed decrement sites (check-generation-status.js, read2lead-progress.js) that the first cut left unguarded, and correctly diagnosed WHY the tests could not see them — all 9 forced the synchronous book-pool path, so the async/legacy branch was structurally unreachable from the suite. Also argued expiry must stay enforced (adopted; then ratified by Phương), and flagged the refund-path inflation (adopted). Fix reworked: `isUnlimitedCode`/`spendUse` moved into the shared `_read2lead-v2-state.js` so a fifth caller cannot silently re-introduce the bug.
  - **Round 2:** verified all four round-1 items, then caught the remaining hole: the FOURTH completion path (`read2lead-progress.js` `reconcileGenerationState`, the dashboard self-heal) had **zero** test coverage, before or after the change — and because it is a HAND-DUPLICATED copy of check-generation-status.js's promote logic ("Mirrors the promote logic…" per its own comment), a regression test on the polling path protects it not at all. Adopted: added a test pair driving `progressGet` through a `task:<id>` done record.
  - **Proof the new test is load-bearing (targeted mutation):** reverting ONLY `read2lead-progress.js:277` to the old raw decrement is now caught — full suite goes 1270 pass → 1 fail, and the failing test is exactly `a test code does NOT burn a credit when the dashboard self-heals a finished generation`. Before that test existed, Buffet's stated prediction was that the entire suite would pass through that revert; confirmed true. Broad mutation (forcing `isUnlimitedCode` → false): 7 exemption tests fail, all 6 regression guards hold.
- Test totals: 1270/1270 (1255 pre-existing + 15 new); `npx astro build` clean.
- Non-goals: no change to rewards/XP/coins/rank; no change to who is marked `is_test` (admin decides); no change to `is_shared` semantics; no UI change.
- Stop condition: suite green + Buffet SHIP + founder gates PASS + Phương merge GO.
- Cost ceiling: Claude team (Max plan, not metered). No metered spend; the fix REMOVES generation cost accounting for test codes only, which is the intent.
- Reuse survey: (1) the endpoint's OWN existing exemption helper `shouldRequireReviewBeforeNextPack(codeData)` — ADOPTED as the precedent and mirrored exactly (same `is_test` flag, same shape, same file), rather than inventing a new flag or a new config key; (2) a new KV field like `unlimited_uses` — REJECTED: `is_test` already exists, is already set from admin, and is already surfaced by the progress API, so a second flag would be two sources of truth; (3) giving test codes a very large `uses_remaining` (e.g. 999999) — REJECTED: it only postpones the bug, still decrements, and lies in the admin UI about what the code is.
- Design self-verification: N/A — backend gate, no UI surface; verified by unit tests against the real endpoint + a live prod generate on the test code.
- Founder handoff: pending.

## Previous task — R2L-PAGE-BANDS

- Status: complete (shipped 2026-07-12, 672ffd7 + bd3fc28; CONTROL block rotated 2026-07-13)
- Started: 2026-07-12
- Completed: 2026-07-12 — shipped to main (page-count assignment + reindex, admin clear-open-books button); founder-verified.
- Task ID: R2L-PAGE-BANDS
- Owner: Claude Lead (Elon) — generate-read2lead-pack.js (bandForLevel/normalizeKidLevel/drift warn) + migration script + assignment tests; Mark (bg worker) — publish-read2lead-book.js (bandForPageCount, banded publish, reindex_only) + tests; Buffet reviews combined diff.
- Lane: product (book assignment by page-count band per SPEC_R2L_PAGE_BANDS.md; selection/health/reward logic untouched)
- Problem: books were assigned by StoryWeaver text level; founder wants length-based bands matched to kid stamina (L0:3-6 … L4:16+ pages, chosen from the 432-book histogram so every band has ≥45 books).
- Approach: re-bucket the five book_index:<L> KV lists (migration script with snapshot backup + verify); publish endpoint auto-bands future books; bandForLevel normalization + L5 clamp; book_band_mismatch drift warn.
- Acceptance criteria: per-level integration tests prove a kid at each level L0-L5 draws an in-band book; bandForPageCount boundary table green; reindex_only auth/shape/overwrite tests green; migration dry-run verifies disjoint union preserved with expected counts before any write; post-apply live check: low-level code gets 3-6-page book, high-level gets 16+; full suite green; build clean.
- Files owned: functions/api/publish-read2lead-book.js (Mark), functions/api/generate-read2lead-pack.js, scripts/reindex-books-by-pages.mjs, tests/read2lead-book-assignment.test.mjs, tests/read2lead-book-publish.test.mjs, CONTROL.md (Elon).
- Non-goals: no change to selection randomness, health gate, quarantine semantics, rewards; config:book_levels activation is a separate explicit founder decision; text-difficulty guard inside bands is a logged follow-up only.
- Stop condition: suite green + Buffet SHIP + founder gates PASS + Phương merge GO; migration runs only after merge, with backup file as rollback.
- Cost ceiling: Claude team (Max plan, not metered); migration is KV reads + one reindex POST, $0.
- Reuse survey: (1) in-repo book_index machinery — ADOPTED (re-bucketing the existing lists IS the feature; assignment path untouched); (2) sidecar book_index_pages:<band> store — REJECTED (two sources of truth); (3) assignment-time page filtering — REJECTED (extra KV reads on the hot path).
- Design self-verification: N/A — backend assignment logic, no UI surface; verified by per-level integration tests + live low/high-level pack generation.
- Founder handoff: pending — merge GO then migration report with band counts.

## Previous task — R2L-PAGE-LOOP

- Status: complete
- Started: 2026-07-11
- Completed: 2026-07-12 — merged to main 73c4d25 (Phương GO after preview
  verification), production smoke PASS (fresh pack: v3 client live, 12/12
  text_vi, 11 vocabulary entries in payload, 24/24 questions page-aligned)
- Verified commit: 73c4d25 (origin/main)
- Task ID: R2L-PAGE-LOOP
- Owner: Claude Lead (Elon) — lesson.astro direct (guard-protected, spec-covered);
  Mark (background worker) owns src/lib/read2lead-book-flow.mjs,
  functions/api/submit-read2lead-lesson.js, src/lib/read2lead-book-health.mjs +
  their tests; Buffet reviews the combined diff and runs the real-speech e2e.
  Author≠reviewer preserved: Elon reviews Mark line by line; Buffet reviews
  Elon's lesson.astro changes.
- Lane: product (kid-facing lesson flow restructure per approved spec;
  scoring/reward/gate SEMANTICS unchanged by founder decision — only the
  speaking unit changes from sentence-chunks to page reads)
- Problem: e2e 2026-07-11 (R2L-PILOT-CYJS) — 6.5 min passive listening before
  any interaction, questions batched minutes after content, options reshuffled
  on retry, 31+ shadow chunks, 18-20 min sessions; exhausting for the 6-12 age
  group (PRODUCT_CONTEXT: "attention span short — activities must be snappy").
- Approach: book flow v3 per SPEC_R2L_PAGE_LOOP.md — per-page
  story→questions(4, AJ Hoge style, stable option order)→page read-aloud(1-2
  units, word cap 60, mic unlocked after the page listen)→advance; version-gated
  validateBookFlowSubmission (v2 accepted indefinitely — pending-submit replay
  is the 2026-06-27 P0 shape); server counts page reads under the existing
  summary keys; checkpoint resume self-heals by id re-derivation.
- Acceptance criteria: per-page loop works end-to-end on the deployed preview
  with code R2L-PILOT-CYJS INCLUDING real-speech recording (record → Whisper →
  score ≥50 → submit → real XP/rank movement); 4 questions/page from the
  existing pool with graceful degradation; option order stable across retries;
  mic unlocks without the sample-listen lock; a v2-shaped payload still submits
  successfully; standard-pack path byte-identical (finalizeWithoutReward
  regression pin); old checkpoints resume without loss of required progress;
  node --test green; astro build clean; session-time estimate ≤15 min verified
  in e2e timing.
- Files owned: src/pages/read2lead/lesson.astro (Elon),
  src/lib/read2lead-book-flow.mjs, functions/api/submit-read2lead-lesson.js,
  src/lib/read2lead-book-health.mjs (Mark), tests/read2lead-book-flow.test.mjs,
  tests/read2lead-book-health.test.mjs, tests/read2lead-book-reader-behaviour.test.mjs,
  tests/helpers/book-pack-fixture.mjs, new test files (Mark),
  .founder-os/products/read2lead/CONTROL.md + EVIDENCE.md (this entry).
  No overlap with the concurrent SpeakUp session's active set (verified in
  claude-bg-worker-active.json).
- Non-goals: reward/gate semantics (completed_without_reward, pass ≥50,
  3 attempts, S/A/B/F) — UNCHANGED per founder; XP economy rebalance; Hoge-style
  question regeneration in the Python backend (follow-up); mid-book rest stop;
  recorder pipeline files (untouched).
- Stop condition: acceptance criteria pass on the deployed preview + Buffet
  SHIP + founder build/complete gates PASS, then STOP — merge to main only on
  Phương's explicit approval after she taps through the preview.
- Cost ceiling: Claude team (Max plan, not metered); Whisper/TTS e2e usage on
  existing Cloudflare/OpenAI plumbing, one pilot code's sessions.
- Reuse survey: (1) in-repo versioned-rules in `read2lead-book-flow.mjs`
  (shared client+server via ?raw + server import) — ADOPTED for v2/v3 gating,
  same single-source pattern the health gate already trusts; (2) `xstate` for
  the lesson state machine — REJECTED: the inline ?raw script can't take a
  bundled dependency and the string-stage machine is small; (3) `canvas-confetti`
  for page-complete moments — REJECTED: `fireStreakConfetti`/`__r2lJuice`
  (src/lib/lesson-juice.ts) already ship; (4) AJ Hoge mini-story questioning —
  adopted as a PATTERN (frequent easy questions), served from the existing
  generated pool.
- Design self-verification: DONE 2026-07-12 — live e2e screenshots at 390px on
  the deployed preview (listen/read/summary stages) vs SPEC_R2L_PAGE_LOOP.md §3;
  all components are pattern-copies of existing approved lesson cards; summary
  card + header XP movement verified rendered. Screenshots in session scratchpad
  r2l-e2e/shots/. Flagged for Phương's visual veto before merge.
- Verified commit: 5c56be5 (origin/claude/r2l-page-loop; preview
  claude-r2l-page-loop.felixbuilderhub.pages.dev)
- Founder handoff: preview URL + e2e results reported 2026-07-12; Phương taps
  through one lesson before any merge to main. Acceptance evidence: live
  real-speech e2e (R2L-PILOT-CYJS) — 8 pages, 32 questions, 9/9 page reads
  Whisper-scored 81-95, submit passed grade S +25 coins/+20 XP (header
  200→220 XP verified), mic unlocked without sample re-listen, mic-check
  safety gate still blocks silent mics, est. kid session ~13 min (was 18-20);
  1066/1066 tests; astro build clean; Buffet review: one Medium finding fixed
  + regression-pinned, submit-path/validator/reward semantics verified clean.

## Acceptance criteria reconciliation (R2L-PAGE-LOOP)

- Per-page loop end-to-end on deployed preview with real-speech recording:
  PASS — live e2e (R2L-PILOT-CYJS): 8 pages, 32 questions, 9/9 page reads
  Whisper-scored 81-95, submit 200 passed grade S, +25 coins/+20 XP, header
  XP 200→220 on-screen.
- 4 questions/page from the existing pool with graceful degradation: PASS —
  selection tests (limit-4, top-up, thin pages) + live packs (10/page pools,
  4 selected).
- Option order stable across retries: PASS — deterministic seeded order,
  unit-pinned; verified in e2e retry path.
- Mic unlocks without sample-listen lock: PASS — e2e `micUnlockedWithoutSample`
  flag true on every read; mic-check safety gate still blocks silent mics
  (verified by the harness's own first failed run).
- v2-shaped payload still submits: PASS — version-matrix unit tests +
  submit-endpoint v2 end-to-end test.
- Standard-pack path byte-identical: PASS — `finalizeWithoutReward`
  regression pin + Buffet trace of `isBookFlowV2` fencing.
- Old checkpoints resume without loss of required progress: PASS —
  re-derivation merge tests; e2e relaunch-per-read resumed via checkpoint 10x.
- node --test green: PASS — 1172/1172 on the merged tree (incl. SpeakUp).
- astro build clean: PASS — 25 pages, zero leaked inline exports.
- Session-time ≤15 min: PASS — e2e estimate ~13 min (was 18-20).
- Fix round 2 (founder findings): PASS — Dịch/Từ khó live-verified by Phương
  on preview; 429/430 servable books enriched (text_vi + vocabulary +
  page-answerable questions); next-page-question guard unit-pinned.

## Previous task — R2L-BOOK-HEALTH-GATE

- Status: complete
- Started: 2026-07-09
- Completed: 2026-07-09 — pushed to main 06d18f9 (Phương approved commit+deploy), 765 tests, astro build clean, Buffet review clean
- Verified commit: 06d18f9 (origin/main + origin/claude/r2l-book-health-gate)
- Task ID: R2L-BOOK-HEALTH-GATE
- Owner: Claude Lead (Elon) — direct build (Tier1); `functions/api/generate-read2lead-pack.js`
  and the new `src/lib/read2lead-book-health.mjs` are author-owned. Author≠reviewer
  preserved by a mandatory independent Buffet review (Tier2) before commit; plan
  approved by Felix 2026-07-09
- Lane: product (backend finishability gate on the book-pool assignment path;
  no change to scoring, rewards, or the mic/recorder pipeline)
- Problem: the book pool is picked at random with zero content check, so a book
  with inconsistent internal data can dead-end a child (a page whose audio can
  never complete leaves the next button disabled; a word-order item whose tokens
  can't rebuild the sentence traps a W1 kid) — the founder-reported "some story
  packs are impossible to finish".
- Approach: new `src/lib/read2lead-book-health.mjs` (`assessBookHealth`) mirrors
  the app's own completion logic — reuses the real `selectBookQuestions` /
  `buildBookShadowChunks` and re-derives the runtime `normalizeOrderSentence` —
  to prove a book is finishable before assignment, classifying defects HARD
  (unfinishable → skip) vs SOFT (cosmetic → deprioritize). `assignBookPack` in
  `generate-read2lead-pack.js` becomes a bounded retry loop (skip broken → try
  next) with a per-level KV quarantine (`book_quarantine:<level>`) so known-bad
  books are skipped cheaply and are reportable to ops. Exhaustion is never a
  strand: a cosmetic-only pool still serves the least-bad finishable book
  (`book_pool_degraded`), and only an all-unfinishable pool returns
  `book_pool_needs_repair` (409) without burning a use.
- Acceptance criteria: a book that fails finishability is skipped and a healthy
  one assigned; the failed slug is quarantined and never re-read; a cosmetic-only
  pool still assigns (no strand); an all-unfinishable pool returns
  book_pool_needs_repair without decrementing uses; the gate never throws on
  garbage input; a book served under the wrong key is rejected (slug_mismatch);
  read_aloud-only books with empty sentences remain finishable (no false
  positive); a pack that passes the gate also passes validateBookFlowSubmission;
  `node --test` green; astro build clean.
- Files owned: src/lib/read2lead-book-health.mjs (new),
  functions/api/generate-read2lead-pack.js,
  tests/read2lead-book-health.test.mjs (new), tests/helpers/book-pack-fixture.mjs,
  tests/read2lead-book-assignment.test.mjs,
  tests/read2lead-book-reader-behaviour.test.mjs, tests/index.js,
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Non-goals: does NOT gate the LLM-generated (bespoke per-child) pack path — there
  is no "other book" to pick there (deferred); does NOT repair the books already
  broken in the library (the gate skips them; regenerating them is a follow-up).
- Stop condition: tests green (incl. new gate + integration tests), Buffet review
  clean, founder build gate PASS, astro build clean, then push to main (Phương
  approved commit+deploy 2026-07-09).
- Cost ceiling: USD 0 metered — Claude Lead direct + one Buffet review on the Max
  plan; actual USD 0.
- Reuse survey: (1) the product's OWN runtime flow module
  `src/lib/read2lead-book-flow.mjs` (`selectBookQuestions`/`buildBookShadowChunks`)
  — ADOPTED wholesale: the gate calls the real production functions so "passes the
  gate" provably means "the runtime accepts it", never a re-implementation that
  can drift; (2) a bundled English dictionary / spell-checker (nspell, hunspell,
  an npm wordlist) for typo detection — REJECTED: heavy for a Cloudflare Worker,
  high false-positive rate on character names/kid words, and it misses the actual
  dead-ends (which are structural, not spelling); (3) the existing generation-time
  validators (`read2lead_v0_codex/api/validator_v2.py`) — NO FIT at assignment
  time: they run only at generation and can't be trusted for already-shipped KV
  books, but their reconstruction logic was ported as the reference for the
  listen_and_order check.
- Design self-verification: N/A — backend gate, no UI/design surface; verified by
  the new executing unit + integration tests and the runtime-parity regression.
- Founder handoff: reported in chat with a plain-language summary; Phương approved
  commit + deploy. No decisions pending.

## Acceptance criteria reconciliation (R2L-BOOK-HEALTH-GATE)

- Broken book skipped, healthy one assigned, broken slug quarantined: PASS —
  "a broken book is skipped, a healthy one assigned, and the broken slug
  quarantined" integration test.
- Quarantined book skipped without re-read: PASS — get-spy test asserts
  `book:book_1` is never fetched.
- Cosmetic-only pool still assigns (no strand): PASS — "a pool of only
  cosmetically-flawed books still assigns one" test.
- All-unfinishable pool → needs_repair, no use burned: PASS — two tests (all-hard
  pool and all-quarantined pool) assert 409 `book_pool_needs_repair`,
  `uses_remaining` unchanged.
- Gate never throws on garbage: PASS — null/`{}` return hard-fail, not an
  exception.
- Wrong-key pack rejected: PASS — `slug_mismatch` unit + integration tests.
- Empty-sentence read_aloud books stay finishable: PASS — explicit health test.
- Gate ⇒ runtime-finishable: PASS — a pack passing `assessBookHealth` also passes
  `validateBookFlowSubmission`.
- node --test green: PASS — 765/765 (manifest run 134/134).

## Previous task

- Status: complete
- Started: 2026-07-09
- Completed: 2026-07-09 — merged to main ff48675 (Felix approved), 744/744 tests, astro build clean
- Task ID: R2L-BOOK-TEST-FIXTURE
- Owner: Claude Lead (Elon) — direct; `src/pages/read2lead/lesson.astro` is on
  the dispatch-guard PROTECTED allowlist (spec required; the approved plan is
  that spec), plan approved by Felix 2026-07-09
- Lane: product (test infrastructure + a byte-identical refactor of the
  scroll-reset helper; no change to lesson completion, scoring, rewards, or the
  mic/recorder pipeline)
- Problem: the book-reader is only checkable by hand (live pack + mic), and its
  "tests" are static source-regex assertions that never execute the reader — so
  a behaviour bug like the scroll-to-bottom one cannot be caught automatically.
  This is the ratified EVOLUTION_LOG proposal (2026-07-09) to add the missing
  test seam.
- Approach: (1) new `tests/helpers/book-pack-fixture.mjs` — `makeBookPackLesson`
  builds a valid lesson-pack object (story paragraphs/sentences, guided_listening
  questions, book_images, page audio, attribution) in the exact shape
  `src/lib/read2lead-book-flow.mjs` + the reader consume, plus `makeBookReaderState`
  for a completed run; (2) extract the scroll-reset one-liner from the inline
  `bookShowPage` into `read2lead-book-flow.mjs` as `scrollBookReaderToTop(doc)`
  (byte-identical runtime — same `#w1-book-reader-phase` + `scrollIntoView({block:'start'})`)
  and call it from `bookShowPage`, so the exact fix becomes unit-testable;
  (3) new `tests/read2lead-book-reader-behaviour.test.mjs` — executing tests that
  feed the fixture through the flow module (question selection, shadow chunks,
  submission validation) and spy on `scrollIntoView` to prove the page-turn
  resets to the reader top.
- Acceptance criteria: fixture produces data that `selectBookQuestions` /
  `buildBookShadowChunks` / `validateBookFlowSubmission` accept; a completed
  reader state validates `ok:true`; `scrollBookReaderToTop` targets
  `#w1-book-reader-phase` with `{behavior:'smooth',block:'start'}` and is null-safe;
  `bookShowPage` runtime unchanged; `node --test tests/*.test.mjs` passes;
  astro build clean; no unrelated refactor.
- Files owned: tests/helpers/book-pack-fixture.mjs (new),
  tests/read2lead-book-reader-behaviour.test.mjs (new),
  src/lib/read2lead-book-flow.mjs, src/pages/read2lead/lesson.astro,
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Non-goals: no local KV seed / Playwright harness this packet (deferred — the
  `node --test` coverage is the core ask); no change to reader behaviour beyond
  the byte-identical scroll-helper extraction.
- Stop condition: tests green (incl. the new behaviour tests), founder build
  gate PASS, astro build clean, then Felix + Phương approve merge to main.
- Cost ceiling: USD 0 metered — Claude Lead direct on the Max plan; actual USD 0.
- Reuse survey: (1) the existing `src/lib/read2lead-book-flow.mjs` self-contained
  flow module + its ESM test pattern (`tests/read2lead-book-flow.test.mjs`) —
  ADOPTED wholesale: extend it and its import-and-run test style rather than build
  a parallel harness; (2) jsdom / happy-dom for a DOM in tests — REJECTED: not a
  dependency here, and the repo already has a hand-rolled `globalThis.document`
  mock idiom (`tests/read2lead-w2-juice.test.mjs`) that the scroll test reuses,
  zero new deps; (3) Storybook / component-story harness — REJECTED: heavy tooling
  for an Astro-inline-script page, the fixture + flow module cover the need.
- Design self-verification: N/A — test infrastructure + a byte-identical helper
  extraction, no UI/design change; verified by the new executing tests + astro build.
- Founder handoff: result reported in chat; merged to main ff48675 under Felix's approval. No decisions pending.
- Verified commit: ff48675 (on origin/main and origin/claude/r2l-book-test-fixture)

## Acceptance criteria reconciliation

- Fixture produces data selectBookQuestions / buildBookShadowChunks /
  validateBookFlowSubmission accept: PASS — the new behaviour tests execute all
  three against the fixture output.
- A completed reader state validates ok:true: PASS — "a completed reader state
  built from the fixture validates ok" test (pages_heard 2, questions_answered 4).
- scrollBookReaderToTop targets #w1-book-reader-phase with
  {behavior:'smooth', block:'start'} and is null-safe: PASS — two behaviour
  tests (a scrollIntoView spy + a null-safety case).
- bookShowPage runtime unchanged: PASS — byte-identical extraction; the built
  page confirms scrollBookReaderToTop is inlined and called.
- node --test passes: PASS — 744/744 (5 new).
- astro build clean: PASS — 26 pages.
- No unrelated refactor: PASS — 5 files, +257/-8, all inside the packet.

## Previous task

- Status: complete
- Started: 2026-07-09
- Completed: 2026-07-09 — merged to main 69ac4da (Felix authorized the prod push directly), live-verified on felixbuilderhub.com
- Task ID: R2L-NEXT-PAGE-SCROLL
- Owner: Claude Lead (Elon) — direct edit; `src/pages/read2lead/lesson.astro`
  is on the dispatch-guard PROTECTED allowlist (spec required; the approved
  plan below is that spec), plan approved by Felix 2026-07-09
- Lane: product (UI/UX scroll behavior only — no change to lesson completion,
  scoring, rewards, badges, or the mic/recorder pipeline)
- Problem: when a kid finishes a book-reader page (listen, answer the 2
  questions, record themselves) and taps "Trang tiếp →", the next page
  renders in place but the scroll position is never reset. The kid tapped
  Next from the bottom of the previous page, so the new page opens scrolled
  to the bottom and they must scroll up to see the story image/title and
  start reading.
- Approach: reset scroll to the top of the reader by calling
  `qs('#w1-book-reader-phase')?.scrollIntoView({ behavior: 'smooth', block: 'start' })`
  at the end of `bookShowPage()` — the single choke point every page change
  funnels through (forward "Trang tiếp →", back, progress-trail jump, and
  story-page next). It does NOT fire on within-page steps (listen →
  questions → record), which go through `bookSetStage()`, so the reading
  flow inside a page is undisturbed. Reuses the exact
  `scrollIntoView({ behavior: 'smooth', block: 'start' })` pattern already in
  this file (lesson.astro:4193, :4995).
- Acceptance criteria: after tapping "Trang tiếp →", the new page opens at
  the top (story image + page title in view), not scrolled to the bottom;
  the same holds for back-nav and progress-trail jumps; within-page steps
  are NOT force-scrolled; `node --test tests/*.test.mjs` passes; no unrelated
  refactor.
- Files owned: src/pages/read2lead/lesson.astro,
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Stop condition: tests green, `founder_check.py --gate build` PASS, live
  in-browser verification shows a real page turn landing at the top, then
  Felix + Phuong approve the merge to main (pushing main = live deploy to
  real kids).
- Cost ceiling: USD 0 metered — Claude Lead direct on the Max plan; actual USD 0.
- Reuse survey: (1) native `Element.scrollIntoView` (browser API) — ADOPTED:
  reuses the exact pattern already used in this file (lesson.astro:4193,
  :4995), zero new dependency; (2) `scroll-into-view-if-needed` /
  smooth-scroll npm packages — REJECTED: the native API fully covers a single
  scroll-to-top, a library would add a dependency for no gain; (3) CSS
  `scroll-margin` / scroll-snap — REJECTED: the reset must fire imperatively
  on a JS-driven in-place content swap, not on a native anchor navigation.
- Design self-verification: N/A — no design mock (behavior fix, not a visual
  redesign). Verified on the LIVE production deploy (felixbuilderhub.com,
  commit 69ac4da): the exact scroll-reset line is served in the lesson page
  (`scrollIntoView` count 5→6; marker present via both curl and a Playwright
  DOM read), ZERO console errors/warnings on load, and the exact
  `scrollIntoView({ block: 'start' })` call moves the viewport to the reader
  top when exercised against the live `#w1-book-reader-phase` element. NOT
  driven: a full real book-reader page-turn — reaching the "Trang tiếp →"
  button needs a seeded book pack plus a mic to complete a page, neither
  reproducible in the sandbox. Mechanism otherwise certain: the reset sits in
  `bookShowPage()`, the sole choke point every page change funnels through.
- Founder handoff: pushed to prod under Felix's explicit authorization
  ("push to prod and check there"). Verified live as above and reported in
  chat. Recommended residual (not a blocker): Felix taps through one real
  lesson on a device to confirm the feel of the mic-gated page-turn. No
  decisions pending.
- Verified commit: 69ac4da (live on origin/main and origin/claude/r2l-next-page-scroll)

## Acceptance criteria reconciliation

- After tapping "Trang tiếp →", the new page opens at the top (story image +
  title in view), not scrolled to the bottom: PASS (mechanism + live element
  check) — the reset is `qs('#w1-book-reader-phase')?.scrollIntoView({block:'start'})`
  at the end of `bookShowPage()`, the single choke point for every page
  change; the exact call brings the live reader element to the viewport top
  (Playwright). SKIPPED live full-flow drive (no mic/seeded pack in sandbox),
  reason recorded above.
- Same holds for back-nav and progress-trail jumps: PASS by construction —
  both call the same `bookShowPage()` (lesson.astro back-nav + trail-node
  click handlers); code-verified, not separately driven.
- Within-page steps (listen → questions → record) are NOT force-scrolled:
  PASS — those transitions go through `bookSetStage()`, which does not call
  `bookShowPage()`; all 5 `bookShowPage()` call sites are page-index changes
  (code-verified).
- `node --test tests/*.test.mjs` passes: PASS — 739/739.
- No unrelated refactor: PASS — diff is one line + a comment in lesson.astro,
  plus this CONTROL.md bookkeeping.

## Previous task

- Status: complete
- Started: 2026-07-08
- Task ID: R2L-STRANDED-RESCUE
- Owner: Claude Lead (spec + execute + review; lesson completion logic —
  protected invariant, covered by spec addendum 2 in
  _ops/specs/SPEC_R2L_AUTO_SAVE_COMPLETION.md; Phuong granted full authority
  including merge to main: "Save all lessons for all kids... you have full
  power, no need for my approval", 2026-07-08)
- Lane: product (remediation of the 1502dd6 outage's stranded packs)
- Problem: kids whose standard packs are finished but stuck at
  awaiting_review (blocked by the 27/6–8/7 submit bug or the old click
  funnel) only get rescued when THEY reopen the lesson page. Phuong wants
  every stuck lesson saved proactively so dashboards look right immediately
  and no kid feels bad.
- Approach: server-side reconciliation on read. New
  functions/api/_read2lead-reconcile-stranded.js pre-scores the kid's own
  data (server checkpoint snapshot, else the exact payload of their last
  failed submit attempt) with the fixed rules, and only when the outcome is
  a genuine completion calls the real (now exported) submitV2Lesson —
  identical rewards/gates/idempotency as a real submit. Wired into
  read2lead-progress GET and the generate-read2lead-pack gate. Books and
  genuinely-unfinished/below-50% packs are never touched.
- Acceptance criteria: stranded-by-failed-attempt pack completes with
  rewards on first progress read and is idempotent on the second;
  stranded-by-checkpoint pack completes; genuinely-below-threshold pack is
  left byte-identical (status, attempts, checkpoint); book packs untouched;
  mic-skip source completes without reward; generate gate unblocks after
  reconcile; node --test passes; no unrelated refactor.
- Files owned: functions/api/_read2lead-reconcile-stranded.js (new),
  functions/api/submit-read2lead-lesson.js (exports + no behavior change),
  functions/api/read2lead-progress.js, functions/api/generate-read2lead-pack.js,
  tests/read2lead-stranded-rescue.test.mjs (new),
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Non-goals: no KV enumeration/sweep (no admin credentials by design;
  on-read reconciliation reaches every active kid); no history rewriting
  (XP penalty constant is 0 — nothing to refund); no book flow changes.
- Stop condition: tests green, build clean, local wrangler e2e shows a
  seeded stranded record flip to reviewed_pass_web_v2 on a plain progress
  GET, gates PASS, merged to main (pre-authorized) and production verified.
- Cost ceiling: USD 0 metered — Claude Lead direct on Max plan; actual: USD 0.
- Reuse survey: (1) existing submitV2Lesson pipeline — adopted wholesale via
  export (rewards/gates/idempotency identical to a real submit, no parallel
  implementation); (2) wrangler remote KV sweep / admin API batch — rejected:
  agent holds no CF/admin credentials by design and bulk enumeration of kid
  records is riskier than on-read reconciliation; (3) client-side self-heal
  (shipped in R2L-AUTO-SAVE-COMPLETION) — reused but insufficient alone: it
  requires the kid to open the lesson page, which Phuong explicitly wants to
  avoid.
- Design self-verification: N/A visual (server-side behavior, no UI change,
  no design mock) — behavior self-verified live by the building agent on
  `wrangler pages dev` + seeded KV at commit 7572af4: (1) bug-window victim
  record (real captured failed-submit payload, 95% true score) flipped to
  reviewed_pass_web_v2 with XP 20 / coins 25 on a single plain dashboard
  GET, idempotent across 3 reads; (2) checkpoint-only mic-skip kid completed
  without reward; (3) half-finished kid stayed awaiting_review, zero KV
  writes. 739/739 tests incl. 9 new covering all rescue/no-touch branches.
- Founder handoff: executed under Phuong's explicit full authority ("Save
  all lessons for all kids... you have full power, no need for my
  approval"). Result reported in chat; no decisions pending. Named
  boundary: production effect on real stranded kids is observable only when
  their codes are next read — the reconciliation path is identical to the
  live-verified local run, and production deploy of the same commit was
  confirmed via bundle marker.
- Verified commit: 7572af4 (on origin/claude/r2l-stranded-rescue; merged to
  main immediately after per pre-authorization)

## Acceptance criteria reconciliation (R2L-STRANDED-RESCUE)

- Stranded-by-failed-attempt pack completes with rewards on first progress
  read, idempotent on repeat reads: PASS — unit test + live wrangler e2e
  (3 consecutive GETs, xp/coins/completed_packs stable).
- Stranded-by-checkpoint pack completes: PASS — unit test + live e2e.
- Genuinely-below-threshold pack left byte-identical: PASS — unit test
  asserts deepEqual + zero KV puts.
- Genuinely-unfinished pack untouched: PASS — unit test + live e2e control.
- Book packs untouched: PASS — unit test.
- Mic-skip source completes without reward: PASS — unit test + live e2e
  (xp 0, coins 0, status reviewed_pass_web_v2).
- Generate gate unblocks after reconcile: PASS — reconcile wired before
  the previous_pack_needs_review gate, source-order asserted by test;
  full generate flow not driven live (would invoke the real Render backend
  and spend a lượt) — SKIPPED live-drive with that reason.
- node --test passes: PASS — 739/739 (9 new).
- No unrelated refactor: PASS — submit endpoint changes are export
  keywords only.

## Previous task

- Status: complete
- Started: 2026-07-08
- Completed: 2026-07-08 — merged to main b59f051 (Phuong approved), production verified live
- Task ID: R2L-AUTO-SAVE-COMPLETION
- Owner: Claude Lead (spec + execute + review; `lesson.astro` is PROTECTED —
  Claude edits directly per `~/.claude/hooks/aider-dispatch-protected.json`)
- Lane: product (protected "lesson completion logic" invariant — dedicated
  approved spec: `_ops/specs/SPEC_R2L_AUTO_SAVE_COMPLETION.md`, plan approved
  by Phuong 2026-07-08)
- Problem: ~90% of kids finish all 5 exercises but never save the pack. The
  finish path requires clicking "Hoàn thành nhiệm vụ 🎉" → confirming a modal
  ("Lưu chiến công") → waiting for a network POST. Kids close the tab after
  the last exercise; the pack stays `awaiting_review` forever.
- Approach: auto-submit the moment the last activity completes (mirror the
  existing book-lesson `bookFinishReader()` pattern), delete the confirm
  modal, keep "Gửi lại" retry on failure, and auto-retry the saved pending
  payload on next page load. Client-only; server endpoint already idempotent.
- Acceptance criteria: standard 5-activity lesson auto-submits with zero
  clicks after the last activity (celebration burst not cut off — 1700ms
  delay, 500ms on mic-skip); `#submit-confirm-modal` removed; `#lesson-continue`
  all-done branch calls `submitLesson()` directly as manual fallback;
  `updateGlobalCta()` shows saving/fallback states; pending submit auto-retries
  on load with the saved payload; resumed all-done sessions auto-submit;
  failed-pass and offline paths show toast + "Gửi lại" and re-enable manual
  save; book/W1 flows unchanged, no double-fire (`submitInFlight` +
  `_r2lAutoSubmitArmed`); `tests/lesson-ux-regression.test.mjs` modal test
  rewritten; `node --test` passes; no unrelated refactor.
- Files owned: src/pages/read2lead/lesson.astro,
  tests/lesson-ux-regression.test.mjs,
  functions/api/submit-read2lead-lesson.js (added via P0 addendum, see below),
  tests/read2lead-legacy-client-submit.test.mjs (new),
  .founder-os/products/read2lead/CONTROL.md (this entry)
- Non-goals: no checkpoint-to-finalize server rescue (rejected Option B);
  no reward/scoring semantic changes.
- P0 addendum (2026-07-08, spec addendum in
  _ops/specs/SPEC_R2L_AUTO_SAVE_COMPLETION.md): live e2e exposed that since
  1502dd6 (2026-06-27) the submit endpoint expected a read_aloud result the
  standard-lesson client never sends — every standard-pack submit failed
  ("Chưa đạt 50%") with the score deflated by phantom read_aloud zeros and
  the XP penalty applied. This, not only the click funnel, is the dominant
  cause of "kids finish but never save". Smallest stabilizing fix under the
  AGENTS.md P0 exception: filter read_aloud out of the ensured activities
  for NON-book submit contexts (books keep their dedicated isBookFlowV2
  path). Also: raw network TypeError no longer leaks English "Failed to
  fetch" into kid-facing text.
- Stop condition: tests green, build clean, live e2e on deployed preview
  (zero-click auto-save observed via Playwright), founder_check gates PASS,
  Phuong approves merge to main.
- Cost ceiling: USD 0 metered — Claude Lead direct on Max plan (protected
  file, no Aider dispatch); actual cost: USD 0.
- Reuse survey: (1) in-repo book-lesson auto-submit pattern
  (`bookFinishReader()`, lesson.astro:6192) — adopted as the model for the
  trigger; (2) `navigator.sendBeacon` checkpoint rescue promoted to
  server-side finalization (external pattern: beacon-based analytics
  saves) — rejected: checkpoint payload lacks submit-shape data, server
  double-reward risk; (3) localStorage pending-queue libraries (e.g.
  workbox-background-sync) — rejected: existing hand-rolled
  savePendingSubmit/loadPendingSubmit already shipped and sufficient, a
  service-worker dependency is overkill for one endpoint.
- Design self-verification: no Claude Design mock exists for this task (flow
  change reusing the existing completion card/toast/CTA components). Rendered
  and driven end-to-end by the building agent at 1280px: (a) full flow on
  `wrangler pages dev dist` + seeded KV at the exact pushed commit — zero-click
  auto-save after last activity, offline failure state, reload auto-resend,
  completion card; screenshots `_ops/r2l-autosave-offline-retry-1280.png`
  (CTA fallback "Lưu chiến công 💾" + "Gửi lại") and
  `_ops/r2l-autosave-completion-1280.png` ("Nhiệm vụ xong!" card, CTA gone);
  (b) deployed preview at 94d6602 — new code markers confirmed in served
  bundle (auto-submit scheduler, new hint copy, no submit-confirm-modal),
  standard-lesson fixture rendered via route interception (zero writes to real
  KV), part 1 completed through the deployed UI with quest path updating;
  screenshot `_ops/r2l-autosave-preview-deployed-1280.png`. Verdict: match.
  Named boundary: the deployed W1 story-gate full run needs per-page audio a
  synthetic pack lacks, and all real awaiting_review packs belong to real kids
  (must not be consumed) — W1 shares the same completeActivity → auto-submit
  funnel verified above.
- Founder handoff: plain-language result + 3 screenshots above + this entry.
  Specific asks for Phuong: (1) approve merge of claude/r2l-auto-save to main
  — this both removes the save funnel AND unblocks all kids stuck failing
  standard packs since 27/6; (2) optional 2-line copy refresh on
  read2lead.astro (lines 224/246 still say "bấm lưu chiến công" — protected
  positioning copy, left untouched); (3) after merge, consider telling
  affected kids their old packs will now save when reopened (auto-resume
  submits on lesson load). No QA hunting requested — flow self-verified.
- Verified commit: 94d6602 (tip of origin/claude/r2l-auto-save; preview
  https://claude-r2l-auto-save.felixbuilderhub.pages.dev)

### Acceptance criteria reconciliation (R2L-AUTO-SAVE-COMPLETION)

- Zero-click auto-submit after last activity (1700ms / 500ms mic-skip):
  PASS — live e2e on wrangler+KV; hint "Minny đang tự động lưu chiến công
  của con..." then completion card with no clicks.
- `#submit-confirm-modal` removed: PASS — deleted, regression test asserts
  absence; deployed bundle grep = 0 occurrences.
- `#lesson-continue` all-done branch calls submitLesson directly (manual
  fallback): PASS — code + test regex + observed enabled fallback state.
- `updateGlobalCta()` saving/fallback states: PASS — observed "Minny đang
  lưu chiến công..." (disabled) and "Lưu chiến công 💾" (enabled after
  simulated offline failure).
- Pending submit auto-retries on load with saved payload: PASS — simulated
  offline → reload → auto-resend → completion card; pending key cleared.
- Resumed all-done session auto-submits: PASS — observed three times,
  including localStorage-wiped + server-checkpoint fallback restore.
- Failed-pass / offline show toast + "Gửi lại" + re-enabled manual save:
  PASS — both branches observed live (failed-pass observed pre-server-fix,
  offline via injected fetch failure).
- Book/W1 flows unchanged, no double-fire: PASS for book (isBookLesson
  guards + book tests green; book packs route via isBookFlowV2 — new test);
  W1 SKIPPED for full live drive (deployed W1 story gate needs per-page
  audio the synthetic pack lacks; real packs belong to real kids) — W1 uses
  the same completeActivity funnel the trigger lives in.
- `tests/lesson-ux-regression.test.mjs` modal test rewritten: PASS.
- `node --test` passes: PASS — 730/730 (3 new legacy-client submit tests).
- No unrelated refactor: PASS — P0 server fix added under the AGENTS.md P0
  exception with a dated spec addendum (documented above), not silent scope
  creep.

- Status: complete
- Task ID: R2L-BOT-STATS-MANUAL
- Owner: Claude (spec + execute + review)
- Lane: admin tooling only (internal `/admin/codes` page; no kid/parent-facing
  surface, so the design-first mock rule doesn't apply)
- Problem: Phuong reported "no motivation for kids in the ranking." The
  Pilot/Ong bot-competitor system already exists (shipped commit 2ea625b) and
  is live in production, but both bots sit at Gold tier (39 and 19 completed
  packs) while 7 of 13 real kids have 0 completed packs — the bots are
  unreachable long-term targets, not a near-term rival for most kids. Phuong
  wants bots at "ALL ranks" but wants to set the exact rank/packs/coins
  herself rather than have Claude hardcode more preset numbers.
- Acceptance criteria: a new inline "Set bot stats" control appears in
  `src/pages/admin/codes.astro` for any code row where `is_test` or `is_bot`
  is true (rank_label_vi text input, completed_packs number input, coins
  number input, "Áp dụng" button with a confirm() guard, matching the
  existing `set-level` row-control pattern); it POSTs to the already-existing
  `/api/admin/codes/:code/set-bot-stats` endpoint (no backend changes) and
  refreshes the list on success; `tests/admin-set-bot-stats.test.mjs` covers
  the endpoint's reject/accept paths; `node --test tests/*.test.mjs` passes;
  no changes to `LEADERBOARD_BOT_PRESETS`, `apply-bot-presets.js`, or the
  existing "Sync bot (Pilot + Ong)" button; no unrelated refactor.
- Files owned: src/pages/admin/codes.astro,
  tests/admin-set-bot-stats.test.mjs (new)
- Stop condition: tests green (727/727), founder_check.py --gate build PASS,
  Phuong approved merge to main (2026-07-04) — done. She now creates/tunes
  bot accounts herself via the new control.

- Status: complete
- Task ID: R2L-PACK-BLOCK-CTA
- Owner: Claude (spec) -> aider-senior (execute) -> Claude (review)
- Lane: product (UI/copy, touches the protected "block generation until
  previous pack is done" invariant — same class of code as R2L-CLEAR-LESSONS-REFUND)
- Problem: when a kid tried to generate a new pack while an old one was
  unfinished, the block message read negatively (red error box) and the
  only way back to the old pack was a raw text URL to `/ho-so?code=...`,
  which required login + scrolling to the bottom of the profile page to
  find the real resume button.
- Acceptance criteria: `functions/api/generate-read2lead-pack.js` returns a
  positive-voice message (final wording per Phuong: "Bài của con sắp xong
  rồi! Con cần hoàn thành bài cũ trước khi mở bài mới nhé!") plus a new
  `lesson_link` field (`/read2lead/lesson?code=...&pack_id=...`) for the
  `previous_pack_needs_review` case only; both live UI flows (`/read2lead`
  via `read2lead.astro`, `/read2lead/build` via `build.astro` +
  `r2l-builder.client.ts`) swap the red error framing for a friendly/accent
  card with a working "Đọc tiếp bài cũ 📖" button wired to `lesson_link` for
  that case only; genuine errors keep today's red framing unchanged;
  `node --test tests/*.test.mjs` passes; no unrelated refactor. All met.
- Files owned: functions/api/generate-read2lead-pack.js,
  src/pages/read2lead/build.astro, src/scripts/r2l-builder.client.ts,
  src/pages/read2lead.astro, tests/read2lead-generate-gate.test.mjs
- Stop condition: tests green, Claude review clean (caught and fixed 3 bugs
  in the aider-senior diff: a DOM overwrite that would have erased the
  message text, a leaked cosmetic-stage timer, missing anchor-element
  typing), founder_check.py --gate build PASS, Phuong approved merge to
  main (2026-07-04) — done.
- Cost ceiling: none
- Design self-verification: N/A — no Claude Design mock for this task (positive
  block-message copy + a `lesson_link` resume field); wording approved by Phuong
  directly. Task completed + merged 2026-07-04, before this field existed.
- Founder handoff: N/A — completed and merged before this field existed
  (2026-07-06); Phuong approved the final wording and the merge to main in-flow.

## Acceptance criteria reconciliation

- none

## Earlier task history

- Status: complete
- Task ID: R2L-LESSON-CHECKPOINT
- Owner: Claude (spec) -> aider-senior (execute) -> Claude (review)
- Lane: product (bug fix, protected "lesson completion logic" invariant)
- Root cause: in-progress lesson state is 100% client-side (localStorage/
  sessionStorage) with no server fallback, so a kid loses all progress if
  browser storage is wiped between visits (private/incognito mode, in-app
  WebView like Zalo's browser, OS storage eviction, device switch) even
  though the existing background/pagehide save logic is correct.
- Acceptance criteria: new lightweight `current_pack.web_session_checkpoint`
  KV field written only via `functions/api/read2lead-checkpoint-save.js` on
  existing pagehide/visibilitychange/freeze flush points (no new listeners,
  no per-keystroke writes); read back for free via
  `functions/api/read2lead-lesson.js`; client falls back to it when local
  storage is empty; checkpoint stripped on pack submit (all 3 write sites
  in submit-read2lead-lesson.js); fully isolated from uses_remaining/rank/
  XP/lượt logic; node --test passes; no unrelated refactor.
- Files owned: functions/api/read2lead-checkpoint-save.js (new),
  functions/api/read2lead-lesson.js, src/pages/read2lead/lesson.astro,
  functions/api/submit-read2lead-lesson.js,
  tests/read2lead-checkpoint-save.test.mjs (new), plus targeted test
  additions to existing submit/lesson-flow test files
- Stop condition: tests green, Claude review clean, founder_check.py
  --gate build passes, Phuong approves merge to main
- See plan: /home/felixbuilderhub/.claude/plans/composed-exploring-galaxy.md

- Status: complete
- Task ID: R2L-CLEAR-LESSONS-REFUND
- Owner: Claude (spec) -> aider-senior (execute) -> Claude (review)
- Lane: product (bug fix, protected "lesson completion logic" invariant)
- Root cause: `DEFAULT_CLEAR_STATUSES` in `functions/api/_read2lead-clear-open-lessons.js`
  included `awaiting_review`, so the admin cleanup endpoint wiped freshly
  generated (lượt-already-spent) packs by default, not just stuck locks.
- Acceptance criteria: default clear only touches `generation_in_progress`;
  explicit clear of `awaiting_review` refunds `uses_remaining` (capped at
  `uses_total`); admin response reports refund count; node --test passes
  (existing buggy-behavior test corrected, new cases added); no unrelated
  refactor. All met.
- Files owned: functions/api/_read2lead-clear-open-lessons.js,
  functions/api/admin/codes/clear-open-lessons.js,
  tests/read2lead-clear-open-lessons.test.mjs
- Stop condition: tests green (709/709), Claude review clean,
  founder_check.py --gate build PASS, Phuong approved merge to main (2026-07-04) — done.
- Remediation of already-affected students (3 known codes + wider check):
  Phuong is handling manually herself, not part of this packet.

- Status: complete
- Task ID: R2L-PROGRESS-SAVE
- Owner: Claude
- Lane: product
- Acceptance criteria: visibilitychange and freeze listeners save lesson state on app background; node --test passes; no state shape changes
- Files owned: src/pages/read2lead/lesson.astro
- Stop condition: Three event listeners wired, tests pass, Phuong approves merge to main
