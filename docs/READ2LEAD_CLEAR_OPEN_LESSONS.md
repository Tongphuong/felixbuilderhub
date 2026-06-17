# Bulk cancel open Read2Lead lessons (rank-safe)

## What this does

Clears `progress.current_pack` on access codes when status is:

- `generation_in_progress` (stuck generating)
- `awaiting_review` (unfinished lesson blocking new pack)

**Does NOT touch** `progress:{ACCESS_CODE}` — lifetime rank, season RP, XP, `level_progress`, coins, streaks stay intact.

**Does NOT clear** `reviewed_pass_web_v2` or other submitted states.

## Production run — 2026-06-17

Cleared **9** codes via Cloudflare KV API (emergency, pre-deploy):

| Code | Previous status |
|------|-----------------|
| R2L-BIN-3ESD | awaiting_review |
| R2L-HOANG-CDMA | awaiting_review |
| R2L-HUY-26B7 | awaiting_review |
| R2L-KIMMY-5XK8 | awaiting_review |
| R2L-MAI-WC7K | awaiting_review |
| R2L-NAM-HFBY | generation_in_progress |
| R2L-ONG-U5M6 | awaiting_review |
| R2L-PILOT-CYJS | awaiting_review |
| R2L-TI-AAJR | awaiting_review |

**Skipped (completed):** R2L-LONG-KN77, R2L-PHUC-7TZV, R2L-VODKA-GPEX (`reviewed_pass_web_v2`)

## After hub deploy

```bash
# Dry run first
curl -u admin:"$ADMIN_PASSWORD" -X POST https://felixbuilderhub.com/api/admin/codes/clear-open-lessons \
  -H "Content-Type: application/json" \
  -d '{"dry_run":true}'

# Execute
curl -u admin:"$ADMIN_PASSWORD" -X POST https://felixbuilderhub.com/api/admin/codes/clear-open-lessons \
  -H "Content-Type: application/json" \
  -d '{}'
```

Single code:

```bash
curl -u admin:"$ADMIN_PASSWORD" -X PATCH "https://felixbuilderhub.com/api/admin/codes/R2L-EXAMPLE-ABCD" \
  -H "Content-Type: application/json" \
  -d '{"clear_current_pack":true}'
```

## Code

- `functions/api/_read2lead-clear-open-lessons.js`
- `functions/api/admin/codes/clear-open-lessons.js`
- `tests/read2lead-clear-open-lessons.test.mjs`

## Note on uses_remaining

If a pack reached `awaiting_review`, `uses_remaining` was already decremented at promote time. Clearing the open lesson does **not** refund a use (by design — same as manual KV clear).
