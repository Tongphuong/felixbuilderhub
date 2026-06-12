# AGENTS.md — Hard rules for Codex & Cursor (felixbuilderhub / hub)

> **This file is the source of truth for how AI coders behave in this repo.**
> Claude owns this file. If a rule is wrong, Phương/Claude edits HERE — do not argue with it in chat.
> Codex reads `AGENTS.md` automatically. Cursor: read this file first, every task.

---

## 0. Who does what (do not cross these lines)

| Role | Owns |
|---|---|
| **Claude** | Architecture, specs, roadmap, 5-lens audits, reviewing your commits. |
| **Codex / Cursor (you)** | Implement an existing Claude spec, exactly. Run tests. Commit. Report. |
| **Phương** | Final decisions, money/economy values, asset/voice/UX picks, manual test. |

**Golden rule:** You implement specs. You do **not** invent systems. If there is no written spec for the task, **STOP** and tell Phương "cần Claude viết spec trước" — do not improvise rank tiers, coin prices, shop economy, new activity types, or new data schemas.

---

## 1. Only execute work that is marked READY

- Read `docs/ROADMAP_GAMIFICATION_2026-06-09.md`.
- Execute only phases/tasks marked **READY** (a full spec exists).
- Tasks marked **SCOPED — NEEDS SPEC** are NOT cleared for coding. You may read/plan but must not finalize.
- When idle / Phương is away (rate limit), pull from the **STANDING BACKLOG** in the roadmap — those are pre-approved, low-risk, fully specified.

---

## 2. Protected invariants — DO NOT touch without a Claude spec

- **Minny voice (M0):** xưng "Minny"/"con"; no red/"sai"/FOMO; 1-2 câu; tiếng Việt chính; khen effort không khen rank. Any Minny copy you add must follow this.
- **R2L positioning:** lesson/hero copy stays **functional** (bài tập, từ vựng, tự học). No USP/personalization hype/anti-competitor copy.
- **Lesson completion logic** in `src/pages/read2lead/lesson.astro` (the repair of activity-complete → CTA enable → submit). Don't refactor it casually.
- **The mic flow** (`public/scripts/r2l-mic-check.js`, the warmup countdown, `_r2lStartRecording`). It was hard-won. Change only to a spec.
- **Backend contract:** the pack JSON shape the hub reads. Don't rename fields the lesson renderer depends on.

If a task seems to require touching these, flag it — Claude will spec it.

---

## 3. Scope discipline

- One logical change per branch and per commit. No drive-by refactors.
- Touch only the files the spec names. If you discover you need another file, note it in the report — don't silently expand.
- No new npm dependency unless the spec says so. If you add one, state why in the commit body.
- Never delete a file you did not create in this task.
- No mass find-replace across the repo.

---

## 3b. Branch & deploy discipline (Cloudflare auto-deploys — students are LIVE)

**Pushing to `main` deploys to production instantly. Real kids are using the site right now.**

- **Never push V3 features to `main`.** Work on `v3/<phase>` (e.g. `v3/b-rank`). PR into the **`v3`** integration branch, not `main`. Phương promotes `v3 → main`.
- Pushing your branch creates a Cloudflare **preview URL** — QA there, never on prod.
- **Feature-flag all new V3 UI** behind `import.meta.env.PUBLIC_R2L_V3` (production `=0` until launch). New code merges dark, invisible to kids.
- **Live data is sacred:** `progress:<code>` KV records are real students' coins/rank/streak. All schema changes are **additive + defaulted**; new code must read OLD records without crashing. Never rename/remove a field. No destructive migration.
- One file = one agent at a time (see `docs/V3_ROADMAP.md` §3 zone matrix). `lesson.astro` has a single owner per task.
- **Hotfix exception:** a real bug fix that helps current users (crash, mic, data loss) may go to `main` after tests pass — that's not a "feature."
- Full plan: `docs/V3_ROADMAP.md`.

---

## 4. Commit & test discipline

- **Run tests before every commit.** Hub: `node --test`. Must be all green.
- For `.astro` page logic changes, also run `npx astro check` and confirm **no new** errors (pre-existing Header.astro / admin/codes.astro errors are known, ignore those).
- Granular commits, present tense, one logical change each. Example: `Add n/6 dots mission chrome`.
- End every commit message with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Never** `--no-verify`, never skip hooks, never force-push `main`.
- If you branched, open a PR; do not merge to `main` without Phương.

---

## 5. Report back (so Claude can audit fast)

After finishing, output:
1. Commit hash(es) + one-line each.
2. Files changed.
3. Test result (`node --test` summary line: tests/pass/fail).
4. Anything you deviated from the spec on, and why.
5. Open questions for Claude/Phương.

Claude reviews by `git show <hash>` + 5-lens audit. Clear commits = fast review.

---

## 6. Customer reality (every build decision bends to this)

Users are **young VN kids (6-12)** + **non-tech parents with zero patience**. If a change makes the app slower, more confusing, or breakable on weak 3G / cheap Android / iPad Safari, it is wrong — even if it's "correct" code. Big tap targets, instant feedback, no dead ends, no English error strings shown to kids.

