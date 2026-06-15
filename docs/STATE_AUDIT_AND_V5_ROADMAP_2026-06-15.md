# State audit + V5 roadmap — 2026-06-15

**Author:** Claude (master) · Phương ack required
**Trigger:** Phương feedback "đang làm bừa, có ý tưởng gì thì làm cái đó"
**Goal:** Reset roadmap focus 2 bài toán Phương: (3.1) speaking quality + feedback, (3.2) art + shop + dopamine. Principle: reuse GitHub repo + OSS libraries thay vì code from scratch.

---

## PART 1 — Honest audit em đã bừa thế nào

### 1.1 Symptom
- 3 waves rush trong 24h: W5 v2 → W6 P1+P2 → W7. Mỗi wave em viết spec → Codex code → verify PASS → push. Không kid validation giữa các waves.
- W7 ship 71 sprites Kenney mixed-source (Particle + UI Pack) → prod visual fail: kid Vodka Bạc I render monster với "electric vết nứt mây" thay vì hiệu ứng đẹp. Đồng tier vẫn render monster sai W5 v2 rules.
- Em focus dopamine cosmetic (W5/W6/W7) thay vì kid learning value (đọc-to threshold, feedback chất lượng, exercises đa dạng).

### 1.2 Root cause em sai
1. **Spec format thiếu visual validation:** em viết "files allowed + tests" nhưng KHÔNG yêu cầu "screenshot equipped item trên monster" pre-ship.
2. **Mixed art source xung khắc:** Kenney Monster (cartoon round) + Particle (game effects sprite) + UI Pack (rectangle panel) = 3 style không cohesive.
3. **Roadmap drift:** mỗi feedback Phương → em propose feature mới (W6 → W7 → V8) mà không pause hỏi "kid value gì?".
4. **Ship dồn dập no kid test:** 3 waves trong 1 session = không time kid test mỗi cái.
5. **Bừa kết hợp:** em ship deputy hotfixes trong rate-limit transitions → Codex tự deploy → bugs chỉ phát hiện khi Phương xem mắt.

### 1.3 Lesson em phải nhớ
- **Visual outcome check trước ship.** Spec art = phải có mockup/preview.
- **Per-item audit** ≠ aggregate audit (em chỉ check sum size, không check per-item).
- **Pause + ask** trước khi propose feature mới. Kid value first.
- **1 wave at a time** với kid validation gate.
- **Reuse > scratch** (Phương nguyên tắc — em phải đi tìm OSS trước).

---

## PART 2 — Prod state hiện tại (tip `d8a5db2`)

### Features LIVE prod main
| Module | Status | Notes |
|---|:---:|---|
| **V4 W1 Hub** | ✅ | `/hoc-sinh` kid landing với mã access |
| **V4 W2 Dopamine** | ✅ | Quests + chests + combo + daily login + Kenney audio |
| **V4 W3 Avatar 2.0** | ✅ | 148 Kenney parts heuristic-tagged |
| **V4 W4 Shop 2.0** | ✅ | Buy parts via xu |
| **V4 W4.5 Kid UX** | ✅ | RarityBadge + InsufficientCoinsModal + UnlockCelebration |
| **V4 W5 v2 Avatar progression** | ⚠️ BUG | Đồng tier_index=0 vẫn render monster (sai spec — phải egg) |
| **V4 W6 P1 Rarity feel** | ✅ | Tier colors + aura + ceremony duration scale + Kenney audio stingers |
| **V4 W7 Decoration slots** | 🔴 BROKEN | Effects "vết nứt mây" trên monster body, frame Kenney UI rectangle không fit. Phương yêu cầu disable. |
| **Mic engine + ASR** | ✅ | R2LRecorder + Whisper backend ổn |
| **Speaking pass** | ⚠️ | Deputy 3 changed gate to **50%** (Phương redirected từ 70%) — branch `codex/r2l-strict-70pct` @ `69c681b` chưa merge |
| **Parent Portfolio** | ✅ | Video upload + parent dashboard |
| **Rank seasons** | ✅ | Mùa 2 tháng + RP cap |

