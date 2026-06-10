# W1 SPEC A — LESSON QUEST FLOW · Cursor Agent A

**Author:** Claude (tech commander) · **Date:** 2026-06-10 · **v1.1** (post EdTech-UX audit: + read-along mode, midpoint celebration, result recap) · **Executor:** Cursor Agent A
**Branch:** `v4/a-lesson-flow` off `v3` → PR into `v3`. Never `main`.
**Flag:** ALL new behavior behind `isW1Enabled()` (Agent B owns `src/config/flags.ts` — see contract §0). If B's flag isn't merged when you start, use a local inline fallback inside lesson.astro (`const isW1 = new URLSearchParams(location.search).get('w1') === '1' || import.meta.env.PUBLIC_R2L_W1 === '1'`) and swap to the import at integration — do NOT edit flags.ts yourself.
**Files you own (EXCLUSIVE):**
- `src/pages/read2lead/lesson.astro`
- `src/scripts/r2l-lesson-scoring.mjs` (NEW — extracted pure scoring/gate functions)
- `tests/read2lead-lesson-scoring.test.mjs` (NEW)
- Backend repo `read2lead_v0_codex` branch `v4/a-difficulty-dial`: `api/prompt_v2.py`, `api/server.py` (dial input only), `tests/test_prompt_v2_invariants.py`
- `functions/api/generate-read2lead-pack.js` (rank plumbing only)

**Files you must NOT touch:** `hoc-sinh/*`, `shop/games/leaderboard.astro`, `Header.astro`, `_read2lead-v2-state.js`, anything in `src/components/read2lead/v4/` (Agent B builds those — consume per contract).

---

## 0. Design contract (defined in `W1_SPEC_B_GAME_SHELL.md` §2 — read it first)

You consume from B: CSS tokens (`--r2l-*`), `r2l-kid` page class, components `HudBar`, `QuestPath`, `KidButton`, `KidModal`, `XpBar`, `KidToast`. The contract specifies exact props/markup. Build against the contract immediately — do not wait for B's code; integration happens on `v3`. If a component is missing at integration time, use a plain styled placeholder with the same class names.

## 1. Goal (Phương, 2026-06-10)

1. Con phải **đọc + nghe truyện xong** mới mở được câu hỏi.
2. Trong lúc làm bài, con **xem lại truyện dễ dàng** bất cứ lúc nào.
3. Câu hỏi **khó dần theo rank** (tăng tiến thật).
4. Làm sai phải **biết sai ở đâu** — không thể bấm bừa qua màn.

## 2. Phase machine (client, lesson.astro)

```
PHASE_STORY ("Khám phá truyện") → PHASE_ACTIVITIES ("Nhiệm vụ") → PHASE_RESULT
```

### PHASE_STORY — the read+listen gate
- On lesson load (W1 on): show ONLY the story screen. Story paragraphs render as swipeable/tappable **page cards** (one paragraph per card, big text, EN + tap-to-toggle VI if available).
- Two checklist chips at top: `📖 Đọc` and `🎧 Nghe`, each starts unchecked.
  - `Đọc` ✓ when the kid has advanced through ALL paragraph cards (tap "Tiếp →" on each; last card marks done). No timer-based skip detection — keep it simple and fair.
  - `Nghe` ✓ when full-story audio (`story.full_audio_url`) fires `ended`, OR every paragraph's sentence audios have been played at least once (track per-paragraph any-play; all paragraphs covered = done). Whichever happens first.
- **"Đọc cùng Minny" read-along mode (the primary path for L1–L2 — UX audit R1):** a big `▶ Đọc cùng Minny` button on the first card plays the per-sentence audios **sequentially in story order** (URLs exist on `story.sentences[*].audio_url`), auto-advancing the page cards and **live-highlighting the sentence being read** (karaoke style — bold + `--r2l-sun` underline; `prefers-reduced-motion` → highlight only, no scroll animation). Completing the read-along marks BOTH chips ✓ (it is simultaneous reading + listening — Raz-Kids pattern). Pause/resume on tap; manual card-by-card mode stays for fluent kids. If any sentence audio URL is missing, skip it silently and continue.
- CTA `Mở nhiệm vụ 🎯` (KidButton primary, large) is **disabled** until both ✓. Disabled tap → KidToast: `Con đọc và nghe hết truyện đã nhé!`
- Persist gate state in the existing lesson localStorage state under a NEW additive key `story_gate: { read_done, listen_done, paragraphs_played: number[] }` — resume must restore it. Old saved states without the key → gate restarts (acceptable).
- W1 off → current behavior exactly (no gate).

