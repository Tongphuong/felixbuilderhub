# V3 OBSERVABILITY SPEC — Microsoft Clarity + Sentry (free, privacy-guarded)

**Author:** Claude (tech commander) · **Date:** 2026-06-09 · **Executor:** Cursor
**Repo:** felixbuilderhub · **Branch:** `v3/observability` (off `main` — this is safe monitoring, not a V3 feature; NOT behind `R2L_V3`)
**Goal:** See where real parents/kids get stuck (Clarity session replay) and catch real-device errors instantly (Sentry). Children's product → **PII must be masked/scrubbed**.

> These are monitoring, not features. They change no user behaviour. Self-gate on env vars → safe to merge even before the vars are set (no-op until configured). Intent: merge to `main` so we capture LIVE traffic.

---

## 1. Where
Add both to the **shared base layout `<head>`** that wraps the Read2Lead pages (grep `src/layouts/*.astro` for the common one; if read2lead pages use a specific layout, add there). Implement as small `is:inline` scripts so there is no heavy bundle in the lesson.

## 2. Microsoft Clarity (free)
Env var: `PUBLIC_CLARITY_ID` (Cloudflare Pages env). Load only if present:
```astro
<script is:inline define:vars={{ clarityId: import.meta.env.PUBLIC_CLARITY_ID }}>
  if (clarityId) {
    (function(c,l,a,r,i,t,y){
      c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
      t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
      y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", clarityId);
  }
</script>
```
**Privacy:**
- Spec note for Phương: in the Clarity dashboard set masking to **"Mask" (strict)** so text content/inputs are masked by default.
- In code, add `data-clarity-mask` (or class `clarity-mask`) to any element that displays the **access code** or **child name** (e.g. the state header, the code field) so they are masked even if dashboard mode changes.

## 3. Sentry (free tier) — lean loader, not a bundled SDK
Prefer the **Sentry Loader Script** (async, lazy-loads the SDK — keeps the lesson bundle lean) over bundling `@sentry/browser` (~30KB). Env var: `PUBLIC_SENTRY_LOADER_SRC` (the loader `<script src>` from the Sentry project) — load only if present. Configure via `onLoad`:
```astro
<script is:inline define:vars={{ sentrySrc: import.meta.env.PUBLIC_SENTRY_LOADER_SRC, env: import.meta.env.PUBLIC_ENV || 'production' }}>
  if (sentrySrc) {
    var s=document.createElement('script'); s.src=sentrySrc; s.async=1; s.crossOrigin='anonymous';
    s.onload=function(){
      if (!window.Sentry) return;
      window.Sentry.onLoad(function(){
        window.Sentry.init({
          environment: env,
          sendDefaultPii: false,
          tracesSampleRate: 0.1,
          beforeSend: function(event){
            var scrub=function(u){return typeof u==='string'?u.replace(/([?&](code|access_code)=)[^&]+/gi,'$1***'):u;};
            if(event.request){ event.request.url=scrub(event.request.url); event.request.query_string=scrub(event.request.query_string); }
            return event;
          },
          beforeBreadcrumb: function(crumb){
            if(crumb&&crumb.data&&crumb.data.url){ crumb.data.url=String(crumb.data.url).replace(/([?&](code|access_code)=)[^&]+/gi,'$1***'); }
            return crumb;
          }
        });
      });
    };
    document.head.appendChild(s);
  }
</script>
```
(If the loader path proves awkward on Cloudflare, fallback to `@sentry/browser` with the same `beforeSend`/`beforeBreadcrumb` scrub — but try the loader first for bundle-leanness.)

**Privacy:** `sendDefaultPii: false`; scrub `code`/`access_code` from URLs + breadcrumbs (above). Do not capture child names — they appear in DOM, not in error payloads, so default is fine; if any handled error includes a name, scrub it too.

## 4. Env vars (Phương sets in Cloudflare Pages → Settings → Environment variables)
- `PUBLIC_CLARITY_ID` = Clarity project id (free account).
- `PUBLIC_SENTRY_LOADER_SRC` = Sentry Loader `<script src>` url (free project).
- `PUBLIC_ENV` = `production` (production) / `preview` (preview) — optional, defaults to production.
Set on **production** (and optionally preview). Code no-ops if a var is absent.

## 5. Tests (node --test, structural)
- Base layout contains the Clarity init gated on `PUBLIC_CLARITY_ID` and the Sentry init gated on `PUBLIC_SENTRY_LOADER_SRC`.
- The Sentry config scrubs `code`/`access_code` (assert the regex/`beforeSend` present).
- The access-code display element carries a mask attribute/class.
Keep all existing tests green; `npx astro check` no new errors.

## 6. Deploy
Branch `v3/observability` → tests green → since this is privacy-guarded monitoring (not a feature) it may go to **`main`** so it captures live traffic, after Phương has the two free accounts + sets the env vars. Standard branch → review → merge.

## 7. 5× audit
1. **Correctness:** additive scripts, env-gated, no-op without vars; no behaviour change. ✅
2. **Pedagogy/UX:** indirectly huge — reveals where non-tech parents/kids stall so we fix the real friction. ✅
3. **Kid/parent UX:** lean (Clarity async tag; Sentry lazy loader) → minimal load cost on 3G. ✅
4. **Risk:** privacy is the main risk (kids) → masked Clarity + scrubbed Sentry + `sendDefaultPii:false`; access-code masked in DOM. Residual: access code may appear in Clarity URL capture — low sensitivity (a lesson code, not an external credential); revisit if needed. ✅
5. **Maintainability:** two small inline scripts + env vars, trivially removable. ✅
