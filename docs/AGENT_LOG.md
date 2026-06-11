# AGENT_LOG — sổ xí chỗ (append-only)

> Mỗi agent thêm 1 dòng khi BẮT ĐẦU một task và 1 dòng khi XONG (đẩy xuống cuối
> file, không sửa dòng cũ). Trước khi sửa file nóng, đọc 5 dòng cuối.
> Format: `| YYYY-MM-DD HH:mm | agent | START/DONE | branch | vùng/files | ghi chú |`

| Thời gian | Agent | Trạng thái | Branch | Vùng / files | Ghi chú |
|---|---|---|---|---|---|
| 2026-06-11 18:30 | claude | DONE | main | AGENTS.md, docs/ | Luật multi-agent + spec Parent Portfolio |
| 2026-06-11 18:30 | claude | NOTE | — | lesson.astro, r2l-recorder.js, speaking-check API | Vùng mic/speaking thuộc Claude — agent khác KHÔNG sửa |
| 2026-06-11 | cursor | DONE | fix/recorder-cache-skew | lesson.astro, speaking.astro, r2l-recorder-script.mjs, tests | cache-bust engine URL + safeStop guards |
