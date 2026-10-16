# Read2Lead Worker release runbook

Read2Lead production is TWO deployments that must stay on the same commit:

1. **Cloudflare Pages** project `felixbuilderhub` - auto-deploys on every push to `main`.
2. **Worker `read2lead-story-private-preview`** (the name is misleading, it IS production). It serves the
   kid and parent pages and APIs from its OWN asset bundle and its own server source, against Durable
   Object SQL. It is NOT built by the Pages builder and has no config file in the repo. Every Worker
   release is a *candidate directory* built by `scripts/r2l-release/build_candidate.py` and uploaded by hand.

A push to `main` alone does **not** change what children see on the gateway pages. Always do both.

The tool only **prepares and prints**. It never uploads or deploys. Upload and deploy are run by Elon.

## Files

| File | Purpose |
|---|---|
| `scripts/r2l-release/build_candidate.py` | Builds the new candidate from the previous live one, proves nothing protected changed |
| `scripts/r2l-release/build-env.worker.json` | The recorded `PUBLIC_*` env for the Worker's pages (currently EMPTY, see below) |
| `scripts/r2l-release/rehearse.mjs` (+ `rehearse-worker.template.mjs`) | Local synthetic rehearsal, network disabled |
| `tests/test_r2l_release_candidate.py` | Bite tests for the tool |

## The build env (read this before building)

The Worker's pages are built on a local machine. They do **not** get the Pages `PUBLIC_*` variables.
Verified 2026-10-16 by inspecting the live candidate (v98):

* compiled `_astro/flags.*.js` is `?v3=1`-gated (`PUBLIC_R2L_V3` **unset**),
* `data-r2l-w1-ssr="0"` and `data-r2l-v21-ssr="0"` (`PUBLIC_R2L_W1`, `PUBLIC_R2L_V21` **unset**),
* Clarity and Sentry ids are `undefined`.

Pages production, by contrast, has `PUBLIC_R2L_V3=1` and `PUBLIC_R2L_W1=1`. So the two surfaces differ,
and every v3-gated feature is OFF for kids on the gateway pages. **That is the current deliberate
state.** Turning v3 on is a separate, tested change that needs Phuong's sign-off: edit
`build-env.worker.json` for it, never as a side effect.

`build_candidate.py --build-env <file>` records this env in the proof and **cross-checks it against the
built `dist/`** (flags chunk, `data-r2l-*-ssr` markers). If you build with a different env than the file
says, the tool refuses. Reproducibility proof: building `bd3fcb7` with the empty env reproduced all
live pages and chunks byte-for-byte (0 changed assets in the dry run).

Build with every `PUBLIC_*` variable removed from the shell, and make sure no `.env*` file sets any:

```bash
cd <repo root, on the commit to release, clean tree>
ls -a | grep '^\.env'          # expect nothing that sets PUBLIC_*
(unset $(env | grep -o '^PUBLIC_[A-Za-z0-9_]*'); npm ci; npm run build)
```

## Release procedure

Releases come from a **clean commit that is already on `origin/main`** (or about to be, with Phuong's
approval). The Pages deploy and the Worker candidate must be the same commit.

1. **Pick the base.** The base is the candidate directory of the Worker version currently live, and the
   base config is that candidate's wrangler config.
   * First release after the takeover: base =
     `~/Documents/Codex/2026-09-20/read-and-execute-the-implementation-goal/work/theme-match-20261016/release/header-followup/candidate-v98`,
     base config = `.../header-followup/wrangler.production.json`.
   * Later releases: base = the previous `--out` directory, base config = its `wrangler.release.json`.
   * Confirm the base IS what is live: `npx wrangler@4.129.0 deployments list --config <base config>`
     (read-only) and compare the manifest hash: the base's `vars.R2L_PREVIEW_PACKAGE_SHA256` must equal
     the sha256 of `<base>/assets/__private/package.json`.
