# SESSION HANDOFF — Read2Lead · updated 2026-06-10

> **Next session: read THIS + the memory index only. Do NOT re-read big files or the transcript — this is the state. Verify specifics with `git log --oneline -8` when needed.**

## LIVE (main → prod, auto-deploys)
- HEAD `7cd5158`, `main == origin/main`.
- Shipped & live: V2 lesson UX redesign; **audio/mic fixes** (Groq MIME filename, big countdown popup, Zoom-style mic test, fetch timeouts); **Phase A story prompt** (backend: native-quality, ONE-FOCUS anti-cramming, difficulty = vocab+complexity NOT length); **observability** (Clarity `x4g4djeqzu` + Sentry, env vars set); safe backlog BL-2/3/4/6/7; and the **speaking incident hotfix `7cd5158`**.
- **V3 gamification is ON main but FLAG-OFF** (`PUBLIC_R2L_V3=0` in prod) → invisible to kids: rank ladder (Liên Quân), coin shop, **monster avatar** (Kenney CC0 in `public/assets/monsters/raw/`), mini-game shell, juice (confetti/synth SFX).

## OPEN INCIDENT — audio "con nói không nghe được"
- Hotfix `7cd5158` shipped 4 things: **(A)** effort-based completion for listen_and_speak + retell → a child is **never stuck** on mic/ASR; **(B)** `public/_headers` cache fix → devices stop serving yesterday's JS; **(C, root-cause)** removed the warmup AudioContext prime-then-close that left Realtek/Windows tracks **silent** (uploads >1.2KB but Whisper hears nothing); **debug** `/api/debug-speaking?key=<DEBUG_SPEAKING_KEY>` (secret-gated KV read).
- Status: **Fix C is high-confidence but UNCONFIRMED** (kid is remote/non-technical; token can't read KV directly). Fix A is the safety net.
- Next: kid retries on NEW code (needs one fresh load — close/reopen browser). To confirm: Phương sets `DEBUG_SPEAKING_KEY` env (prod) + redeploy, then `curl https://felixbuilderhub.com/api/debug-speaking?key=...` → read `type/size/groq_status` of any residual error.

## TO LAUNCH V3 (not done — needs human visual QA)
1. Phương opens prod `https://felixbuilderhub.com/hoc-sinh?v3=1` → check monster renders (parts aligned, hat on head), color picker visibly changes, buy/equip, rank-up + confetti.
2. Flip `PUBLIC_R2L_V3=1` in Cloudflare Pages → Production env → **Save + Redeploy**. (Code already on main; launch = just the flag.)
3. Rollback = set `0` + redeploy. Instant, no data loss (state is additive).
- Known polish (non-blocking): monster color = hue-rotate on Kenney bodies (confirm not muddy).

## BRANCHES
- `main` = live (ahead of `v3` by the 2 hotfixes). `v3` = integration (V3 code already merged to main). `v3-vocab` (backend) = Q9 NGSL vocab, **held for review**, prompt-side only.
- Backend `read2lead_v0_codex`: main = Phase A prompt (live).

## OPERATING RULES
- Claude = tech commander (decide/spec/verify); outsource code to Cursor — EXCEPT live incidents where Claude has done direct hotfixes. Live KV data = additive only. V3 features behind `isV3Enabled()` flag. Deploy rails + parallel zones in `docs/V3_ROADMAP.md`; autonomous runbook in `docs/V3_MASTER_EXECUTION.md`.
- Cloudflare: `wrangler` is logged in (account phuongtong474), but the OAuth token can't read KV (use `/api/debug-speaking` instead). Pages project = `felixbuilderhub`, prod deploy id via `wrangler pages deployment list`.

## KEY DOCS
**`docs/V4_REBUILD_ROADMAP.md`** (2026-06-10 — NEW master rebuild plan: 8 waves W1-W8 + WR lesson refactor, full inspection findings, lib picks, decision gates G1-G6 for Phương) · `docs/V3_MASTER_EXECUTION.md` (runbook) · `V3_ROADMAP.md` (phases + libs §4b + integrations §4c incl. OmniVoice/Immersive Reader/pronunciation APIs) · `V3_LAUNCH_RUNBOOK.md` · `V3_PHASE_B_RANK_SPEC.md` / `V3_PHASE_C2_MONSTER_AVATAR_SPEC.md` / `V3_PRELAUNCH_HARDENING_SPEC.md` · backend `_claude/PROMPT_*_SPEC.md`.

## 2026-06-10 session adds
- Backend hotfix `86d0a1d` LIVE (Render): backfill missing question ids — gpt-5-mini dropped `id` on written_response, packs failed. Verified via health-v2.
- `docs/V4_REBUILD_ROADMAP.md` written + 5-lens audited. Phương approved all waves; W1 EXPANDED (lesson gates + anti-guess + rank difficulty + game shell + kid/parent split; voice buttons dropped).
- **3 W1 specs ready for 3 parallel Cursor agents:** `W1_SPEC_A_LESSON_FLOW.md` (lesson.astro + backend dial, branch v4/a-lesson-flow) · `W1_SPEC_B_GAME_SHELL.md` (design system + contract §2, v4/b-game-shell, contract commit lands FIRST) · `W1_SPEC_C_KID_HUB_PARENT.md` (hoc-sinh hook + /phu-huynh, v4/c-kid-hub). New flag `PUBLIC_R2L_W1`.

## W1 EXECUTED + VERIFIED (2026-06-10 late session)
- All 3 Cursor agents delivered; Claude verified each independently (isolated worktrees, reran tests, ownership + contract + PII checks) and merged ALL into **`v3` = `e34491e`**: B `cbe0012` (192/192) → docs `a8a5c8b` → C `809656d` (199/199, PII clean) → A `e34491e` (196/196 hub). Integrated suite **203/203**, `npm run build` clean (17 pages).
- **Backend `v4/a-difficulty-dial` (`db7940c`) HELD unmerged** — dial C1–C4 guidance-only (section-mix constraint verified), 95/95 pytest. Needs Phương 4-pack manual QA before promoting to main (V3 rails §2).
- Stray local-v3 commits (0e96b06/c85aa7f) were duplicates, reset — never reached origin.
- Known polish (non-blocking): Agent A's lesson uses own CSS classes (`r2l-primary`, `r2l-w1-chip`) instead of B's v4 components; header swap via `?w1=1` query flashes legacy briefly (env-flag SSR path doesn't).
- **NEXT = Phương manual QA on v3 preview:** set Cloudflare Pages → Preview env `PUBLIC_R2L_W1=1`, then on `v3.felixbuilderhub.pages.dev` with a real test code: hub hook (<2s, 3G throttle) · create flow end-to-end (12 topic cards → wait scene → Đọc ngay; reload mid-gen no double-burn) · lesson gate + karaoke + anti-guess + recap · `/phu-huynh` in Zalo webview · flag off = legacy identical. Then decide `v3` → `main` promote. Cursor agents share ONE working tree (D:\felixbuilderhub) — future agents should use git worktrees.
