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
`docs/V3_MASTER_EXECUTION.md` (runbook) · `V3_ROADMAP.md` (phases + libs §4b + integrations §4c incl. OmniVoice/Immersive Reader/pronunciation APIs) · `V3_LAUNCH_RUNBOOK.md` · `V3_PHASE_B_RANK_SPEC.md` / `V3_PHASE_C2_MONSTER_AVATAR_SPEC.md` / `V3_PRELAUNCH_HARDENING_SPEC.md` · backend `_claude/PROMPT_*_SPEC.md`.
