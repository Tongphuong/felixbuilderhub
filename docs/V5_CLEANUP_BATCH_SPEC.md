# V5 Cleanup batch — CRLF + dead code + asset audit

**Goal:** Tidy repo trước khi V5 Track A/B ship — remove dirty CRLF noise, kill confirmed dead components, audit assets for orphans.
**Owner:** Codex monolith · **Branch:** `codex/v5-cleanup-batch` (off latest origin/main)
**Status:** READY — Phương ack 2026-06-16
**Estimated:** 2-3h Codex (mostly mechanical)
**Principle:** Conservative — delete chỉ khi 100% confirmed unused.

---

## 1. Tasks (3 phases)

### Phase 1: CRLF normalize
- `functions/api/read2lead-speaking-check.js` — dirty từ 5+ waves (line-ending noise, NOT semantic change)
- Action:
  1. Update `.gitattributes` add `*.js text eol=lf` to prevent recur
  2. Force LF normalize all .js files in `functions/api/` + `public/scripts/`
  3. Commit normalize-only diff (no semantic change verify per-file)

### Phase 2: Dead component delete (Astro components)
Em đã grep `count=0` callers from src/pages cho 14 components:
```
ChestBox, ChestOpening, ComboCounter, DailyLoginChest, EggAvatar,
EquipCeremony, HudBar, QuestCard, QuestList, RarityBadge, ShopGrid,
ShopItem, TierAura, XpBar
```

**CRITICAL CAVEAT:** "0 calls from src/pages" KHÔNG có nghĩa dead. Components có thể được import from:
- Other components (component → component)
- `src/lib/*.ts` (programmatic import)
- Test files

**Action per component:**
1. `grep -rln "<ComponentName" src/` (Astro JSX usage)
2. `grep -rln "import.*ComponentName" src/ functions/` (import usage)
3. `grep -rln "ComponentName" tests/` (test usage)
4. If ALL THREE = 0 → confirmed dead → DELETE component file
5. If ANY hit → KEEP, document in cleanup report

**Expected outcomes (em đoán, Codex verify):**
- `ShopGrid.astro`, `ShopItem.astro` — likely confirmed dead (shop.astro doesn't use)
- `TierAura.astro` — likely dead (em already wired CSS direct trong shop.astro hotfix)
- `EquipCeremony.astro` — likely USED via JS template mount (KEEP)
- Others — TBD per grep

### Phase 3: Asset orphan audit
- `public/assets/effects/*.webp` (40 files, W7 disabled but kept for future relaunch — KEEP)
- `public/assets/frames/*.{png,svg}` (31 files, W7 disabled — KEEP)
- `public/assets/monsters/raw/*` (original Kenney source — KEEP for build)
- `public/assets/eggs/*` (W5 v2 used — KEEP)
- `public/assets/minny/*` (mascot? grep usage)
- `public/assets/r2l/*` (legacy? grep usage)

**Action:** for each asset folder, `grep -rln "<folder-name>" src/ functions/ public/scripts/` → if zero hit, REPORT (don't delete, Phương decide).

---

## 2. Files allowed

### CRLF normalize
- `.gitattributes`
- `functions/api/*.js` (LF normalize only, no semantic edit)
- `public/scripts/*.js` (LF normalize only)

### Component delete (confirmed dead only)
- `src/components/read2lead/**/*.astro` — delete subset post-grep
- Update `src/components/read2lead/index.ts` if export drift

### Audit report
- `docs/V5_CLEANUP_AUDIT_REPORT.md` (NEW) — list:
  - CRLF normalize: N files
  - Components deleted: list
  - Components kept (with reason): list
  - Asset folder orphan flags: list
  - Phương decisions pending: list

### Tests
- Full `node --test` must stay green (560/560 baseline). No test additions needed unless component delete breaks import.

### CẤM
- Recorder engine
- Lesson.astro, speaking-check business logic
- W2/W5/W6/W7 active features
- ANY file in Track A or Track B allowlist
- `src/data/monster-parts.json`, `_monster-manifest.js`, `_monster-parts-data.mjs`
- Asset folder DELETE (audit only, no delete in this wave)

---

## 3. Done criteria

1. CRLF noise file `read2lead-speaking-check.js` ✓ clean (dirty tree gone)
2. `.gitattributes` prevents future LF↔CRLF drift
3. Confirmed dead components deleted, kept components documented
4. Asset orphan report written + Phương decision items flagged
5. Full test suite 560/560 green
6. Bundle size delta ≤ +5KB or negative (after dead code removal)
7. Audit report `docs/V5_CLEANUP_AUDIT_REPORT.md` written

---

## 4. Hard constraints

- Conservative — delete ONLY when grep confirms zero usage across src/ + functions/ + tests/
- DO NOT delete assets (audit + report only)
- DO NOT touch business logic (CRLF normalize semantically inert)
- Tests stay green
- One commit per phase (3 commits OK)
- Commit msg ends: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`
- DO NOT push main, push branch + spawn verify request inbox/2026-06-16_v5-cleanup-audit.md
- DO NOT skip hooks

---

## 5. Out of scope

- Code style/lint cleanup (TypeScript strict noise 399 errors — separate session, Phương ack `A` keep)
- Test refactoring
- Bundle optimization
- Asset minification (existing build pipeline)
- Repo restructure (folder rename, etc.)
- AGENT_LOG cleanup (memory of session, keep)

---

## 6. Integration với Track A + B

Track A touches lesson + parent dashboard.
Track B touches shop + monster avatar + manifest.
Track Cleanup touches CRLF + dead components + audit report.

**Zero file overlap** — all 3 can ship parallel waves. Cleanup spec explicitly CẤM Track A + B files.

If conflict at merge time → Cleanup rebase last (since dead-code delete may affect imports if Track A/B reference unused component em mistakenly identified as dead).

---

## 7. Decision items (Codex flag for Phương at end)

Codex MUST flag in audit report:
- Each component em grep-confirmed dead — Codex final verdict + reason
- Each asset folder flagged orphan — recommend keep/delete/move
- Any CRLF normalize that produced semantic diff (should not, but verify)
- Any test failure introduced (must fix or revert)

Phương review report → ack subsequent action.