2. **Build `dist/`** with the recorded env (above).
3. **Build the candidate** (same filesystem as the base, because it hard-links; disk is tight, never copy):
   ```bash
   python3 scripts/r2l-release/build_candidate.py \
     --base <base candidate dir> --base-config <base wrangler json> \
     --repo <repo root> --out /home/felixbuilderhub/work/r2l-releases/v<N>-<date> \
     --build-env scripts/r2l-release/build-env.worker.json
   ```
   It refuses when: base or base manifest is missing, `--out` exists, `dist/` is missing or older than
   the HEAD commit, source dirs have uncommitted changes (`--allow-dirty` to override), the build env
   does not match `dist/`, a page references an `_astro` file that is missing or not in `publicAssets`
   (the v93 404 lesson, also checked through chunk imports), a protected file differs, or any base file
   moved or changed. On a failed run it deletes its own `--out`.
   Add `--full-verify` to also sha256 every base file before and after (about 45 s on the real 6 GB).
4. **Read `candidate-proof.json`** in the out dir: changed assets, added `publicAssets`/`scriptHashes`,
   changed server source files, `protectedFilesVerified`, and `warnings.localRefsNotInBundle` (non-`_astro`
   files a page references that the bundle lacks, advisory). Expect the changed list to match what you
   meant to ship, and nothing else.
5. **Rehearse locally** (synthetic accounts, simulated audio and grading, outbound network disabled):
   ```bash
   node scripts/r2l-release/rehearse.mjs --candidate <out dir> --repo <repo root>          # smoke check
   node scripts/r2l-release/rehearse.mjs --candidate <out dir> --repo <repo root> --serve  # prints a URL
   ```
   Screenshot with the printed URL at 390 / 768 / 1024 / 1280. Child code `R2L-SYNTHETIC-PHONE`, entry
   link `/r2l/start/?t=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`. Stop the server with SIGTERM.
   *Known dependency:* the synthetic data comes from Codex's `rehearsal-v90-fixture.mjs` (and its sibling
   `candidate-v90-inactive/` and `sky-release-proof.json`) in `~/Documents/Codex/.../production-release-20261015/`.
   Override with `--fixture`. Do not delete that folder until the fixture is vendored into this repo.
   Miniflare and esbuild are not repo dependencies; they are found in `node_modules` or the npx cache
   (override `--miniflare` / `--esbuild`). Nothing new is installed.
6. **Elon uploads** (creates a version, does NOT change live traffic):
   `npx wrangler@4.129.0 versions upload --config <out>/wrangler.release.json --message "R2L <sha8>"`.
   Record the printed Version ID. Only new/changed assets are uploaded (the rest are already stored).
7. **Verify the uploaded version** before it takes traffic (preview URL of the version, or the version-pinned
   header): every `_astro` file the home page loads returns 200; compare with the rehearsal.
8. **Deploy** (the production switch):
   `npx wrangler@4.129.0 versions deploy <VERSION_ID>@100% --config <out>/wrangler.release.json -y`.
   Production deploys need Phuong's explicit approval and a line in `_ops/AGENT_LOG.md`.
9. **Live checks** right after: run `_ops/scripts/wait-for-deploy.sh`-style checks (marker in HTML AND every
   referenced `/_astro` asset 200, never a single artifact); `GET /read2lead/` as the Testbot account only
   (never "Huy", a real student); confirm no 5xx in Worker observability for 10 minutes.
10. **Keep Pages and Worker on the same commit.** If the release includes anything under `functions/`,
    `src/`, `cloudflare/` or `schemas/`, the matching `main` commit must be deployed to Pages too, and
    vice versa. Record both in `AGENT_LOG.md`: commit sha, Pages deployment id, Worker version id.

## Changing the student voice grant (`--student-voice-grant`)

