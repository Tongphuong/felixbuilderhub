# Release — SpeakUp

- Candidate version: speakup-shadowing-v1 (integration tip of claude/speakup-shadowing, merged main sync)
- Staging URL: https://claude-speakup-shadowing.felixbuilderhub.pages.dev/shadowing/
- Rollback commit or deployment: origin/main pre-merge tip 53130ca (docs: R2L-REWARDS-REDESIGN merged) — revert = redeploy main@53130ca
- Scope and UI approved: yes — founder approved the Claude Design set as-drawn (bef74ce) and gave the explicit merge order 2026-07-19
- Targeted tests passed: yes — shadowing suite 56/56 + ui 41/41 (final tips)
- Relevant full tests passed: yes — merged tree 1999/2000; the 1 failure is the pre-existing date-fixture in the rewards-tracker lane (reproduced on clean main 53130ca, ticketed in _ops/AGENT_LOG 2026-07-19), unrelated to this release
- Core browser flow passed: yes — TRUE E2E on the deployed staging 2026-07-19: real code login → watch auto-advance → q1 → real fake-mic recording → real Whisper grade → celebrate ×2 → q2 → wrong-audio → warm retry ×2 → back-exit with persisted stars (_ops/e2e-*.png)
- Mobile check passed: yes — rule-20 MATCH at 390 vs the founder's handoff screenshots (SHA 12020d2)
- Tablet check passed: yes — rule-20 render at 820 (picker app-header + 3-col grid) MATCH
- Desktop check passed: yes — rule-20 render at 1280 (stage/booth split view) MATCH
- Console and API errors checked: yes — E2E console capture: zero errors beyond benign embed/recorder warnings + one intentional 422 (silent-audio rejection handled kid-safely); burst probe: 10/10 clean, limiter 429 correct, zero Azure spend
- Privacy and cost checked: yes — youtube-nocookie host, no new PII (localStorage progress only + existing practice-log shape), runtime ≈ $0 verified live (Whisper in allocation, Azure bypassed, no economy writes)
- Screenshot or video proof ready: yes — _ops/shadowing-r20-*.png (390/820/1280) + _ops/e2e-*.png (full flow incl. celebrate)
- Founder production approval: yes — explicit order "Merge, log then cleanup" (Phương, 2026-07-19, in-session)
- Production smoke test passed: no — pending post-merge (marker probe + /shadowing 200 on felixbuilderhub.com, this session)

## Notes

- Known limitations: both starter videos ship as visibly-labeled BẢN NHÁP drafts (content_status: dev_draft) — founder content review pending; he flips each to 'approved'. Live SR word-lighting and real iPad/Android behavior verified only by design (headless cannot test them) — founder device pass recommended. Third-miss give-up transition + full-video completion covered by unit tests, not a live run.
- Rollback instruction: redeploy main@53130ca via Cloudflare Pages (or git revert the merge commit on main and push).