### PHASE_ACTIVITIES — sequential unlock + story always available
- Replace free-forward navigation: activity i+1 unlocks only when activity i is finalized. Back-navigation to completed activities stays allowed. Use B's `QuestPath` component for the dots→path UI (nodes: done ✅ / current ▶ / locked 🔒). `gotoActivity(index)`: reject `index > maxUnlockedIndex` with KidToast `Xong nhiệm vụ này trước đã nha!`
- **Story panel:** persistent `📖 Truyện` button in the HUD (B's `HudBar` exposes slot `data-r2l-hud-story`). Tap → bottom-sheet (mobile) / right side-panel (≥768px) with the full story + per-paragraph audio buttons. Opening it: pauses any playing activity audio, does NOT touch activity state, closes via swipe-down / X / backdrop. Reuse + upgrade the existing StoryDock markup; do not build a second component.

- **Midpoint celebration (UX audit R3):** when the kid finalizes activity 3 of 5, one inline Minny moment: `Nửa đường rồi! Con giỏi lắm 🎉` + small confetti via the existing `window.__r2lJuice` hooks (reuse `fireStreakConfetti`). One-shot per lesson, persisted in the lesson state so resume doesn't repeat it. Sessions are 15–25 min for a 7-year-old — this is the pacing breath.

### PHASE_RESULT — restyled with kid tokens + ONE addition (W2 adds the chest later):
- **"Cần ôn 💪" recap (UX audit R1 — close the learning loop):** if any questions ended `second_try`/`revealed`, the result screen shows a compact card list: question → correct answer → `explanation_vi`, kid taps through each (`Đã hiểu ✓`). Pure consolidation — no scoring effect, skippable after the first card. If everything was first-try: `Hoàn hảo! Không có gì cần ôn 🌟` instead.

## 3. Anti-guess mechanics (per activity)

Shared rule for MCQ (Activity A `listening_fill_blank`, C `reading_comprehension`): **2 attempts then reveal.**
- Per question track `attempts: number`, `outcome: 'first_try' | 'second_try' | 'revealed'`.
- Wrong pick #1: option turns red + shake (CSS, respect `prefers-reduced-motion`), becomes disabled, Minny line: `Chưa đúng — con đọc lại truyện thử nhé!` + inline link `📖 Xem lại truyện` (opens the story panel). Do NOT show `explanation_vi` yet.
- Wrong pick #2: correct option highlights green, show `explanation_vi`, tag the question `Cần ôn 💪`, lock the question, auto-advance after 2.5s (or tap).
- Correct: green + existing juice hooks.

**Activity B (`listen_and_order`):** on a wrong order submit, highlight the FIRST misplaced token (orange) with hint `Từ màu cam chưa đúng chỗ`. Same 2-attempt rule; reveal = show the correct sentence ghosted above, kid must tap tokens in the shown order once ("copy mode" — productive repetition), then it locks as `revealed`.

**Activity D (`written_response`):** needs the backend change in §5.
- Block submit while answer < 3 words → nudge `Con viết thêm một chút nhé (ít nhất 3 từ)!`
- After submit: show `Câu mẫu của Minny: "{expected_answer_en}"` under the kid's answer + self-check buttons `Giống ý 👍 / Khác ý, con sửa lại ✏️` (sửa lại reopens the textarea once). Effort-based scoring stays (no auto-grading); outcome recorded as `first_try` when ≥3 words.

**Activity E (`listen_and_speak`):** NO logic change (Whisper feedback + effort-based completion are the live incident safety net). Restyle only.

## 4. Scoring (extract + extend)

Extract pure functions into `src/scripts/r2l-lesson-scoring.mjs` (imported by lesson.astro; testable with `node --test`):
- `questionPoints(outcome)` → `first_try: 1`, `second_try: 0.5`, `revealed: 0`.
- `calculateLessonScore(activityResults)` → keeps the current shape `{correct_count, total_count, wrong_count, score_percent}` but `score_percent` = `round(100 * Σpoints / Σquestions)` over point-tracked activities; activities without per-question outcomes (D, E, retell) keep their current contribution unchanged.
- Submit payload: each entry in `activity_results` gains additive `question_outcomes: [{id, outcome, attempts}]`. Server (`submit-read2lead-lesson.js`) ignores unknown fields today — verify, do not modify it.
- `PASS_THRESHOLD_PERCENT` stays 50 (server-side, untouched).
- W1 off → legacy `calculateLessonScore` math (keep both paths in the module; one flag argument).

## 5. Difficulty by rank — backend dial (repo `read2lead_v0_codex`, branch `v4/a-difficulty-dial`)

**Plumbing (hub):** in `generate-read2lead-pack.js`, read the student's progress state (helpers in `_read2lead-v2-state.js` — import only, no edits) and add to the backend POST body: `rank_points: <number>` (omit if unavailable). Additive — backend must default when absent.

**Backend (`server.py`):** accept optional `rank_points` in `/generate-async-v2`; clamp to int ≥ 0; pass to prompt builder. No schema change, no validator change.

**Prompt (`prompt_v2.py`):** map rank_points → challenge dial (tier thresholds mirror the hub ladder: 9 RP per tier):

| Dial | rank_points | Question guidance appended to the user message |
|---|---|---|
| C1 | 0–17 (Đồng/Bạc) | Find It questions literal (answer is a visible sentence); distractors clearly wrong; written answers = one short sentence |
| C2 | 18–35 (Vàng/Bạch Kim) | default — current behavior, plausible distractors |
| C3 | 36–53 (Kim Cương/Tinh Anh) | distractors are near-misses (same topic, one wrong detail); Think About It / Open Question items require connecting two story facts; written questions ask why/feeling, expect 2 sentences |
| C4 | 54+ (Cao Thủ/Thách Đấu) | C3 + every distractor only ruled out by reading the whole story; Think About It items are inference (not stated literally); written expects opinion + reason |

- **CRITICAL CONSTRAINT:** the server repair `_normalize_activity_schema_shape` force-overwrites each question's `section` to the level's fixed section-mix table. The dial therefore must NOT change the Find It / Think About It / Open Question MIX — it only deepens the questions *within* the existing mix (distractor quality, inference depth, written expectations). Do not touch `LEVEL_RULES_V2` section tables.
- Dial modifies ONLY question-crafting guidance lines. NEVER counts, types, schema keys, section-mix tables, or story rules.
- **Re-enable `expected_answer_en`** for Activity D: change the D spec line to `Question fields: id, question_en, question_vi, expected_answer_en (a short model answer a child could write) — NO hint_vi`. Schema already allows it (optional). Hub uses it in §3.
- Tests (`test_prompt_v2_invariants.py`): dial line present per band; absent rank → C2; counts/keys invariants still green. `pytest tests/ -q` green before commit. **Do NOT merge backend to main** — branch + report, Phương promotes (prompt changes need 4-pack manual QA per V3 rails §2).

## 6. Tests & done-when

- `node --test tests/*.test.mjs` green incl. new scoring tests (outcome points, legacy-path parity, gate state transitions).
- Manual QA on the Cloudflare preview URL (`?w1=1`): gate blocks until read+listen; **read-along mode plays sentences sequentially with live highlight and marks both chips**; story panel opens in every activity; MCQ 2-attempt reveal w/ explanation; B misplaced-token hint; D model-answer compare; forward nav locked; **midpoint celebration fires once (not on resume)**; **result recap lists revealed/second-try questions with explanations**; resume restores phase; **W1 off = byte-identical legacy behavior**.
- Devices: cheap Android Chrome + iPad Safari (the audience).
- Report: branch hashes (hub + backend), test counts, preview URL.

## 7. Do NOT
- Do not refactor/split lesson.astro beyond extracting `r2l-lesson-scoring.mjs` (the WR track does that later).
- Do not touch submit/award server logic, state-core, or KV schema.
- Do not add npm deps. Do not change Activity E logic. Do not alter PASS threshold or XP/coin amounts.
- Do not let the gate trap a kid: if pack has no audio URLs at all, `Nghe` auto-passes (defensive default).