The student voice grant lives in TWO pinned places that must change together in one release:
`assets/__private/package.json` -> `studentRelease.approvedGrant`, and the Worker var
`R2L_STUDENT_VOICE_CONFIG` (its `budget`, `approvalSha256`, `pricingEvidenceSha256`). Normally the tool
refuses any manifest change except `publicAssets`/`scriptHashes`. Pass the founder's approval file to make
the one exception, and only then:

```bash
python3 scripts/r2l-release/build_candidate.py <the usual flags> \
  --student-voice-grant ~/work/repos/_ops/approvals/<APPROVAL>.json
```

Use it only when a new founder-approved grant (a `read2lead-voice-approval-v1` file) must go live: moving
from the expiring batch grant to the standing monthly pool, or changing the pool's cap. Do NOT use it on an
ordinary release; without the flag the manifest and var are carried over unchanged.

What it does: requires `format: read2lead-voice-approval-v1` and a budget that is exactly
`{scope: pool, poolId: r2l-student-pool, approvedVoiceMicroUsd <= 15000000, maxTurns: 32}` (anything else
is refused: batch budgets, extra keys, a higher cap); sets `approvalSha256` to the sha256 of the approval
file's exact bytes; replaces only `approvedGrant` in the manifest and only those three fields in the var
(`packageSha256` points at the manifest's `sourcePackageSha256`, which is untouched); re-pins
`R2L_PREVIEW_PACKAGE_SHA256`; still asserts every other manifest key and `__private` file is unchanged;
then runs the candidate's own JS loader (`check_student_grant.mjs`, needs `node`) against the result with the
clock set to 2031 and fails unless it reports enabled. `candidate-proof.json` records
`studentVoiceGrant: {approvalFile, approvalSha256, budget, previousApprovalSha256, loaderCheck}`.
The approval file must stay byte-for-byte as approved: editing it changes the hash.

## Rollback

Deploy the previous version id again:
`npx wrangler@4.129.0 versions deploy <PREVIOUS_VERSION_ID>@100% --config <config> -y`
(find ids with `deployments list`). As of 2026-10-16 the version before v98's `97b4bceb` is `f22afb18`
(source `9dac598`); then `838b061c`; then `959d446c`.

**Never roll back to a pre-SQL version: Worker `c98c2283` or Pages `fb68ea38` (or anything older).** Those
read the stale KV store; the Durable Object SQL is the only authoritative student data. Also never "roll
back" by unsetting `R2L_ACCOUNT_MODE`, never re-run the KV to SQL migration, never restore a KV backup
over SQL.

## Protected content (why the tool is built the way it is)

* `assets/__private/` holds every story package, book part, media file and ILLUSTRATION. It must never be
  lost or altered. The tool hard-links the base into the new candidate, replaces only files it must (by
  writing a fresh file and renaming over the link, never writing through it), and then asserts every
  `__private` file except `package.json` is the same file/bytes as in the base, and that every manifest key
  except `publicAssets` and `scriptHashes` is unchanged.
* The manifest's sha256 is pinned in the Worker config (`vars.R2L_PREVIEW_PACKAGE_SHA256`); the tool
  rewrites it. Every new `_astro` chunk must be listed in `publicAssets` or it 404s; the tool adds them.
* **Disk and hard links:** a candidate costs almost no disk because it shares files with its base. The
  Codex folder holds the only other names for those files. Do **not** delete the base candidate AND the new
  one; deleting the base alone is safe (the data lives on through the new links), deleting every link
  destroys the content. Before anyone cleans up `~/Documents/Codex/`, make sure the current live
  candidate is held somewhere else too.
* Server source: files present in the base are replaced from the repo; files the worker's import graph now
  needs but the base lacks are added; base-only files are kept (all listed in the proof).

## Tests

```bash
python3 -m unittest tests/test_r2l_release_candidate.py -v   # tiny synthetic base, runs in about 1 s
npm test                                                     # JS suite; Python tests are run separately (as for tests/test_*.py)
```
