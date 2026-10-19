# Paste this into Claude Code (in the felixbuilderhub repo)

> Unzip `read2lead-dao-phieu-luu-handoff.zip` somewhere outside `src/` (e.g. `_design/read2lead-dao-phieu-luu/`) first.

---

I'm handing you an approved visual redesign of the Read2Lead kid screens, called "Đảo phiêu lưu". The design handoff is in `_design/read2lead-dao-phieu-luu/`. Read `README.md` first, then `SCREENS.md`, and look at the PNGs in `screenshots/`.

Ground rules:
- Read2Lead is in maintenance-only mode (`.founder-os/products/read2lead/CONTROL.md`). I am giving the go-ahead for this redesign. Even so, write a spec in `_ops/specs/SPEC_R2L_DAO_PHIEU_LUU.md` and show it to me before changing any code.
- This is a visual, layout, motion and tone change only. No new features, no data or API changes, and every element and action that exists today stays.
- `lesson.astro` and the recorder/mic/speaking-check scripts are protected. Restyle them through CSS and wrappers only. Do not change their logic or the completion flow.
- Vietnamese UI copy only. Keep the existing wording. The new strings listed in README §7 need my approval.
- Every animation must have a reduce-motion still version.
- `node --test` must pass before every push. Never push `main`; work on a branch.
- After each screen, render it on the deployed preview. Screenshot it at 390 and 1280 and compare it with the matching PNG in `screenshots/`, looking at the whole screen. Tell me the result.

Start with step 1 of README §8: tokens, self-hosted fonts and shared component classes. Then do the kid home. Ask me before deciding anything README §7 marks as a placeholder.
