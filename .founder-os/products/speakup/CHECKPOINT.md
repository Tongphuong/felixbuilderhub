# Checkpoint — SpeakUp

- Updated: 2026-07-13 (was stale since 2026-07-03 — it still named a `codex/…`
  branch, three retirements ago)
- Branch: `main` (all V1 work merged; pilot running on production)
- Worktree: `/home/felixbuilderhub/work/repos/hub-speakup-homework`
- Status: **PILOT LIVE** on `felixbuilderhub.com` (started 2026-07-12, up to 20 kids)

## Done this session (2026-07-13)

- **Picture-homework bug FIXED.** Root cause was not code: the Cloudflare Pages
  **Production** environment was missing the `R2L_MEDIA` R2 binding that Preview
  had. Photo homework was built and rule-20 verified on preview in July, merged
  to production with the pilot, and had **never once worked there**. Phương added
  the binding; the production probe flipped `500 config_error` → `404
  code_not_found`. The same fix un-broke the vision autofill, parent portfolio
  video upload, and the Read2Lead gift-shop photos (same bucket).
- **Adaptive homework types SHIPPED** (schema v3 `tasks[]`): read / present /
  story / build (sentence-building) / picture / qa. Every type compiles onto an
  **existing** scorer — zero new grading code, zero new AI on the kid path. The
  20 live pilot kids' records are never rewritten (in-memory v1/v2 upgrade;
  byte-identical steps, verified across 20+ adversarial fixtures by Buffet).
- **Authoring**: paste a lesson → one teacher-side LLM call at assign time → a
  draft task list the teacher edits and confirms. Validated against Phương's real
  `friend_detective` lesson with the live model *before* any code existed.
- Six bugs caught before any child saw them — two of them in Elon's own code,
  found by Buffet.

## Tests / gates

1403/1403 `node --test`; astro build clean; founder build + complete + reflect
gates PASS; agent-governance PASS (first time in a week); env drift zero; the new
gate self-test PASS.

## Production effect

Live for up to 20 pilot kids. **The new homework types are inert until Phương
assigns one** — no kid has a story/build/picture task yet.

## Blockers / open items for Phương

1. **Drive the authoring modal yourself, on a TEST code, before any class sees
   it.** It shipped to production having never been typed into by a human (only
   unit tests + an API-level probe) — rule 26 now forbids exactly that, and his
   waiver is on record ("No need, i'll do that myself"). Top item.
2. **Watch the Azure F0 meter.** The new types bill ~30s of Azure per step vs
   ~10s for a sentence. The 5-audio-hour/month free tier has a hard cap (so no
   surprise bill) — but when it runs out, pronunciation + word chips + the fix-it
   drill **silently stop** and kids get only a match %, which is precisely the
   "45% only" complaint that started V1.
3. `~/.local/bin/aider` — the CLI binary is still installed (inert: no role, no
   branch lane, no permission). Uninstalling is Phương's call.
4. **`founder-os` has no git remote.** The whole governance system — gates, rules,
   EVOLUTION_LOG — exists only on this machine, with no backup.

## Next

Stop shipping. Let the pilot generate evidence for a week: does the kid finish the
homework, does the coach note help, do the chips get used, how often does the
repair ladder fire. Held: V1.5–V1.7, and the `taskType`→coach follow-up (its only
caller is the frozen scoring file).
