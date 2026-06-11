# AGENT_LOG — sổ xí chỗ (append-only)

> Mỗi agent thêm 1 dòng khi BẮT ĐẦU một task và 1 dòng khi XONG (đẩy xuống cuối
> file, không sửa dòng cũ). Trước khi sửa file nóng, đọc 5 dòng cuối.
> Format: `| YYYY-MM-DD HH:mm | agent | START/DONE | branch | vùng/files | ghi chú |`

| Thời gian | Agent | Trạng thái | Branch | Vùng / files | Ghi chú |
|---|---|---|---|---|---|
| 2026-06-11 18:30 | claude | DONE | main | AGENTS.md, docs/ | Luật multi-agent + spec Parent Portfolio |
| 2026-06-11 18:30 | claude | NOTE | — | lesson.astro, r2l-recorder.js, speaking-check API | Vùng mic/speaking thuộc Claude — agent khác KHÔNG sửa |
| 2026-06-11 | cursor | START | fix/recorder-cache-skew | lesson.astro, speaking.astro, r2l-recorder-script.ts, tests | SPEC_RECORDER_CACHE_SKEW_FIX |
| 2026-06-11 | cursor | DONE | fix/recorder-cache-skew | lesson.astro, speaking.astro, r2l-recorder-script.ts, r2l-recorder-guards.ts, tests | cache-bust engine URL + safeStop guards; 249 tests green |
| 2026-06-11 23:30 | claude | NOTE | fix/recorder-cache-skew | — | Dòng DONE trên KHÔNG có commit — code đang nằm uncommitted trên checkout chung, vi phạm luật mới §7. Chờ Claude review/commit. |
| 2026-06-11 23:30 | claude | DONE | main | docs/, AGENTS.md | W2R rank seasons: roadmap §4b + 3 specs R1/R2/R3 + luật riêng Cursor |