---

## 7. Multi-agent ground rules (2026-06-11 — after the speaking-incident collision day)

Nhiều agent (Claude, Cursor, Codex) làm việc song song trên repo này. Ngày
2026-06-11 đã có va chạm thật: 3 agent sửa cùng lesson.astro trong 24h, push
main chen nhau, báo cáo sai trạng thái. Từ giờ:

1. **Chỉ Claude được đụng `main`.** Cursor/Codex push branch riêng
   (`cursor/<task>`, `codex/<task>`, `v3/...`, `v4/...`) — push branch tự có
   Cloudflare preview URL, QA ở đó. Claude verify → Phương duyệt → Claude merge.
2. **Xí chỗ trước khi làm:** thêm 1 dòng vào `docs/AGENT_LOG.md` khi BẮT ĐẦU
   và khi XONG (format trong file). Trước khi sửa file nóng (`lesson.astro`,
   `r2l-recorder.js`, `r2l-mic-check.js`, `read2lead-speaking-check.js`):
   đọc 5 dòng cuối log — nếu agent khác đang giữ, DỪNG và báo Phương.
3. **Một file = một agent tại một thời điểm.** Tranh chấp → Claude phân xử.
4. **Báo cáo phải kèm bằng chứng máy:** cuối report dán output thật của
   `git log --oneline -3` và `git status --short`, ghi rõ ĐÃ PUSH hay CHƯA
   (kiểm bằng `git log origin/<branch> -1`). Cấm báo trạng thái từ trí nhớ.
5. **Không bỏ checkout chung ở branch lạ.** Xong việc: working tree sạch
   (commit hoặc stash) + ghi vào log đang để branch nào. Không để file rác
   untracked (_qa-*.png, _worker.bundle…) — dọn hoặc gitignore trong task của mình.

### Luật riêng cho Cursor (siết 2026-06-11 tối — sau các vi phạm cùng ngày)

Vi phạm đã xảy ra hôm nay: ghi DONE vào AGENT_LOG khi chưa hề commit; để code dở chưa commit nằm
trên checkout chung; sửa file trong vùng Claude (lesson.astro, speaking-check API) không xin phép;
báo cáo trạng thái sai ("chưa push" khi đã push). Từ giờ:

1. **DONE = đã commit.** Dòng DONE trong AGENT_LOG bắt buộc kèm **commit hash**. DONE không hash
   = coi như chưa làm, Claude không review.
2. **Không bao giờ kết thúc phiên với working tree bẩn.** Mọi thay đổi commit lên branch của mình
   trước khi dừng — kể cả dở dang (prefix `WIP:`). Code chưa commit trên checkout chung = sẽ bị
   mất hoặc trộn nhầm vào commit của agent khác.
3. **Branch luôn tạo từ origin/main mới nhất:** `git fetch origin && git checkout -b <branch> origin/main`.
   Không branch từ branch khác, không làm việc trực tiếp trên main/v3/v4.
4. **Nhiều agent song song trên cùng máy → mỗi agent một worktree riêng**
   (`git worktree add ../hub-<task> <branch>`). Cấm 2 agent dùng chung checkout `D:\felixbuilderhub`.
5. **Một agent = một spec = một zone.** Cần sửa file ngoài zone → DỪNG, ghi vào report, không
   "tiện tay". Spec là nguồn chân lý duy nhất; không tự thêm scope, không drive-by refactor.
6. Report kết thúc bằng output THẬT của `git log --oneline -3` + `git status --short` + đã-push-hay-chưa.

### Phân vùng hiện tại (cập nhật khi giao việc mới)

| Agent | Vùng được sửa | Cấm đụng |
|---|---|---|
| **Codex #R2** | HOÀN THIỆN `docs/SPEC_W2R_R2_RANK_UI.md` trên branch `w2r/r2-rank-ui` (Cursor bỏ dở — components có ở 0629727, THIẾU tích hợp hub): `src/components/read2lead/**`, `src/pages/hoc-sinh/**`, `src/scripts/r2l-w1-page.ts`, tests rank-ui | mọi file functions/, lesson.astro, leaderboard.astro |
| **Codex #R3** | LÀM LẠI `docs/SPEC_W2R_R3_LEADERBOARD.md` trên branch `w2r/r3-leaderboard` (code Cursor mất vì không commit; test còn ở 983490f): `functions/api/read2lead-leaderboard.js`, `src/pages/read2lead/leaderboard.astro`, tests leaderboard | `_read2lead-v2-state.js`, mọi file hoc-sinh/, lesson.astro |
| **Cursor** | (tạm không có zone — W2R R1 đã xong và merge; R2/R3 chuyển giao Codex sau vi phạm §7) | mọi vùng đang giao Codex/Claude |
| **Claude** | main merges, specs, incident response, mic/speaking pipeline (lesson.astro, r2l-recorder.js, r2l-mic-check.js, read2lead-speaking-check.js) | — |

> Parent Portfolio (`docs/SPEC_PARENT_PORTFOLIO.md`): PAUSED theo lệnh Phương 2026-06-11 — ưu tiên pilot. Spec vẫn READY.
