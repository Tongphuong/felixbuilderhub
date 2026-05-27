## Cloudflare Pages — Update Build Settings After P2 Trimmed Deploy

Go to: dash.cloudflare.com → Workers & Pages → felixbuilderhub → Settings → Build & deployments

Edit configuration:
- Build command: npm run build
- Build output directory: dist
- Root directory: / (leave default)

Save. Next push to main will rebuild with Astro.
