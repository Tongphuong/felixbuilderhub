---
description: "Graded rewards and badge system details for Read2Lead"
globs:
  - "functions/api/_read2lead-v2-state.js"
  - "src/pages/read2lead/**"
---

## Graded rewards (shipped 2026-06-22, commit 4502d3f)

Replaces binary pass/fail. Function `gradeRewards(scorePercent)` in `functions/api/_read2lead-v2-state.js`.

| Grade | Threshold | XP | Coins |
|---|---|---|---|
| S | >= 85% | 20 | 25 |
| A | >= 70% | 20 | 15 |
| B | >= 50% | 10 | 8 |
| F | < 50% | 0 | 0 |

## Badge system (shipped 2026-06-22, commit 4502d3f)

9 badges with emoji, exported as `BADGE_DEFINITIONS` from `_read2lead-v2-state.js`. Logic in `refreshBadges()` / `badgeUnlocked()`. Leaderboard renders unlocked badges as pill chips.

| ID | Emoji | Trigger |
|---|---|---|
| first_story | book | completed_packs >= 1 |
| steady_three | target | completed_packs >= 3 |
| pack_10 | trophy | completed_packs >= 10 |
| streak_3 | fire | streak_days >= 3 |
| streak_5 | bee | streak_days >= 5 |
| streak_7 | star | streak_days >= 7 |
| coin_saver | moneybag | coins >= 100 |
| level_climber | chart | unlocked more than 1 level |
| brave_voice | mic | voice_attempts >= 1 |
