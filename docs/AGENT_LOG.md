# AGENT_LOG — sổ xí chỗ (append-only)

> Mỗi agent thêm 1 dòng khi BẮT ĐẦU một task và 1 dòng khi XONG (đẩy xuống cuối
> file, không sửa dòng cũ). Trước khi sửa file nóng, đọc 5 dòng cuối.
> Format: `| YYYY-MM-DD HH:mm | agent | START/DONE | branch | vùng/files | ghi chú |`

| Thời gian | Agent | Trạng thái | Branch | Vùng / files | Ghi chú |
|---|---|---|---|---|---|
| 2026-06-11 18:30 | claude | DONE | main | AGENTS.md, docs/ | Luật multi-agent + spec Parent Portfolio |
| 2026-06-11 18:30 | claude | NOTE | — | lesson.astro, r2l-recorder.js, speaking-check API | Vùng mic/speaking thuộc Claude — agent khác KHÔNG sửa |
| 2026-06-11 | cursor | START | fix/recorder-cache-skew | lesson.astro, speaking.astro, r2l-recorder-script, tests | SPEC_RECORDER_CACHE_SKEW_FIX |
| 2026-06-11 | cursor | DONE | fix/recorder-cache-skew | lesson.astro, speaking.astro, r2l-recorder-script.mjs, r2l-recorder-guards.ts, tests | 0cfbef1 — cache-bust engine URL + safeStop guards |
| 2026-06-11 23:30 | claude | DONE | main | docs/, AGENTS.md | W2R rank seasons: roadmap §4b + 3 specs R1/R2/R3 + luật riêng Cursor |
| 2026-06-11 20:15 | cursor | START | w2r/r2-rank-ui | SeasonBanner, MedalCabinet, hoc-sinh-w1.ts, tests | SPEC_W2R_R2_RANK_UI |
| 2026-06-11 20:20 | cursor | START | w2r/r1-rank-core | _read2lead-v2-state.js, _read2lead-seasons.js, submit, tests | SPEC_W2R_R1_RANK_CORE |
| 2026-06-11 20:25 | cursor | START | w2r/r3-leaderboard | read2lead-leaderboard.js, leaderboard.astro, tests | SPEC_W2R_R3_LEADERBOARD |
| 2026-06-11 23:45 | codex | START | codex/avatar-geometry | monster geometry zone per §6 | SPEC_AVATAR_GEOMETRY_ROOT_FIX |
| 2026-06-11 23:48 | codex | DONE | codex/avatar-geometry | monster geometry zone per §6 | commit 0a13e38; 248 tests green; build green; worktree riêng — chuẩn luật |
| 2026-06-12 | claude | VERIFY | main | — | KẾT QUẢ: R1 PASS (commit hộ 43da11a + review-fix peak-cap a55e319; 259/259). Avatar PASS (248/248; contact 30/30 combo). Cache-skew PASS (0cfbef1). Backend ramp PASS (872e804; 103/103 pytest). R2 FAIL — thiếu tích hợp trang hub, test tự khai green nhưng fail; components đã giữ ở 0629727, làm nốt theo spec. R3 FAIL — code mất vì không commit (vi phạm §7), chỉ còn test 983490f, làm lại theo spec. Cả 3 dòng DONE của W2R đều không có hash. |
| 2026-06-12 | claude | DONE | main | merge | Merged verified: R1 + feat/level-progress-param (kèm fix dial lifetime-RP) + codex/avatar-geometry + fix/recorder-cache-skew. R2/R3 trả lại Cursor. |
| 2026-06-12 | claude | NOTE | w2r/r2-rank-ui, w2r/r3-leaderboard | — | R2/R3 chuyển giao Cursor → Codex (lệnh Phương). Branch đã push origin. Codex: R2 làm nốt tích hợp hub cho test rank-ui xanh; R3 implement lại theo spec cho test leaderboard xanh. |
| 2026-06-12 17:01 | codex | START | fix/audio-r2dev-host-rewrite | functions/api/read2lead-lesson.js, functions/api/_read2lead-lesson-activities.js, shared audio URL util, tests | SPEC_FIX_AUDIO_R2DEV_503; env passed from context.env |
| 2026-06-12 17:06 | codex | DONE | fix/audio-r2dev-host-rewrite | lesson API audio host rewrite + tests | fbf793f; 250 tests pass; astro check has 0 task diagnostics (410 pre-existing repo errors) |
| 2026-06-12 17:35 | codex | START | codex/avatar-arm-direction | monster geometry zone | Continue Claude rate-limit handoff: add arm orientation QA and correct reversed arm placement |
| 2026-06-12 19:15 | codex | DONE | codex/avatar-arm-direction | monster geometry zone | 87354b3; shoulder/hand alpha centroids + orientation QA; 286 tests green |
| 2026-06-12 19:20 | codex | AUDIT | codex/avatar-arm-direction | monster geometry zone | ce95b59 review-fix: compare transformed shoulder/hand; reversed-flip detection 864/864 each side; 287 tests + build green |
| 2026-06-12 23:35 | codex | START | codex/lesson-focus-header | Header.astro, header tests, decision note | Phuong approved direct UX exception: simplify lesson toolbar; avoid lesson.astro and mic/completion logic |
| 2026-06-12 23:55 | codex | DONE | codex/lesson-focus-header | Header.astro, header tests, decision note | 87e180e; 290 tests green; build green; Header.astro diagnostics 0; desktop/mobile browser QA pass |
