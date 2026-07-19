# Environment bindings — felixbuilderhub.com
Reference for all `env.X` references inside Cloudflare Pages Functions.
Bindings are configured in Cloudflare Pages dashboard → Settings →
Environment variables and bindings. This doc is the source of truth;
when adding a new binding, update this file FIRST, then add to Cloudflare,
then reference in code.
## KV Namespaces
| Binding | Purpose | Used by |
|---|---|---|
| `READ2LEAD_CODES` | Single KV namespace storing per-student access codes + nested pack data (progress, current_pack, review_context). Acts as primary persistence for Read2Lead. | generate-read2lead-pack, check-generation-status, read2lead-lesson, read2lead-progress, read2lead-progress-update, read2lead-leaderboard, submit-read2lead-lesson, task-state, admin/codes (list + create), admin/codes/[code] (read + update + delete), admin/codes/[code]/set-level (test only) |
| `READ2LEAD_PROGRESS` | V2 persistent kid state (level, XP, coins, streak, starter badges, forward-compatible avatar placeholders). Code falls back to `READ2LEAD_CODES` if this binding is not configured yet. | read2lead-progress, read2lead-progress-update, submit-read2lead-lesson, admin/codes/[code]/set-level |
## R2 Buckets
| Binding | Purpose | Used by |
|---|---|---|
| `R2L_MEDIA` | Binary media bucket: teacher-recorded portfolio videos (`portfolio/<CODE>/vp_*.{mp4,webm,mov}`) and SpeakUp homework photos (`homework/<class_id>/hp_*.{jpg,png,webp}`). Metadata/references live in KV; only the bytes live here. Objects are never public — every read is streamed through a code- or admin-authorized Function. | admin/portfolio/upload, admin/portfolio/[id], parent/video, admin/classes/[id]/homework-photo, speakup-homework-photo |

(`R2L_MEDIA` was documented 2026-07-07 while adding homework photos, but had
existed undocumented long before — and was configured on Preview only, which is
how SpeakUp's photo homework shipped to production stone dead and stayed that way
for a month. Fixed 2026-07-13; drift is now enforced by `founder_check.py`'s
build gate, so this doc can no longer silently fall behind the code.)
## D1 Databases
| Binding | Purpose | Used by |
|---|---|---|
| `STUDENT_PROFILE_DB` | D1 database holding the `student_profiles` table (migration `0001_student_profile.sql`). Read via `env.STUDENT_PROFILE_DB \|\| env.DB`, so either binding name works. | _shared/student-profile.ts |
| `DB` | Fallback binding name for the same D1 database as `STUDENT_PROFILE_DB` — used when the project binds its D1 as plain `DB`. Bind ONE of the two; binding neither disables the profile path. | _shared/student-profile.ts |

## Workers AI
| Binding | Purpose | Used by |
|---|---|---|
| `AI` | Cloudflare Workers AI binding. Whisper STT (primary — runs inside Cloudflare, immune to the OpenAI geo-egress failure), Llama 3.3 (Free Talk brain fallback + homework-extract fallback), Llama Guard 3 (guardrail output screen), Llama 3.2 vision (teacher photo → homework draft). | minny-conversation, read2lead-speaking-check, admin/classes/[id]/homework-photo-extract, admin/classes/[id]/homework-extract |

## Secrets
| Binding | Purpose | Used by | Source |
|---|---|---|---|
| `READ2LEAD_BACKEND_URL` | Base URL of the Read2Lead Python service on Render (e.g., `https://read2lead-api-xxx.onrender.com`). Used to forward generation requests + voice samples. | generate-read2lead-pack | Render service URL |
| `READ2LEAD_BACKEND_SECRET` | Shared HMAC-style token. Hub sends as header when calling backend; backend sends as header on task-state callback to hub. Bidirectional auth. | generate-read2lead-pack, task-state | Manually set (must match `READ2LEAD_BACKEND_SECRET` on Render side) |
| `ADMIN_PASSWORD` | Password for `/admin/*` routes. Validated by `functions/_middleware.js`. | _middleware | Manually set |
| `AZURE_SPEECH_KEY` | Azure Speech subscription key. Powers SpeakUp's per-word pronunciation assessment. | _azure-pronunciation | Azure portal → Speech resource |
| `AZURE_SPEECH_REGION` | Azure Speech region (e.g. `southeastasia`). Must match the key's resource. | _azure-pronunciation | Azure portal → Speech resource |
| `OPENAI_API_KEY` | OpenAI key — Whisper transcription (speaking check) + TTS. Fallback when `READ2LEAD_OPENAI_API_KEY` is absent. | read2lead-speaking-check, _minny-tts | OpenAI dashboard |
| `READ2LEAD_OPENAI_API_KEY` | Read2Lead-scoped OpenAI key. Takes precedence over `OPENAI_API_KEY` so R2L spend can be tracked separately. | read2lead-speaking-check, _minny-tts | OpenAI dashboard |
| `R2L_AUDIO_HOST` | Base host for pre-generated lesson audio. Empty/absent falls back to same-origin. | _read2lead-audio-url | Manually set |
| `STUDENT_PROFILE_API_TOKEN` | Bearer token for the student-profile service. | _shared/student-profile.ts | Manually set |
| `PUBLIC_R2L_W7` | Feature flag (`'1'` = on): unlocks `effects`/`frame` decoration slots in the **monster** shop. Not a secret — public build-time var. Unrelated to the "Quà thật" real-gift shop, which has no flag. | read2lead-shop-buy | Manually set |

