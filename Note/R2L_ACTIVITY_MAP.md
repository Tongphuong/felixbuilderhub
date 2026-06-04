# Read2Lead — Web ↔ PDF activity map

After V6 Phase G/H 2026-06-04. Source of truth for which surface
renders which exercise.

## Web 5-cluster (Step 3 Practice on lesson page)

| Slot | Web activity ID | Source data | PDF equivalent | Notes |
|---|---|---|---|---|
| 1 | cum_cau_con | power_chunks + matching_activity | PDF Section 3 Activity A (Match the Chunk) | Web has a tappable glossary panel above matching |
| 2 | dung_cum_cau | fill_in_the_blank + chunk_in_context | PDF Section 3 Activity C + F | Web interleaves 2 sub-sections; PDF lists them separately |
| 3 | nghe_doc_theo | shadowing_sentences + sentence_audio_urls | (PDF: none) | Web-only — audio + tap-words. Print can't carry MP3 |
| 4 | hieu_truyen | comprehension_questions (Find It + Language in the Story) + best_line_challenge | PDF Section 4 Reading Comp + Activity G | Web auto-grades. PDF parent-led |
| 5 | ke_chuyen_con | comprehension_questions (Open Question + Your Turn) | PDF Section 6 Retell + Open Question | Web has hint_vi sentence-starter. PDF has retell frame |

## Web-only (no PDF equivalent)
- Step 1 Read (story_text inline scroll)
- Step 2 Listen (full story MP3 narration)
- Inline per-slot grading via /api/grade-slot

## PDF-only (no web equivalent)
- Cover Page (parent quickstart guide)
- Section 6 Retell Frame (write-it-out for parent-led practice)
- Section 7 Answer Key (parent-graded; was Section 8 pre-V6 cleanup)

## Pack JSON schema (single source of truth)
Both surfaces consume the same review_context. Schema lives in api/prompt.py SYSTEM_PROMPT. Adding new fields = add as optional + add graceful skip in BOTH surfaces.

## Removed in V6 Phase G (still output by LLM, ignored by both surfaces)
- build_the_chunk (was PDF Activity B; redundant with matching)
- fix_the_chunk (was PDF Activity D; redundant with fill_in_the_blank)
- story_order + retell_frame.story_order_html (was PDF Section 5; redundant with comprehension)
- story_text_vi rendering on PDF (was Page 7; parent can read English alongside)

These fields stay in the pack JSON schema for backward compat with old KV packs and so that re-introducing them in a future surface needs no LLM prompt change.