### Branches origin alive (chưa cleanup)
- ✅ `codex/r2l-strict-70pct` — Deputy 3 done, awaiting Phương merge decision
- ⏳ `codex/w7-effect-visibility-fix` — Deputy 1 latest, prod tip `d8a5db2` (đã merge?)
- ⏳ `codex/r2l-emergency-disable-w7-fix-bronze` — Deputy 1 emergency, chưa DONE log
- ⏳ `codex/v5-dictation-mvp` — Deputy 2 dictation, chưa DONE log
- 🗑️ 22 stale branches từ wave trước (v3-*, v4/*, w2r/*, fix/*, feat/*) — cleanup defer

### Pending Codex deputies in-flight
| # | Branch | Status | Action |
|---|---|---|---|
| 1 | `codex/r2l-emergency-disable-w7-fix-bronze` | START 23:48, no DONE | Em check status sau audit |
| 2 | `codex/v5-dictation-mvp` | START 23:45, no DONE | Em check status sau audit |
| 3 | `codex/r2l-strict-70pct` | DONE @ 69c681b | Phương decide merge |

### Dirty tree
- `M functions/api/read2lead-speaking-check.js` — CRLF noise lingering từ 4+ waves trước, defer hoặc commit normalize.

---

## PART 3 — Agent ecosystem hiện tại

### Claude variants
| Agent | Role | Status |
|---|---|---|
| **Master Claude** (em) | Brain + merge main + spec authoring | Active session, ưu tiên rate-limit |
| **Verify-Claude** | 5-lens / 9-lens code audit pre-merge | On-demand per wave |
| **Research-Claude** | Survey OSS libraries + repos | On-demand |
| **Infra-Claude** | Per memory mention — chưa sử dụng wave gần đây | Idle |

### Codex (theo memory `feedback_role_split`)
- **Main coder + deputy mode** khi Claude offline
- Currently spawn 3 deputies parallel (emergency W7 disable, V5 dictation, r2l-strict-70pct)

### Cursor (theo memory)
- "Pure coder" cho parallel tasks không xung đột file
- Wave 4 em đã có 4 Cursor song song với Codex, OK pattern

### 📊 Em đánh giá hiện trạng agent
- ✅ 4-tier Claude (master + verify + research + infra) **đủ scope**
- ✅ Codex deputy mode mạnh khi em offline
- ⚠️ Cursor underutilized — wave 5 em chỉ dispatch Codex monolith. Có thể split parallel tốt hơn.
- ⚠️ **Em ship rush không đợi verify** giữa waves → bypass quality gate em đã design.

### Em recommend cho V5
- Master Claude: spec only, **không tự code** (per memory rule).
- Codex: implement (1 monolith OR 2-3 parallel per spec scope).
- Cursor: split parallel khi có ≥3 file-disjoint task.
- Verify-Claude: 1 audit per wave, BLOCKING gate trước merge prod.
- Research-Claude: pre-wave OSS survey (như đã làm cho V5 nghe-nói).

---

## PART 4 — Cleanup checklist (immediate)

### 4.1 Disable W7 prod (CRITICAL — Phương báo)
- ⏳ Deputy 1 emergency đang execute. Em check status.
- Sau khi disable: refund Vodka 25 xu? Em đề xuất KHÔNG (số nhỏ, kid không notice).

### 4.2 Stale branches cleanup
Em đề xuất delete origin:
- v3, v3-avatar, v3-b-rank, v3-c-shop, v3-d-games, v3-e-juice, v3-fixes, v3-observability (V3 đã merge V4)
- v4-w2, v4/a-lesson-flow, v4/b-game-shell, v4/c-kid-hub (V4 đã ship)
- w2r/r1-rank-core, w2r/r2-rank-ui, w2r/r3-leaderboard (rank seasons đã ship)
- fix/mic-capture-engine, fix/recorder-cache-skew (mic đã stable)
- feat/level-progress-param, test/web-lesson-4-step (cũ)
- codex/avatar-arm-direction, codex/avatar-geometry, codex/lesson-focus-header (đã merge)
- codex/read2lead-mission-m1-m3 (orphan)

→ 22 branches delete batch.

### 4.3 Dead specs cleanup (docs/)
Em đề xuất move to `docs/archive/`:
- V4_W2_*_SPEC.md (5 files — W2 đã ship)
- V4_W3_AVATAR_SPEC.md (W3 đã ship)
- V4_W4_SHOP_SPEC.md + V4_W4_5_SHOP_KID_UX_SPEC.md (W4 đã ship)
- V4_W5_AVATAR_PROGRESSION_SPEC.md (W5 v1 đã superseded by v2)
- V4_W6_P2_DETAILED_SPEC.md (W6 P2 chưa implement — defer or kill)
- V4_W7_DECORATION_SLOTS_SPEC.md (W7 sẽ disable — archive as lesson)
- MINNY_ROADMAP.md (Phase 5 cũ, redundant với V5 roadmap mới này)
- SESSION_HANDOFF.md (snapshot 2026-06-10, obsolete)
- MASTER_EXEC_SPEC_2026-06-09.md
- READ2LEAD_LESSON_UX_REDESIGN_PLAN.md
- SPEC_AVATAR_GEOMETRY_ROOT_FIX.md + SPEC_FIX_HORN_POSITION.md (đã ship)
- SPEC_PARENT_PORTFOLIO.md (đã ship)
- SPEC_W2R_R*.md (đã ship)

→ ~18 docs archive batch. Keep: V4_W5_V2_RANK_EGG_SPEC.md (active reference), V4_W6_RARITY_FEEL_SPEC.md (W6 P1 live), CLEANUP_AUDIT.md, ENV.md, PAGE_AUDIT.md, SEO_A11Y_AUDIT.md, V3_LAUNCH_RUNBOOK.md, PARENT_FAQ_W5_HATCH.md, MINNY_M0_DESIGN_OUTCOME.md, NOTE_LESSON_FOCUS_HEADER_2026-06-12.md, HORN_AUDIT_RESULTS.md.

### 4.4 Dead components
Component grep `count=0` từ pages: ChestBox, ChestOpening, ComboCounter, DailyLoginChest, EggAvatar, EquipCeremony, HudBar, QuestCard, QuestList, RarityBadge, ShopGrid, ShopItem, TierAura, XpBar.

**Caveat:** "0 calls từ src/pages" có thể vì components → components (không page → component). Em sẽ task Codex audit kĩ trước khi delete (false-positive risk).

### 4.5 CRLF noise file
`functions/api/read2lead-speaking-check.js` dirty từ 4+ waves. Em đề xuất: commit normalize CRLF→LF + `.gitattributes` update để prevent recur.

---

## PART 5 — V5 roadmap (Phương 2 bài toán)

### 🎯 Principle (Phương nguyên tắc)
1. **GitHub-first** — survey OSS trước khi propose scratch implementation.
2. **Kid learning value > shipping feature count.**
3. **1 wave at a time + kid validation gate** trước next wave.
4. **No data/security focus** ngay — UX value first.
5. **Per-item visual audit** trước ship art/cosmetic.

### Track A — 3.1: Speaking quality + feedback (kid học thật)

**Goal:** Kid đọc bài → ASR chấm thật → feedback chi tiết → retry nếu fail. KHÔNG cày qua lessons để farm xu.

**Pillars:**

#### A1. Threshold enforcement (Codex Deputy 3 đã làm)
- 50% pass gate (Phương redirect từ 70%)
- Mic error → guided retry, NO auto-pass
- No-reward skip option sau N retries
- Branch `codex/r2l-strict-70pct @ 69c681b` — Phương decide merge

#### A2. Feedback chất lượng (NEW)
Hiện tại score → just "passed/failed". Cần:
- **Phoneme-level feedback:** từ nào sai → highlight + cách phát âm đúng
- **Intonation visual:** waveform overlay native vs kid → kid thấy rhythm gap
- **Replay với slow-down:** kid nghe lại native chậm + so sánh

**OSS to evaluate (Research-Claude already provided):**
- `wavesurfer.js` BSD-3 — waveform display (need 1-line credit)
- `interactjs` MIT — drag tile interactions
- Whisper.cpp WASM — phoneme alignment? Heavy (75MB model)
- **Recommend:** Phương ack scope sau khi em audit research report kĩ

#### A3. Exercise type expansion (Research-Claude 4 types)
Per Codex Deputy 2 proposal: **Dictation MVP** (listen + tile order) = quick win.
- MED 4-6h, no new dep, reuse interaction + audio
- Branch `codex/v5-dictation-mvp` (Codex executing)

Other types defer:
- Shadowing — HIGH 1-3 ngày, complex audio sync
- Listen-and-produce — MED 6-8h
- Repetition (ts-fsrs) — LOW 1-2h engine (Phương ack sau)

#### A4. Kid học thật metrics (NEW)
Spec mới em viết:
- Per-pack: % first-try pass, % retry rate, time-to-pass
- Anti-cheat: detect random taps, suspicious audio length, missing speak attempt
- Parent dashboard: 7-day learning quality score (không chỉ count pack done)

### Track B — 3.2: Art + shop + dopamine (curated)

**Goal:** Cosmetic items kid thực sự MUỐN sở hữu + clearly fit monster style.

**Pillars:**

#### B1. KILL W7 mixed-source disaster (emergency)
- Disable effects + frame slots (Deputy 1 đang execute)
- Refund? KHÔNG (số nhỏ)
- Keep state field `unlocked_parts` cho items effects/frame đã mua (preserve nếu kid quay lại sau curated relaunch)

#### B2. V5 Art guideline (NEW critical)
**Rule:**
1. **1 source style per cosmetic category** (không mix Kenney Monster + Particle + UI cùng cosmetic)
2. **Per-item screenshot pre-ship** — em + Codex mockup mỗi item equipped trên 3 monster sample
3. **Kid value test:** "Kid 7 tuổi nhìn item này có hỏi 'cái gì đẹp thế?'"

**Curated art sources (research em đã có + thêm):**
- **Kenney Monster Builder** ✅ already used (148 parts)
- **Game-icons.net** CC BY — pet/hat (silhouette tintable, em đã propose nhưng chưa ship)
- **OpenGameArt Portrait Frame** CC0 — frame backup
- **NEW candidate:** Roblox-style avatar accessory packs (cần Research-Claude survey)

#### B3. Replace W7 với V5 cosmetic (real items)
Spec mới em viết V5_COSMETIC_REDESIGN:
- **Hat** (Game-icons silhouette tinted) — 20 items, clear shape: cap/crown/helmet/party hat
- **Pet** (Game-icons animal silhouette) — 15 items, render bên cạnh monster (separate slot)
- **Wings** (RGS_Dev cartoon) — 8 items, render behind monster
- **NO abstract particles**, NO mixed style.

#### B4. Dopamine loop refinement
Hiện W2 dopamine ổn. Cần thêm:
- **Achievement system** (W6 P2 spec đã viết nhưng chưa ship — defer or revive)
- **Daily streak rewards** (W2 đã có nhưng có thể tăng visual)
- **Leaderboard cosmetic flair** (W6 P2 §5)

### 🚫 Out of scope V5 (per Phương)
- Data/security/scale concerns
- Multi-user collaboration features
- Backend infrastructure rewrite
- Mobile native app (web only)

---

## PART 6 — Immediate next actions (em ưu tiên)

### 6.1 Em làm ngay sau Phương ack roadmap này

1. **Check Deputy 1 emergency status** (W7 disable) — push prod nếu DONE
2. **Check Deputy 2 dictation status** — verify nếu DONE
3. **Decision Deputy 3 70%/50%** — Phương quyết merge hay reverse
4. **Cleanup batch:** delete 22 stale branches + archive 18 dead specs (1 PR sạch)
5. **Spec V5 Track A** (speaking feedback quality) — 1 wave detailed
6. **Spec V5 Track B** (cosmetic redesign + W7 replace) — 1 wave detailed

### 6.2 Phương cần decide
| Decision | Options | Em recommend |
|---|---|---|
| Merge Deputy 3 (50% gate)? | A. Merge / B. Revert / C. Change to 70% | **A** — Codex notes Phương đã redirect = ack rồi |
| Merge Deputy 2 dictation? | A. Merge / B. Wait verify | **B** — đợi Verify-Claude audit first |
| Pursue V5 Track A (feedback quality) prior B (cosmetic)? | A → B / B → A / parallel | **A first** — kid value > cosmetic, W7 disable đủ giải quyết B short-term |
| Cleanup batch giờ hay sau? | Giờ / wait | **Giờ** — 22 branches + 18 docs đè AGENT_LOG search |
| W6 P2 spec defer hay kill? | Defer / Kill / Implement | **Kill** — chỉ làm khi kid thực sự cần (chưa thấy) |

---

## Summary table cho Phương

| Topic | Em đề xuất | Risk |
|---|---|---|
| Cleanup 22 stale branches + 18 dead specs | Codex 1 PR batch, em verify | LOW |
| W7 disable | Deputy 1 đang execute, em monitor | MED (deploy may break) |
| Deputy 3 merge | Yes (Phương đã ack 50%) | LOW |
| Deputy 2 dictation verify-then-merge | Verify-Claude audit | LOW |
| Spec V5 Track A speaking feedback | Em viết next, OSS-first | MED |
| Spec V5 Track B cosmetic redesign | Em viết sau A, art guideline strict | MED |
| Kill W6 P2 spec | Archive, no impl | LOW |
| Pause 1 ngày cho kid test trước V5 | Optional | LOW |

Phương ack → em execute.
