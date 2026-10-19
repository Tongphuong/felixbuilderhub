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
  (Steve); `tests/design-tokens.test.mjs` requires identical token values and byte-identical fonts
  (it skips only while those files do not exist yet).

## Running the harness
```
node scripts/design/fidelity.mjs \
  --design _design/read2lead-dao-phieu-luu \
  --contracts ../../_ops/specs/design-contracts/r2l-island \
  --base http://127.0.0.1:4321 \
  --out /path/to/out \
  [--only home-first-visit] [--state-driver ./my-driver.mjs] \
  [--token <magic-link-token> | --login-url <url>] [--chrome <path>] [--composites all|fail]
```
Needs Chrome (`CHROME_PATH`, `--chrome`, or a standard install) and `playwright-core`.
Exit 0 = all pass, 1 = a check failed, 2 = usage/infrastructure error (a crash is not a verdict).
Output in `--out`: `<contract>-<width>.png` (design | built | diff, title bar PASS/FAIL),
`report.json`, `report.md`.

To get a built site to test: `npm run build`, then serve it with the Worker rehearsal
(`node scripts/r2l-release/rehearse.mjs --candidate ~/work/r2l-releases/<release> --repo . --serve`),
which prints a local URL and the synthetic magic link
`/r2l/start/?t=` + 32 x `b` (pass the 32 b's as `--token`).

### State drivers
`--state-driver <module>` default-exports `async (page, contract, base, {width, designDir, opts})`
and must leave the page in `contract.built.state` or **throw** (a throw is recorded as FAIL).
`drivers/default.mjs`: magic-link login + navigate to `built.path`. Reward and rank-up are TODO
hooks that throw "not implemented" until the next packet fills them in; first-visit / mid-story /
empty only navigate (the fixture account decides the state; TODO in the file).
`drivers/mock-self.mjs` loads the mock itself (calibration; `DESIGN_PERTURB=tiny|shift`).

## What each check means
Everything runs with `prefers-reduced-motion` emulated, at width x the contract's viewport height.
| Check | Fails when |
|---|---|
| state-driver | the driver could not reach `built.state` |
| order | an `order` id (`[data-design="..."]`) is missing, hidden, or out of order. Single-column widths: DOM order AND top-to-bottom. Widths where `layout.columns > 1`: DOM order only. Ids in `optional` may be absent. |
| texts | a `texts` / `texts_<w>` string is not in the visible text (`innerText`, whitespace collapsed, NFC, case-sensitive). `data_bound` strings are not checked. |
| primary | not exactly one `[data-design=<primary.id>]`, not visible, text lacks `primary.text`, or height < `min_height[w]`. Also exactly ONE visible interactive control (`a, button, [role=button], input[type=submit]`) may have the sun fill `#FFC83D` (+-6 per channel on the background), and it must be the primary or inside it. Non-interactive sun fills (bars, badges, tags, tiles) are allowed. |
| columns | visible `[data-design-col]` count != `layout[w].columns` |
| contrast>=4.5 | a visible text element's colour vs its effective background < 4.5:1 |
| tap>=48px | a visible `a, button, input, select, textarea, [role=button]` is under 48px tall |
| reduced-motion | a CSS/Web animation is still `running` with reduce-motion emulated |
| no-h-scroll | page is wider than the viewport at 360/390/768/1024/1280 (checked once per contract) |
| pixel-diff | pixelmatch (threshold 0.1) differing fraction between mock and built screenshot > `diff_ceiling[w]` |

## Known limits
- Contrast is an approximation: it stacks ancestor `background-color`s (opacity of the text chain
  applied to the text only). Text over a gradient or `background-image` is **not measured** (reported as
  a warning count), SVG text is skipped, text over `<img>`/video is not measured, and large-text relaxations are not applied (4.5 everywhere).
- `innerText` applies CSS `text-transform`; clipped (`overflow:hidden`) or off-screen-scrolled text still counts as visible.
- Order/visibility use computed style + bounding boxes, not hit-testing, so an element covered by another one still counts as visible.
- Pixel diff is strict about reflow: sample data that differs from the mock (names, numbers, one longer line) moves everything below it. Drive fixtures with the mock's sample data where possible.
- It only sees the state the driver reaches; unreached states are FAIL, not skipped.
- Mock and built are rendered in the same Chrome, at DPR 1, animations disabled; fonts that fail to load in the mock abort the run.

## Tests
- `tests/design-lock.test.mjs` (fast) - manifest + bite on a scratch copy.
- `tests/design-tokens.test.mjs` (fast) - token/font equality + bite.
- `tests/design-fidelity.test.mjs` (~30 s, launches Chrome) - 17 synthetic pages, each isolating one check
  (must fail exactly that check; the good ones must pass), real mock vs itself = 0 px diff.
  Opt-in `DESIGN_BITE_NAVY=1` (or `scripts/design/bite-navy.sh`): today's navy home must fail the real contract.
  No Chrome = the test FAILS (rule 28b); `DESIGN_NO_BROWSER=1` skips explicitly.
