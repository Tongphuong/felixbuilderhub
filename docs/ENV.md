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

(Documented 2026-07-07 while adding homework photos; this binding predates the
entry — doc drift. `AI` (Workers AI), `DB`/`STUDENT_PROFILE_DB` (D1) and the
Azure/OpenAI secrets are still undocumented here; see `grep -rohE "env\.[A-Z_]+" functions/` for the live list.)
## Secrets
| Binding | Purpose | Used by | Source |
|---|---|---|---|
| `READ2LEAD_BACKEND_URL` | Base URL of the Read2Lead Python service on Render (e.g., `https://read2lead-api-xxx.onrender.com`). Used to forward generation requests + voice samples. | generate-read2lead-pack | Render service URL |
| `READ2LEAD_BACKEND_SECRET` | Shared HMAC-style token. Hub sends as header when calling backend; backend sends as header on task-state callback to hub. Bidirectional auth. | generate-read2lead-pack, task-state | Manually set (must match `READ2LEAD_BACKEND_SECRET` on Render side) |
| `ADMIN_PASSWORD` | Password for `/admin/*` routes. Validated by `functions/_middleware.js`. | _middleware | Manually set |
| `TELEGRAM_BOT_TOKEN` | Bot token for the Felix lead-bot Telegram bot. Used to push lead notifications. | coaching-booking, msmw-lead, sharing-subscribe | https://t.me/BotFather |
| `TELEGRAM_CHAT_ID` | Chat ID where bot messages land (Phương's chat). | Same as `TELEGRAM_BOT_TOKEN` consumers | Bot getUpdates response |
## Variables (non-secret)
| Variable | Purpose | Default |
|---|---|---|
| READ2LEAD_BOOK_LEVELS | Comma-separated StoryWeaver allowlist for generate-read2lead-pack (for example L1 or L1,L2). Only L1-L4 are accepted. When empty, the private book publisher may supply the same allowlist through `config:book_levels` in READ2LEAD_CODES. L5 always uses legacy generation. | Empty / book mode off |
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
3. On the Render side, ensure `READ2LEAD_BACKEND_SECRET` matches exactly.
4. Verify by hitting `/api/check-generation-status?code=...&pack_id=...`
   — should return JSON, not 500.
## Drift detection (manual)
Run this grep periodically; new bindings must appear in this doc:
cd /home/felixbuilderhub/work/repos/felixbuilderhub
grep -rohE "env\.[A-Z][A-Z0-9_]+" functions/ | sort -u

Compare output to the bindings listed in the Secrets and KV tables
above. Any binding in the grep output but not in this doc = undocumented.
