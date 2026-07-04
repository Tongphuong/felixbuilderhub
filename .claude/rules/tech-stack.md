---
description: "Tech stack details for the felixbuilderhub monorepo"
globs:
  - "src/**"
  - "functions/**"
  - "public/**"
  - "astro.config.*"
  - "package.json"
  - "wrangler.toml"
---

## Tech stack

- **Astro 5** — static site generator with islands
- **Tailwind CSS** — utility-first styling
- **Cloudflare Pages** — hosting, auto-deploys from `main`
- **Cloudflare Workers (Functions)** — API endpoints in `functions/`
- **Cloudflare KV** — pack storage, progress state
- **Cloudflare D1** — student profile database (upcoming)
