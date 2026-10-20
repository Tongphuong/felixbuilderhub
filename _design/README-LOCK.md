# Design lock — R2L-ISLAND ("Đảo phiêu lưu")

`_design/read2lead-dao-phieu-luu/` is the approved Claude Design handoff, copied byte for byte
from `read2lead-dao-phieu-luu-handoff.zip`. **Do not edit anything in it.**
`MANIFEST.sha256` lists all 94 files; `tests/design-lock.test.mjs` fails if any file is changed,
added or removed. A new design = a new folder + a new manifest, decided by Elon/Phương.

`_design/` is outside `src/` and `public/`, so Astro/Vite neither build nor serve it
(the lock test also asserts `dist/` has no `_design`).

## Who owns what
- **Locked design** (`_design/...`): frozen. Changes need Elon + Phương.
- **Screen contracts**: `_ops/specs/design-contracts/r2l-island/*.json`, owned by **Elon**, outside
  this repo so builders cannot edit them. Schema: that folder's `README.md`. Buffet confirms the
  contract diff in a builder's branch is empty.
- **Harness** (`scripts/design/`) and its tests (`tests/design-*.test.mjs`): Mark.
- **Tokens/fonts in the product**: `src/styles/r2l-tokens.css` and `public/fonts/r2l/*.woff2`
  (Steve). `tests/design-tokens.test.mjs` requires each design token declared exactly once, in a
  top-level `:root`, with an identical value, and byte-identical fonts. These guards skip only until
  the first screen lands: they FAIL when `DESIGN_TOKENS_REQUIRED=1` or any `data-design` attribute
  exists under `src/`. It also fails on any other declaration of a design token in `src/**`,
  `public/**` or the built `dist` CSS/HTML (`var(--r2l-x)` uses are fine).

## Running the harness
```
node scripts/design/fidelity.mjs \
  --design _design/read2lead-dao-phieu-luu \
  --contracts ../../_ops/specs/design-contracts/r2l-island \
  --base http://127.0.0.1:4321 \
  --out /path/to/out \
  [--only home-first-visit] [--state-driver ./my-driver.mjs] \
  [--token <magic-link-token> | --login-url <url>] [--chrome <path>] [--composites all|fail] \
  [--require-anchors] [--concurrency N]
```
Needs Chrome (`CHROME_PATH`, `--chrome`, or a standard install) and `playwright-core`.
Exit 0 = all pass, 1 = a check failed, 2 = usage/infrastructure error (a crash is not a verdict).
Output in `--out`: `<contract>-<width>.png` (design | built | diff, title bar PASS/FAIL),
`report.json`, `report.md`.

To get a built site to test: `npm run build`, then serve it with the Worker rehearsal
(`node scripts/r2l-release/rehearse.mjs --candidate ~/work/r2l-releases/<release> --repo . --serve`),
which prints a local URL and the synthetic magic link
`/r2l/start/?t=` + 32 x `b`. Pass that token as `--token` ONLY with the default driver. **Do NOT pass `--token` with
`drivers/r2l.mjs`**: that driver picks its own per-state account and login, and a forced token logs every home contract in as the
same child, so mid-story falsely reports "Mở truyện" instead of "Đọc tiếp".
Never `cp` onto a file inside a `cp -al` hard-link copy of a release (it writes through the link into every release sharing the inode:
the 2026-10-19 22:06 incident). `rm` the file first, or build the candidate with `build_candidate.py`, which ships the library
files with replace semantics.

