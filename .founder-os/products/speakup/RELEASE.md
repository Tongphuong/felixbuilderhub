# Release — SpeakUp

- Candidate version: speakup-shadowing-v1
- Staging URL: https://claude-speakup-shadowing.felixbuilderhub.pages.dev/shadowing/
- Rollback commit or deployment: main@53130ca (git revert the merge on main, or redeploy that build in Cloudflare Pages)
- Scope and UI approved: yes
- Targeted tests passed: yes
- Relevant full tests passed: yes
- Core browser flow passed: yes
- Mobile check passed: yes
- Tablet check passed: yes
- Desktop check passed: yes
- Console and API errors checked: yes
- Privacy and cost checked: yes
- Screenshot or video proof ready: yes
- Founder production approval: yes
- Production smoke test passed: yes

## Notes

- Evidence per check (all 2026-07-19 unless noted): scope/UI = founder approved the Claude Design set as-drawn (bef74ce) + explicit merge order "Merge, log then cleanup"; targeted = shadowing suites 56/56 (final tips); full = merged tree 1999/2000 — the 1 failure is the pre-existing rewards-tracker date-fixture, reproduced on clean main@53130ca, ticketed in _ops/AGENT_LOG; core flow = TRUE E2E on staging (real login → watch → q1 → real fake-mic recording → real Whisper grade → celebrate ×2 → q2 → wrong-audio → warm retry ×2 → back-exit, stars persisted; _ops/e2e-*.png); mobile/tablet/desktop = rule-20 MATCH at 390/820/1280 vs the founder's Claude Design screenshots, SHA 12020d2 (_ops/shadowing-r20-*.png); console/API = E2E console capture clean (benign warnings + one intentional 422 silent-audio rejection handled kid-safely) + burst probe 10/10, limiter 429 at #21, zero Azure spend (2026-07-17); privacy/cost = youtube-nocookie host, no new PII (localStorage progress + existing practice-log shape), runtime ≈ $0 verified live; founder approval = the merge order itself.
- Known limitations: both starter videos ship as visibly-labeled BẢN NHÁP drafts (content_status: dev_draft) pending the founder's content review — he flips each to 'approved'; live SR word-lighting + real iPad/Android verified by design only (headless can't test them); third-miss give-up transition + full-video completion covered by unit tests, not a live run.
- Rollback instruction: `git revert <merge-commit> && git push origin main`, or redeploy main@53130ca from the Cloudflare Pages dashboard.
- Production smoke test: run post-merge this session (marker probe + /shadowing 200 on felixbuilderhub.com), then flip the field.
