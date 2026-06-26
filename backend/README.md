# Read2Lead backend

Python service that generates English reading packs (PDF + MP3) for
Vietnamese kids age 5-14. Called by [felixbuilderhub.com](https://felixbuilderhub.com)
when a parent submits the Read2Lead intake form.

## Stack

- Python 3.12 (Docker, not the stale runtime.txt)
- Flask + Gunicorn (gthread workers)
- OpenAI pack JSON: L1/L2 -> `gpt-5-mini`, L3-L5 -> `gpt-5.4-mini` (attempts 1-2)
- Anthropic Sonnet fallback on attempt 3 only
- OpenAI `tts-1-hd` for narration
- Playwright Chromium (HTML → PDF rendering)
- Cloudflare R2 (PDF + MP3 storage via boto3)

## Endpoints

| Route | Purpose |
|---|---|
| `GET /health` | Render health check |
| `POST /generate` | Sync pack generation (legacy, ~60s blocking) |
| `POST /generate-async` | Async pack generation (returns task_id immediately, posts back to hub via callback) |
| `POST /review` | Voice review for student speaking |
| `GET /voice-sample?voice=X` | TTS A/B sample for voice selection (dev only) |

Async flow:

1. Hub calls `/generate-async` with `READ2LEAD_BACKEND_SECRET` header
2. Backend returns `{task_id, status: "queued"}`
3. Worker runs in background: LLM → validate → repair → TTS → R2 upload
4. Backend POSTs final result to hub `/api/task-state` endpoint
5. Hub stores in KV under access code

## Pipeline (per pack)

parent form → /generate-async
→ generate_pack() [LLM]
→ validate_pack() [length, schema, semantic]
→ repair_missing_story_chunks() [auto-fix]
→ story TTS + chunk TTS + sentence TTS (parallel)
→ render_html() → playwright → PDF
→ R2 upload (PDF + MP3 batch)
→ callback to hub /api/task-state

## Env vars

See `render.yaml`. Required:

- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`
- `READ2LEAD_BACKEND_SECRET` (must match hub's binding)
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`,
  `R2_BUCKET_NAME`, `R2_PUBLIC_URL`

Plus optional:

- `OPENAI_MODEL_V2_L12` (default `gpt-5-mini`), `OPENAI_MODEL_V2_L345` (default `gpt-5.4-mini`)
- `ANTHROPIC_MODEL_V2` (Sonnet fallback, default `claude-sonnet-4-20250514`)

## Local dev

```sh
cd api
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
flask --app server run --port 5000
```

For full E2E, deploy to Render — Playwright Chromium needs the apt
deps baked into Dockerfile.

## Build pack from CLI (no LLM)

For manual pack generation from a hand-written JSON worksheet (legacy v0
workflow):

```sh
python scripts/build_reading_pack.py --input data/worksheets/<file>.json
```

Produces PDF + story TXT + MP3 in `generated/<slug>/`.

## Deploy

Push to main → Render auto-deploys via Dockerfile. Health check at
`/health` confirms boot.

## Sister repo

felixbuilderhub.com — web hub that calls this backend. See its
`docs/ENV.md` for the contract.

## Conventions

- Pack JSON schema additive-only. Breaking field renames go through
  hub-first deploy (hub adds graceful skip → backend ships new field).
- Validator + prompt + render functions stay in sync; when adding a
  schema field, update all three in one phase.
- Auto-repair (`repair_missing_story_chunks`) runs before validation
  to recover from common LLM omissions.