### State drivers
`--state-driver <module>` default-exports `async (page, contract, base, {width, designDir, opts})`
and must leave the page in `contract.built.state` or **throw** (a throw is recorded as FAIL).
- `drivers/default.mjs`: magic-link login, navigate to `built.path`, then VERIFY the state (logged in:
  a "Chào <name>!" heading and no code-entry form; first-visit shows "Mở truyện", mid-story "Đọc tiếp",
  empty "Mở thư viện", and the other states' labels are absent). Reward and rank-up are TODO hooks that
  throw "not implemented". Forcing the state on the fixture account is still a TODO (it is verified only).
- `drivers/r2l.mjs` (use this for the real screens): reaches first-visit / mid-story / no-story / reward / rank-up on the rehearsal
  Worker and makes the page render the MOCK SAMPLE DATA (`fixtures/mock-sample.json`: Minh, 55 diamonds, Bạc ★★, streak 3,
  the Hoang/Hieuenzo/Percy boards, "The Sky Is Blue!", reward +35/+20). Each account API response is fetched from the real
  server first and only VALUES are replaced, so shapes stay real and the page's own code renders them. Real avatars remain the one
  data difference. Each state's marker (primary label) is asserted. The rehearsal's own "LOCAL REHEARSAL" banner is hidden.
  - REAL account state, through the rehearsal API, one synthetic child per state so concurrent contracts never collide:
    first-visit = a generated pack never opened (THIRD); mid-story = a pack with an opened session and `audio_started` (FOURTH);
    reward = a full mission driven to completion (DESKTOP); rank-up = FOURTH's opened lesson page (see below).
  - FABRICATED, and only here: **no-story** (the rehearsal would generate a story, so the generate call is answered with the real
    503 the live site gives), plus the VALUES listed above (name, diamonds, streak, rank ladder, leaderboards, reward numbers, the
    pack's title/level) inside real response shapes.
  - **Rank-up uses the product's own code**: on the lesson page opened with `?v3=1`, the driver calls `window.__r2lV3.showRankUp`,
    which runs the product's `showRankUpModal` and fills the real modal. Nothing is written into the modal by the driver; the page
    BENEATH the overlay is hidden because it is out of scope for the screen under test. LIMITS, plainly: the real trigger is a lesson
    submit response containing `rank_up` (lesson.astro, `_r2lTriviaState.pendingRankUp`), and the story-mission flow never produces
    one; there is no stored "last-seen rank" to seed. So the driver calls the product's exported hook directly instead of replaying a
    completed submit. The modal says "Con" instead of the child's name because the hook passes no kid name.
  - **Re-runs / statefulness:** the driver is IDEMPOTENT against a rehearsal server that has already been used. It never resets or
    restarts the server: accounts that already hold a pack are reused (nothing is generated twice), a `previous_pack_needs_review`
    answer from the generator is resolved to the pack it names, and a completed mission is not replayed. To start from clean state,
    restart the rehearsal server yourself.
  - `--sample <json>` swaps in another sample (`fixtures/mock-sample-alt.json`: every value differs). With `--binding-only` the
    harness runs ONLY the state driver and the `data-binding` check: the page must show the alternate values, and the mock's old
    values must be gone, so a hard-coded "Minh" or "55" fails. Run it as a second pass over every home and reward contract.
- `drivers/mock-self.mjs`: loads the mock itself (calibration; `DESIGN_PERTURB=tiny|shift`).
- `drivers/goto-path.mjs`: only navigates (the harness's own synthetic pages; never for real screens).

## What each check means
Everything runs with `prefers-reduced-motion` emulated, at width x the contract's viewport height, but
screenshots are FULL-PAGE on both sides, so anything below the fold is compared.

| Check | Fails when |
|---|---|
| state-driver | the driver could not reach, or could not verify, `built.state` (see above). A wrong state fails here, never as "missing ids". |
| order | an `order` id (`[data-design="..."]`) is missing, hidden, smaller than 40x24px, or out of order. Single-column widths: DOM order AND top-to-bottom. Widths where `layout.columns > 1`: DOM order only. Ids in `optional` may be absent. |
| texts | a `texts` / `texts_<w>` string is not in the VISIBLE text. Text NODES are walked (never innerText, alt, aria-label or placeholder). A node counts only if it is displayed, has effective opacity > 0, font-size >= 12px, a box inside the document, is not clipped away (overflow / clip / clip-path), and its colour differs from its background. Case-sensitive, whitespace collapsed. `data_bound` strings are not checked. |
| primary | not exactly one `[data-design=<primary.id>]`, not visible, its visible text lacks `primary.text`, or height < `min_height[w]`. ALSO exactly ONE visible clickable thing may be sun-filled (`#FFC83D` +-6/channel, or a gradient whose stops are mostly sun). Clickable = `a, button, summary, [role=button\|link], input[type=submit\|button\|reset]`, anything with `onclick`, or a `cursor:pointer` element that receives a click (hit-tested). It must be the primary (or inside / around it). Non-interactive sun fills (bars, badges, tags, tiles) are allowed, and so are SELECTED toggles (the mocks paint the active tab, category and option tile sun): `[role=tab|option][aria-selected=true]`, `[aria-pressed=true]`, `[aria-current]`, checked radio/checkbox/switch controls. An unselected sun toggle still counts as a second action. |
| columns | visible `[data-design-col]` count != `layout[w].columns` |
| contrast>=4.5 | a visible text item (HTML and SVG `<text>`) is under 4.5:1. Plain-colour backdrops are computed from the DOM; where an ancestor has a gradient/image, or for SVG text, the backdrop is SAMPLED from the screenshot (dominant colour in the text box, ignoring glyph-coloured pixels). Also fails if more than 3 items, or more than 10% of the measured items, cannot be measured at all. |
| tap>=48px | a visible `a, button, input, select, textarea, [role=button]` is under 48px tall |
| reduced-motion | (1) a CSS/Web animation is still `running`; (2) any element has a CSS `animation-name` other than `none` with a non-zero duration (zero-duration fades pass; contract field `reduced_motion_allow: [names]` exempts named ones); (3) full-page samples at t0, +600 ms and +~370 ms: the last two must be pixel-identical (catches JS/rAF/video motion; a page that merely settled after the first sample passes). |
| fonts | headings (h1-h6) and the primary/secondary buttons (`.btn`, `.r2l-btn`, `[data-design$=".primary"]`, `[data-design$=".secondary"]`) do not resolve to Baloo 2, `p`/`li` text to Nunito (tabs, chips and text links are not checked: the mocks set Nunito on them), or `document.fonts` does not report both families loaded (none errored). |
| no-h-scroll | page is wider than the viewport at 360/390/768/1024/1280 (once per contract). An overflowing page is cropped to the viewport width before diffing. |
| geometry | (only when the contract has `anchors`) a built section's top, height or width is off the mock's. |
| data-binding | Runs AUTOMATICALLY in a normal run. When the driver offers an alternate sample (`altSample`), a second pass loads the page with it: every alternate value must show and none of the mock's values may remain (a hard-coded "Minh" or "55" fails). A contract that lists `data_bound` values but whose driver offers no alternate sample FAILS as "binding not run". EVERY `data_bound` value must be either BOUND (covered by one of the driver's expectations: the alternate sample changes it and the new value shows / the old one is gone) or declared in the contract's `unbound` map `{"<value>": "<reason>"}` with a non-empty reason; anything in neither FAILS as "data_bound value not bound and not declared unbound", and an `unbound` entry without a reason fails too. A driver that gives no expectations therefore cannot read as a pass. (Coverage = equal strings, or one contains the other when it is 3+ characters.) A `data_bound` value is only required at a width whose MOCK shows it (the pending gift exists only in the 1280 mock). Expectations are matched as TOKENS, never inside a longer number or word ("200 kim cương" is not in "1.200 kim cương", "Quyển 1" is not in "Quyển 10", "#1" is not in "#11"). (`--binding-only` still runs just this pass.) |
| region:<id> | see "Regions" below. |
| anchors-present | (only with `--require-anchors`) the contract has no `anchors`, or an `order` id (not in `optional`) has none. |
| height | the built page is taller than the mock by more than max(10%, 120px). The shorter side is padded with its own background colour, so extra or missing area counts in the diff. |
| pixel-diff | pixelmatch (threshold 0.1) differing fraction over the full padded page > `diff_ceiling[w]` |
| still-twin | (runs before anything that hides/unhides elements, which re-rasterises the page) adding the `still` class to `html`, `body` and every `.r2l` changes the built render at all. Runs BEFORE the width cycle below (a viewport cycle re-rasterises edges and used to make it fail falsely, 60-70px on reward@390). |
| layout-sanity | the mocks exist only at 390/1280, so the BUILT page is checked at 360, 768, 1024 and the contract's own widths, in the same state (once per contract): (a) the INK boxes of two text lines of different text nodes overlap by more than 1px (ink = the baseline plus the real ascent/descent of that text in that font, from canvas `measureText`; a font-size fallback of 90% if the metrics are missing; so a tight line-height does not false-alarm but a 5px collision fails; clipped `.sr-only` text is ignored; `clip` is honoured only on absolute/fixed boxes of 2px or less); (b) a control (`a, button, input, select, textarea, summary, [role=button]`) or `[data-design]` element sticks out of its nearest card (an ancestor with a border or background) by more than 2px, unless it or its card matches the contract's `overflow_allow` (data-design ids or CSS selectors); (c) a line break falls inside a word; (d) text is cut off by `overflow:hidden|clip`. `text-overflow: ellipsis` is allowed for ordinary content (a data-bound name in a list) but is an OFFENDER when the element is a `[data-design]`, an interactive control, or contains one of the contract's `texts` / primary strings. Each offender (selector + width) is listed in `report.md`, and a screenshot of each failing width is saved as `<contract>-layout-<width>.png`. |

### Contract fields the harness reads (beyond the contracts README)
- `anchors` (optional; required by `--require-anchors`): `{ "<data-design id>": "<a text string that appears inside that section of the MOCK>" }`.
  The harness finds the first visible text node in the mock containing that string, walks up to the nearest block
  ancestor that is a card or section (has a border, a background colour/image, or is >= 60px tall) and takes its box.
  The built `[data-design=id]` element must have: top within +-max(24px, 4% of the mock page height), height within +-30%,
  width within +-15% (at widths <= 430 a built width >= 90% of the viewport also passes). Ids in `optional` may be absent.
  Choose a string whose nearest card IS the section (a heading inside it).
- `anchors_exempt` (optional): `{ "<id>": "<reason>" }`. Under `--require-anchors` an order id passes `anchors-present` if it is
  anchored OR exempt with a non-blank reason. An id in both is a contract error (exit 2). Exempt ids and reasons are printed in
  `report.md`; a contract with every order id exempt reports "geometry: pixel-only".
- `anchors_<w>` / `anchors_exempt_<w>` override the base maps at that width only; in `anchors_<w>` a `null` value removes the base
  anchor for that width (same for `anchors_exempt_<w>`). Both-at-one-width (after merging) is exit 2, and so is a key for a width
  with no mock. `report.md` shows the maps as in force at each width, plus the resolved mock boxes.
- `capture: "viewport"` (optional): single-screen snapshots and overlays. Both sides are screenshotted at the viewport size only,
  the `height` check is skipped, and order/size/geometry ignore elements wholly outside the viewport.
- `regions` (optional): `[{ "id": "rankup.monster", "mock_box": { "390": [x, y, w, h] }, "ceiling": 0.15 }]`. For each region the
  MOCK is cropped at `mock_box`, the BUILT page at the `[data-design=id]` element's box (resized to the mock box size), and the
  built crop FAILS as "region empty" when blank or uniform (luminance stddev < 4), and when its pixel diff exceeds `ceiling`.
  Results appear per region in `report.md` and under the composite. A region has its own check, `region:<id>`.
- `min_size` (optional): `{ "<id>": [w, h] }` overrides the default 40x24 minimum of an `order` element.
- `unbound` (optional): `{ "<data_bound value>": "<reason it cannot be bound>" }`, e.g. product-owned catalogue values.
- `overflow_allow` (optional): `["<data-design id or CSS selector>", ...]`, elements or cards allowed to overflow by design (layout-sanity b and d).
- `reduced_motion_allow` (optional): animation names exempt from the `animation-name` rule.
- Width-keyed fields must agree: `mock`, `viewport`, `diff_ceiling` (and `reference` if present) list exactly the same widths;
  `order_<w>`, `texts_<w>`, `layout` and `primary.min_height` may only name those widths. Otherwise the harness exits 2.

## Viewport capture (`"capture": "viewport"`)
Single-screen snapshots and overlays. Both sides are screenshotted at the viewport size only (no full page), and there is no
`height` check. A section may sit below the fold ONLY if the MOCK has it there (known from its `anchors` or `regions` mock box);
any other id that the build pushes below the fold or off-screen FAILS as "pushed below the fold", in `order`, `geometry` and (for the
primary) `primary`. An id with no known mock position must therefore be on screen.

## Regions are anti-blank guards, not fidelity
A region compares one mock box with the built `[data-design=id]` element. Its `ceiling` is deliberately loose: it exists to catch a
blank or missing subject, not to judge looks (the whole-screen `diff_ceiling` and the human review judge looks). A region fails when
(0) hiding its element changes less than `min_own_pixels` (default 0.5%, own-pixels check, below),
(1) the built crop is uniform (luminance stddev < 4), (2) its EDGE ENERGY (mean Sobel magnitude) is below `EDGE_MIN_RATIO` = 50% of
the mock crop's, which catches an emptied box that still shows backdrop rays, or (3) the diff exceeds `ceiling`. Calibration on the
real rank-up screen: real avatar 95% / real shield 85% of the mock's edge energy; an emptied shield box 10%; an emptied monster box
0% (uniform). The per-region override is `min_edge_ratio`. Mock monsters are stand-in PNGs, so monster regions need a high ceiling.

## Own pixels: the check that catches an empty monster box
Edge energy cannot always tell a blank box from a real subject: where the box also holds backdrop edges (the home monster box at 390
contains the speech bubble and hills; the reward starburst) a blank box still scores 80%+. So every region also hides its own element
(`visibility:hidden` on `[data-design=id]` and its subtree) and counts how much of the box changes. An element that renders nothing
changes 0% whatever the backdrop is. Calibration on the live release-1 build (real avatar vs element hidden): home.monster 37-43% vs
0%; rankup.monster 43% vs 0%; reward.monster 41-43% vs 0%; rankup.shield 48%. Default minimum 0.5% (a text-only element is only a few percent of its box; an empty one is exactly 0); recommended `min_own_pixels: 0.10`
for monster regions. Edge-ratio calibration, same builds: rank-up monster real 0.95 vs blank 0.00, shield 0.88 vs 0.10 (so the default
`min_edge_ratio` 0.5 is right); home monster at 1280 (tight box [85,274,210,210]) 1.24 vs 0.45 (use 0.8); home monster at 390 and the
reward monster do NOT separate by edges (1.7-2.0 vs 1.7; 0.9 vs 1.1), so rely on own pixels there (set `min_edge_ratio: 0.3` to avoid false fails).

## Release-2 driver states
`drivers/r2l.mjs` also reaches `companion`, `leaderboard-xp`, `library` and `shop-goal` (contract `built.state`; the page is opened as
`built.path?code=<child>` for the THIRD synthetic child, whose real pack is today's story "The Sky Is Blue!"). All values are replaced inside
the REAL response shapes (fixtures `mock-sample.json` / `mock-sample-alt.json`, sourced from mocks 05-08):
- leaderboard: `GET /api/read2lead-leaderboard` -> the full 11-row XP board, the sample child at #8 with `is_self` ("Con đây!"); the other tab keeps the home sample.
- library: `GET /api/read2lead-library` -> `books` / `stories` / `counts` (stories carry `audio[]` non-empty = "Có bài nghe"); counts 48 stories / 6 books.
- shop: `POST /api/read2lead-gifts-list` -> `items`, `diamonds` 55, `redemptions` and `gift_goal` = the 120-diamond gift at 46%. Matches the mock: ONE received card (the delivered gift is left out of `items`, so it is not also an ordinary card) and the pending card only at 1280; prices are expected only on ordinary cards.
- companion: `POST /api/read2lead-shop` -> the child's name/wallet; the driver then clicks the "Mũ" category and "→" once (option 2) and does NOT save.
What the alternate-sample pass binds, by screen: home = greeting, wallet, streak, rank chip ("Bạc ★★" = label_vi + stars), "Sắp lên {next_label_vi}", the "N / M ★" line, story title, level tag (first visit only), both boards' names and numbers; reward = title, +diamonds, +XP; rank-up = the new rank label; leaderboard = names, #1..#11 and "N XP"; library = titles, "Quyển M · Bài N", the book chips and the count string; shop = wallet, goal price / percent / remaining, every gift's name and price, "Còn thiếu N kim cương", "Sắp đổi được!" and the delivered / pending / set-as-goal strings. The reward title is rewritten wherever the real pack title appears in the progress and session responses. Not bindable by the alternate sample (declare them `unbound`): the story page count ("6 trang") and the mid-story page position ("trang 3 / 6"; no such field in the responses), "340 / 400 XP" (the build shows the real star counts instead), the companion option lists, and the library's "Đã đọc" / level / audio-availability strings.
LIMITS, plainly: the option lists (hats, "N / 21") and the library's "Đã đọc" status come from the product's own code/state, not from a response the
driver can reshape, so they are asserted only as visible markers ("2 / ", "Chưa lưu", "Truyện hôm nay"), not bound to the alternate sample. The drivers
were written against the release-1 page flow; they are verified end to end only once the Release-2 pages exist.

## Known limits
- Contrast outside plain backgrounds relies on sampling: text over a photo or busy gradient is judged against the most common
  non-glyph colour in its box, which can be off for noisy backgrounds. Opacity on ancestors is applied to the text colour only.
  No large-text relaxation (4.5 everywhere).
- The text check sees text nodes. Text drawn into a canvas or image is not text. A covered element (z-index overlap) still counts
  as visible (no hit-test for text).
- Geometry compares boxes, not content: a box of the right size and place with the right text but a wrong inner layout is caught
  only by the pixel diff.
- Pixel diff is strict about reflow: sample data that differs from the mock (names, numbers, one longer line) moves everything
  below it. Drive fixtures with the mock's sample data where possible.
- `cursor:pointer` clickables are found by a hit test at the element's centre; delegated click handlers on `document` with no
  `cursor:pointer` or `onclick` are invisible to it.
- It only sees the state the driver reaches; unreached states are FAIL, not skipped. The default driver verifies a state but does
  not yet force it (the fixture account decides).
- The real mocks are fixed-width, so mock-vs-itself fails `no-h-scroll` at 360px, and two mocks (home-empty, rank-up) are not
  perfectly identical between reduced-motion and `.still`; those checks judge the BUILT page, which must do better.
- Mock and built are rendered in the same Chrome, at DPR 1, animations disabled; fonts that fail to load in the mock abort the run.

## Tests
- `tests/design-lock.test.mjs` (fast): manifest + bite on a scratch copy.
- `tests/design-tokens.test.mjs` (fast): token/font equality, override scan, skip-expiry, each with a bite test.
- `tests/design-fidelity.test.mjs` (~35 s, launches Chrome): ~50 synthetic pages, each isolating one check (must fail that check;
  the good ones must pass), the state-verification driver, contract width validation, real mock vs itself = 0 px diff.
  Opt-in `DESIGN_BITE_NAVY=1` (or `scripts/design/bite-navy.sh`): today's navy home must fail the real contract.
  No Chrome = the test FAILS, unless `CI` is set (then it skips with an explicit message). GitHub's ubuntu-latest runner image
  ships google-chrome (`/usr/bin/google-chrome`) and `ci.yml` does not install it, so the test runs there.
