# Product — SpeakUp

- Product: SpeakUp
- Slug: speakup
- Founder: Phuong
- Status: build
- Founder approved: yes
- Approved: 2026-07-04 — approved the phased build roadmap, `_ops/specs/SPEC_SPEAKUP_V0.md`
- Created: 2026-07-03
- Scope updated: 2026-07-04 (V0 pilot scope superseding the 2026-07-03 fixed-homework-only draft below — see IDEAS.md for the change log)
- Architecture roadmap: `_ops/specs/SPEC_SPEAKUP_V0.md` — 8 phases, dispatch source of truth, supersedes this file's scope description wherever they conflict

## User

- Primary user: Children aged 8–14, mostly A2 with some B1. V0 pilot capped at 20 students max.
- Payer: Parents; V1 is included with limited usage in Phuong's coaching service

## Problem

- User problem: Children avoid daily speaking practice and need safe, encouraging pronunciation and vocabulary support between coaching sessions
- Current workaround: Phuong sends a weekly structured assignment and children submit a recorded video through Zalo

## Outcome

- Product promise: An AI voice companion ("Minny") that gives kids two ways to practice speaking English: guided homework practice against what Phuong actually taught them, and time-boxed free conversation practice
- Success metric: 20-student V0 pilot completes without safety incidents or cost overrun, with repeat use and observable pronunciation/confidence improvement

## V0 scope (current — see IDEAS.md 2026-07-04 entry for what changed and why)

- **Two modes only:**
  1. **Homework practice** — kid practices homework Phuong personally assigned in her live lessons; Minny gives feedback on pronunciation accuracy and how well the attempt matches what was taught. Needs a mechanism for Phuong to get that homework content into the system (simple form, not a dev task for her).
  2. **Free talking** — open-ended spoken conversation with Minny. Time-restricted (exact session length/turn cap TBD from the architecture roadmap). Requires a concrete guardrail mechanism (system-prompt rules + a technical backstop, not just an instruction) to keep it on-topic and safe — this is the highest-risk part of V0.
- Not included: public self-service signup, unlimited use, payments, ranking, shop, avatar, monster customization, or unrelated gamification
- Note: the live `/speak-up` placeholder page currently advertises three teasers (pronunciation practice, story retelling, presentation) — that copy predates this scope and needs a separate marketing update once V0 ships; it is not an engineering task.

## Constraints

- Monthly budget: USD 80 including subscriptions
- Visible-result deadline: one week after an approved prototype task begins
- Production approval: Phuong
- Pilot audience: up to 20 students
- Public-release evidence: at least 100 completed pilot sessions
- Audio retention target: up to 60 days with parent consent
- **Build principle (new, 2026-07-04): before writing any new capability from scratch, search for an existing open-source library, package, or forkable project that solves it (e.g. conversation guardrail/moderation libraries, TTS clients, audio-session helpers). Only hand-roll it if nothing suitable exists, and note that search briefly in the relevant spec/evidence entry.**