**Real-gift shop ("Quà thật", 2026-07-13)** — introduces no new bindings. It reuses
`READ2LEAD_CODES` (catalogue at key `config:gifts:v1`; redemption queue index at
`admin:gift-redemptions:v1`), `READ2LEAD_PROGRESS` (the child's `diamonds`,
`gift_goal` and append-only `redemptions[]` ledger), and `R2L_MEDIA` (gift photos
at `gifts/<gift_id>.<ext>`, served via `read2lead-gift-image`). Gift photo UPLOAD
therefore depends on `R2L_MEDIA` being bound in the **Production** environment —
it was missing there until 2026-07-13. Pasting an image URL needs no binding at
all, and is the path the founder actually uses (he sources product photos online).
| `TELEGRAM_BOT_TOKEN` | Bot token for the Felix lead-bot Telegram bot. Used to push lead notifications. | coaching-booking, msmw-lead, sharing-subscribe | https://t.me/BotFather |
| `TELEGRAM_CHAT_ID` | Chat ID where bot messages land (Phương's chat). | Same as `TELEGRAM_BOT_TOKEN` consumers | Bot getUpdates response |
| `OPENROUTER_API_KEY` | Bearer key for the Free Talking conversation brain (DeepSeek v4 Flash via OpenRouter). Missing key → llama-3.3 fallback → canned redirect. **Must be set on BOTH Preview and Production** (a Production-only key means preview Free Talk silently runs the fallback). | minny-conversation | OpenRouter dashboard (same key the retired Aider workers used, in `~/.config/aider/.env`) |
| `DEBUG_SPEAKING_KEY` | Secret gate for the `/api/debug-speaking`, `/api/debug-convo-flags`, and `/api/voice-quota` diagnostic endpoints (they return 404 unless `?key=` matches). `debug:convo-flags` surfaces why each Free Talk turn was guardrail-flagged (`matched_rule`: `guard_error`/`guard_empty_response`/`sN`/`guard_degraded`/etc.). `/api/voice-quota` is a read-only diagnostic reusing this same `?key=` gate — it reads the Azure voice-quota meter (`azure-pa-secs:<YYYY-MM>` in `READ2LEAD_CODES`) so an external HTTPS monitor can see it (the Cloudflare bindings MCP server cannot read a KV value directly). Optional — endpoints are simply invisible when unset. | debug-speaking, debug-convo-flags, voice-quota | Manually set (any random string; Phương-only diagnostic surface) |
| `AZURE_SPEECH_KEY` | Azure Speech key for Pronunciation Assessment (per-word/phoneme scoring on homework: scripted for `read`, unscripted for `frame`/`open`). Missing → the deterministic local scorer runs and no pronunciation block is returned. **Must be set on BOTH Preview and Production.** | _azure-pronunciation (→ read2lead-speaking-check) | Azure portal → Speech resource → Keys (F0 free tier; rotated 2026-07-11) |
| `AZURE_SPEECH_REGION` | Region of the Azure Speech resource above (e.g. `southeastasia`). Must match the key's resource or every PA call 401s. | _azure-pronunciation | Azure portal → Speech resource → Overview |
| `OPENAI_API_KEY` | OpenAI key: Minny's TTS chain, and the STT fallback in the speaking checker. **Caveat:** OpenAI geo-blocks calls egressing from some Cloudflare colos (403 `unsupported_country_region_territory`) — see the comment in `read2lead-speaking-check.js`; this is why Workers AI is the STT primary. | _minny-tts, read2lead-speaking-check | OpenAI dashboard |
| `READ2LEAD_OPENAI_API_KEY` | Legacy/alternate OpenAI key name read alongside `OPENAI_API_KEY` by the same two endpoints (whichever is present wins). Prefer `OPENAI_API_KEY` for new setups; this exists so the older configuration keeps working. | _minny-tts, read2lead-speaking-check | OpenAI dashboard |
| `STUDENT_PROFILE_API_TOKEN` | Bearer token for the student-profile (D1) service calls. | _shared/student-profile.ts | Manually set (must match the profile service) |
## Variables (non-secret)
| Variable | Purpose | Default |
|---|---|---|
| READ2LEAD_BOOK_LEVELS | Comma-separated StoryWeaver allowlist for generate-read2lead-pack (for example L1 or L1,L2). Only L1-L4 are accepted. When empty, the private book publisher may supply the same allowlist through `config:book_levels` in READ2LEAD_CODES. L5 always uses legacy generation. | Empty / book mode off |
| R2L_AUDIO_HOST | Host used to build Read2Lead story-audio URLs. Safe to leave unset — the code falls back to its default host. | Empty / default host |
| PUBLIC_R2L_W7 | Feature flag (`'1'` = on) unlocking the Wave-7 shop slots (`effects`, `frame`). Anything else keeps them locked. | Unset / slots locked |
## Per-endpoint binding matrix
| Endpoint | KV | Backend URL | Backend Secret | Admin PW | Telegram |
|---|---|---|---|---|---|
| `_middleware.js` | — | — | — | ✓ | — |
| `api/generate-read2lead-pack.js` | ✓ | ✓ | ✓ | — | — |
| `api/check-generation-status.js` | ✓ | — | — | — | — |
| `api/task-state.js` | ✓ | — | ✓ | — | — |
| `api/read2lead-lesson.js` | ✓ | — | — | — | — |
| `api/read2lead-progress.js` | ✓ | — | — | — | — |
| `api/read2lead-progress-update.js` | ✓ | — | — | — | — |
| `api/read2lead-leaderboard.js` | ✓ | — | — | — | — |
| `api/submit-read2lead-lesson.js` | ✓ | — | — | — | — |
| `api/admin/codes.js` | ✓ | — | — | — | — |
| `api/admin/codes/[code].js` | ✓ | — | — | — | — |
| `api/admin/codes/[code]/set-level.js` | ✓ | — | — | — | — |
| `api/publish-read2lead-book.js` | ✓ | — | ✓ | — | — |
| `api/coaching-booking.js` | — | — | — | — | ✓ |
| `api/msmw-lead.js` | — | — | — | — | ✓ |
| `api/sharing-subscribe.js` | — | — | — | — | ✓ |
Endpoint `_rate-limit.js` is an internal helper and consumes `env` only via
callers above. `_read2lead-v2-state.js` is also internal but uses the same
KV binding through callers above.
## Setup checklist (Cloudflare Pages dashboard)
When deploying to a fresh Cloudflare Pages project (e.g., preview branch
or new account):
1. KV → create namespace, bind as `READ2LEAD_CODES` (same name for both
   Production and Preview environments). For V2 state, also bind
   `READ2LEAD_PROGRESS`; until configured, code falls back to
   `READ2LEAD_CODES`.
2. Environment variables → add (Encrypt for all secrets):
   - `READ2LEAD_BACKEND_URL`
   - `READ2LEAD_BACKEND_SECRET`
   - Optional preview-only book pilot: READ2LEAD_BOOK_LEVELS=L1
   - `ADMIN_PASSWORD`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
3. **R2 → bind the media bucket as `R2L_MEDIA` (bucket
   `felixbuilderhub-read2lead`) for BOTH the Production and Preview
   environments — they are configured separately.** Anything that stores
   binary media needs it: SpeakUp homework photos, the teacher's vision
   autofill, parent portfolio videos, Read2Lead gift photos. A missing
   binding does not fail at build time — it surfaces at runtime as
   `config_error` / "Hệ thống ảnh chưa được cấu hình." **Bindings only take
   effect on a NEW deployment: redeploy after adding one.**
4. On the Render side, ensure `READ2LEAD_BACKEND_SECRET` matches exactly.
5. Verify by hitting `/api/check-generation-status?code=...&pack_id=...`
   — should return JSON, not 500. Verify R2 by hitting
   `/api/speakup-homework-photo?code=NOPE-NOPE-0000&id=hp_000000000000` —
   should return 404 `photo_not_found`, **not** 500 `config_error` (that
   guard runs before auth, so a 500 means the binding is missing).
## Drift detection (manual)
Run this grep periodically; new bindings must appear in this doc:
cd /home/felixbuilderhub/work/repos/felixbuilderhub
grep -rohE "env\.[A-Z][A-Z0-9_]+" functions/ | sort -u

Compare output to the bindings listed in the Secrets and KV tables
above. Any binding in the grep output but not in this doc = undocumented.
