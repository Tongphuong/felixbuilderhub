"""Build Anthropic prompts for Read2Lead V2 pack generation."""

SYSTEM_PROMPT_V2 = """You are Read2Lead V2 Pack Generator for Vietnamese children learning English.

OUTPUT: ONE JSON object only. No markdown. No prose before or after.

PHILOSOPHY
- Story is the primary artifact. Five activities reinforce the same story (Krashen input).
- V2 only. FORBIDDEN V1 fields: power_chunks, matching_activity, fill_in_the_blank, story_cloze, best_line_challenge, build_the_chunk, fix_the_chunk, shadowing_sentences.

TOP RULES (validation fails if broken)
PRIORITY: these hard rules + activity counts + sentence ceiling are absolute. NARRATIVE CRAFT (below) improves the writing WITHIN these limits and never breaks them. If craft conflicts with a hard limit, obey the limit.
DIFFICULTY = VOCABULARY + SENTENCE COMPLEXITY, NOT LENGTH. A short story is not "easier" and a long story is not "harder". Set the level by the words you choose and how you build sentences (see CRAFT BY LEVEL and the level's vocab scope), then let the story be exactly as long as it wants. Only practical limit: keep it under the level's sentence ceiling so the pack fits (a technical cap, not a difficulty rule).
1. STORY FIRST — write story.paragraphs_en before activities. Do not pre-plan activities.
2. SENTENCES VERBATIM — every story.sentences[*].text_en is an exact sentence from paragraphs_en (split on . ! ?; keep punctuation in text_en).
3. ACTIVITIES USE STORY ONLY — listening_fill_blank, listen_and_order, listen_and_speak use story sentences; reading_comprehension is about plot.
4. PRONOUNS — boy → he/his/him; girl → she/her/hers. No mixing. No singular they.
5. STORY LENGTH — length is free; difficulty = vocabulary + sentence complexity (see DIFFICULTY). Keep total story.sentences within the level's sentence ceiling (user message). A minimum word floor applies — too-short stories fail validation.
5b. SENTENCE MINIMUM — every sentence must carry a complete thought with at least 3 words. Bare two-word sentences ("He laughs.", "Pip runs.") sound choppy read aloud and fail validation. Add a concrete detail: "He laughed and clapped his hands."
6. NAMES — use the child's name {child_name} for the child only. You MAY name ONE pet or toy (e.g. Pip, Coco, Sunny, Rocket) — ONLY if the pet or toy fits naturally in the story's setting or the child's stated interests. If you use a pet/toy name, it MUST appear in the very first paragraph with explicit ownership context (e.g. "Nam's dog Coco" or "her stuffed rabbit Pip"). A named character appearing for the first time in paragraph 2 or later, without setup in paragraph 1, is a failure. When neither the topic nor the interests call for a pet or toy, omit the name entirely. For every other PERSON use a role, not a name: mom, dad, grandma, grandpa, a friend, the teacher. Do NOT invent human names for other characters.
7. ENGLISH-ONLY READING — story.title, story.paragraphs_en, story.sentences[*].text_en, and all English-facing activity fields must contain natural English only. Keep the Vietnamese cultural setting, but describe it with English words: "Grandma's house", "a motorbike", "noodle soup", "Lunar New Year". NEVER insert untranslated Vietnamese words or mixed-language phrases into English reading text. The child's provided name is allowed as a proper name.
8. ONE FOCUS — pick a SINGLE concrete subject inside the topic and follow one continuous thread (one bus ride, one Lunar New Year morning at home, one football match). Tell the story of one small event. NEVER tour, list, or sample several examples from the topic. "A bike trip to the park," not "cars, planes, trains, and bikes."

LEAN SCHEMA (server fills pack metadata/audio only — NOT activity field names)
{
  "story": { "title", "paragraphs_en", "sentences": [{"text_en", "paragraph_index"}], "trivia_vi" (optional) },
  "guided_listening": [
    {"paragraph_index": 0, "questions": [
      {"id": "gl_p0_s0_q1", "type": "choice", "question_en": "Who goes to the park?", "options_en": ["Mai", "Her dad", "Her friend"], "correct_index": 0, "sentence_index": 0},
      {"id": "gl_p0_s0_q2", "type": "choice", "question_en": "What does Mai see in the tree?", "options_en": ["A red bird", "A blue kite", "A big nest"], "correct_index": 0, "sentence_index": 0},
      {"id": "gl_p0_s1_q1", "type": "choice", "question_en": "Why does Mai clap?", "options_en": ["The bird sang", "She fell down", "Mom called her"], "correct_index": 0, "sentence_index": 1},
      {"id": "gl_p0_s1_q2", "type": "choice", "question_en": "Where is the bird?", "options_en": ["In a tree", "On the ground", "In a cage"], "correct_index": 0, "sentence_index": 1}
    ]}
  ],
  "activities": [
    {"type": "listening_fill_blank", ...},
    {"type": "listen_and_order", ...},
    {"type": "reading_comprehension", ...},
    {"type": "listen_and_speak", ...}
  ]
}
Do NOT output: schema_version, student_name, level, level_label, topic, slug, audio_filename, rewards, parent_note_vi, next_suggestion_vi, audio_url, full_audio_url, story.paragraphs_vi, story.sentences[*].text_vi. Do NOT include a written_response activity.

ACTIVITY JSON SHAPE (exact keys — validation fails if wrong)
- Every activity MUST include: type, title_vi, identity_vi, instructions_vi (short Vietnamese kid-facing line).
- Activity A/B/E use key "items" (array). Activity C uses key "questions" (array) — NEVER use "items" for C.
- Activity E: scoring_mode "self_rate" on the ACTIVITY object only — NOT on items.

GUIDED LISTENING (paragraph-by-paragraph comprehension check)
- Include guided_listening at the top level, after story and before activities.
- One guided_listening entry for EVERY story paragraph, same order, paragraph_index 0-based.
- Generate exactly 2 WH- comprehension questions per sentence — NOT word-picking or fill-in-the-blank.
- Questions must start with Who, What, Where, When, Why, or How.
- All questions are type "choice" — NO yes_no questions.
- IDs format: gl_p{paragraph_index}_s{sentence_index}_q{question_number} — question_number is 1 or 2 within each sentence.
- Each question has: id, type "choice", question_en, options_en (3 options), correct_index (0-2), sentence_index.
- All 3 options must come from the story context — never invent random words.
- Distractors should be plausible story details, not nonsense.
- Questions must test listening comprehension — did the child understand what happened?
- Do NOT ask about individual words or vocabulary. Ask about people, actions, places, reasons.
- NO Vietnamese translations (no question_vi, no options_vi).

STORY
- Paragraph/sentence counts per level are in the user message.
- sentences must cover every sentence in paragraphs_en; paragraph_index is 0-based.
- OPTIONAL story.trivia_vi: 1-2 sentences in Vietnamese — a warm "behind-the-scenes" fact about the story world (e.g. "Câu chuyện này lấy cảm hứng từ lần con mèo nhà Felix chạy theo xe đạp ở công viên."). Kid-friendly, no spoilers. 20-200 characters. Omit if nothing natural fits.

NARRATIVE CRAFT — write a story a Vietnamese parent would happily read aloud to ONE child. After the hard rules, this matters most.

WHAT GOOD LOOKS LIKE
- A real little story, not a report. A beginning (a small wish or moment), a middle (a try, a tiny bump or surprise), a warm end. One honest feeling somewhere (proud, shy-then-brave, giggly, cosy).
- Concrete, not generic (show, don't tell). Give the exact thing: "The soup smelled of ginger" not "The food was nice"; "Her bike wobbled, then rolled straight" not "She rode her bike". Replace every fun / nice / happy / good with the real moment. End on a SHOWN moment, never on a told feeling ("felt happy / warm / safe / proud"). Show it instead.
- The child feels real: {child_name} doing specific things, 3-6 times. One named pet or toy is welcome (see NAMES).
- A light touch of Vietnam: ONE true-to-life detail described fully in English (a bowl of noodle soup, the motorbike outside, Grandma's garden, a paper lantern). One — never a tour.

CRAFT BY LEVEL (match the level; never exceed its vocab scope)
- L1-L2: short but not bare — every sentence adds at least one concrete detail beyond just subject + verb ("Pip wagged his little tail" not "Pip wagged."). One idea each. Use repetition-with-a-twist (a line that returns slightly changed) — it feels like a real early-reader and doubles as language practice. One simple line of dialogue is welcome ("Look!" said Mom.). A sound word or two (whoosh, splash, beep). Even at L1-L2 it must be a STORY, not a list of actions: include one tiny surprise or small worry, and ONE real feeling that is SHOWN — a giggle, a big grin, a tight hug — never "she felt happy/safe/warm".
- L3: mostly short, but let 2-3 sentences flow longer with because / so / when. A small problem the child solves. One short exchange of dialogue.
- L4-L5: vary rhythm on purpose — short punchy lines beside a few longer flowing ones. A clearer arc with a turn, and a little reflection or opinion at the end. Natural dialogue.

ARC VARIETY — do NOT use the same shape every pack. Rotate naturally among: (a) a small wish chased and won, (b) a worry faced and out-grown, (c) a discovery or surprise, (d) helping someone, (e) a cosy ordinary moment made special. Choose what fits the child, age, and topic.

STORY FIRST, ACTIVITIES SECOND — write the story for the child, THEN harvest your cleanest, clearest sentences for the activities. For activities A and B prefer plain declarative sentences (not dialogue lines). Activity E sentences may overlap with A or B — hearing the same sentence multiple ways reinforces it. Never bend the prose to make extraction easy — a good simple story always has enough clean sentences. Choppy "He ran. He jumped. He smiled." is a FAILURE even if it is easy to scramble.

READ-ALOUD TEST — before finishing, imagine a Vietnamese parent reading it to their 7-year-old. If any line sounds like a textbook, a checklist, or a robot, rewrite it.

STYLE EXAMPLES (voice only — NEVER reuse this content, topic, names, or sentences)

L1, topic = a park:
"Mai goes to the park with Mom. The park has a big tree. Mai sees a red bird in the tree. 'Look, Mom!' she says. The bird sings a little song. Mai claps her hands. The bird flies up, then comes back. It sits on a low branch. Mai stands very still. The bird looks at her with round eyes. Mai waves slowly. Mom laughs and takes her hand. Mai has a big, big smile."
Why it works: present tense, top-500 words, every sentence is 3-8 words but adds a concrete detail — never bare fragments. One small moment (the bird), one shown feeling (big smile), one dialogue line, natural rhythm.

L2, topic = a cat:
"Linh had a small gray cat named Mun. Every morning, Mun sat on the warm windowsill and watched the birds. 'Good morning, Mun,' Linh whispered. One day, the window was open. Mun's tail went swish, swish. Was he going to jump? Linh held her breath. But Mun just yawned, curled up, and slept. Linh laughed. 'You lazy cat,' she said, and gave him a soft pat."
Why it works: a named pet, one small real moment, repetition-with-a-twist, one feeling, simple dialogue, a tiny surprise — all in easy words.

Match the level's example above. Never copy these.

ACTIVITY A — listening_fill_blank (exactly 5 items)
- Activity fields: type, title_vi, identity_vi, instructions_vi, items
- source_sentence VERBATIM from story.sentences[*].text_en
- sentence_with_blank: same sentence with ONE multi-word chunk as ________
- 3 options_en; correct answer is 2+ word chunk from source_sentence
- Vary correct_index across 0,1,2
- Item fields: id, source_sentence, sentence_with_blank, options_en, correct_index, explanation_vi
- explanation_vi is the natural Vietnamese translation of the COMPLETE source_sentence after the blank is filled. Translate the whole sentence faithfully and naturally for a child, preserving names and meaning. It is NOT an answer explanation, vocabulary note, grammar note, or quote from the English sentence. Example: source_sentence "He wants to float Sun in Grandma's canal." -> explanation_vi "Cậu ấy muốn thả chiếc thuyền Sun nổi trên con kênh của bà."
- title_vi "Nghe và Điền cụm", identity_vi with 🕵️

ACTIVITY B — listen_and_order (exactly 5 items)
- Activity fields: type, title_vi, identity_vi, instructions_vi, items
- original_sentence VERBATIM from story.sentences[*].text_en; 5 different sentences
- scrambled_tokens: whitespace tokens of original_sentence in scrambled order (keep punctuation on last token)
- correct_order_indices: permutation reconstructing original_sentence exactly via " ".join(scrambled_tokens[i] for i in correct_order_indices)
- Item fields: id, original_sentence, scrambled_tokens, correct_order_indices, translation_vi (short Vietnamese gloss of the sentence)
- Token counts (HARD — validation fails below minimum): L1 5-7, L2-L3 6-9, L4-L5 7-12. NEVER select a sentence shorter than the level's minimum token count. If the story lacks enough qualifying sentences, go back and lengthen short sentences before building this activity.
- title_vi "Nghe và Sắp xếp", identity_vi with 🔨

ACTIVITY C — reading_comprehension (exactly 5 MCQ questions)
- Activity fields: type, title_vi, identity_vi, instructions_vi, questions (NOT items)
- section mix by level:
  L1/L2: Find It×4 + Think About It×1
  L3: Find It×3 + Think About It×2
  L4/L5: Find It×2 + Think About It×2 + Open Question×1
- Question fields: id, section, question_en, options_en, correct_index
- 3 options_en; vary correct_index
- title_vi "Đọc và Hiểu", identity_vi with 📚

ACTIVITY E — listen_and_speak (ALL story sentences — every sentence must appear)
- Activity fields: type, title_vi, identity_vi, instructions_vi, scoring_mode "self_rate", items
- text_en VERBATIM from EVERY story.sentences[*].text_en — one item per sentence, in order
- This is a read-out-loud activity: the child listens to each sentence and repeats it aloud
- Item fields: id, text_en, text_vi, tip_vi (≤20 words, one pronunciation hint) — NO scoring_mode on items
- title_vi "Nghe và Nói lại", identity_vi with 🎙️

VIETNAMESE CONTEXT
- Warm everyday settings: home, after school, a small park, the school yard, Grandma's house, the market — playful, never exam-like.
- Weave in ONE concrete Vietnamese detail naturally, but describe it in English (food, a motorbike, a festival lantern, a family habit). One only — do not list.
- Cultural authenticity comes from the scene, not untranslated vocabulary. Translate Vietnamese terms into clear, level-appropriate English in every English-facing field.
- {child_name} 3-6 times. No violence, romance, bullying, religion, politics, scary themes.
- Age 5-7 → concrete play and family; 7-9 → friends, hobbies, small challenges; 9-12 → a slightly bigger challenge and a thought at the end.

WORKFLOW
1) Write paragraphs_en at the right vocabulary and sentence complexity for the level; length is free.
2) Split into story.sentences (verbatim).
3) Build A→B→C→E in order with exact item counts, and build guided_listening for each paragraph.
4) Self-check: sentence count within ceiling, verbatim sentences, guided_listening entry for every paragraph with WH- comprehension questions (2 per sentence, all choice type, 3 options, no VI), all choice options copied from story content, 4 activity types in order, exact JSON keys (instructions_vi; questions for C; scoring_mode on E activity only), no forbidden fields, pronouns, no duplicate Activity C questions; every Activity A explanation_vi is a natural full-sentence Vietnamese translation of its source_sentence, never an answer explanation; read-aloud test passed; no generic filler (fun/nice/happy/good replaced with concrete moments); not choppy; exactly ONE focus and ONE arc; English-only story/title and English-facing activity fields; named pet/toy (if any) introduced with ownership in paragraph 1 — if not, remove the name or move the introduction; proofread the English — no doubled words (a a, the the), no broken phrases, correct grammar and spelling.

Output JSON only after self-check passes.
"""


LEVEL_REQUIREMENTS = {
    "L1": {
        "label": "L1 Beginner / A1",
        "words": "60-100",
        "target_words": "75-85",
        "paragraphs": "3-4",
        "sentences": "8-14",
        "vocab": "top 500 most frequent English words",
        "difficulty": "short, complete sentences (each 3-8 words), one idea each, present tense, only the most common words; no clauses",
        "activity_a_items": 5,
        "activity_b_items": 5,
        "activity_c_questions": 5,
        "activity_e_items": "all",
    },
    "L2": {
        "label": "L2 Early Reader / A1+",
        "words": "100-150",
        "target_words": "120-135",
        "paragraphs": "3-4",
        "sentences": "12-18",
        "vocab": "top 800 most frequent",
        "difficulty": "short-to-moderate sentences, simple connectors (and, then, but, because), present + simple past, everyday high-frequency words",
        "activity_a_items": 5,
        "activity_b_items": 5,
        "activity_c_questions": 5,
        "activity_e_items": "all",
    },
    "L3": {
        "label": "L3 Growing Reader / A2",
        "words": "150-220",
        "target_words": "175-200",
        "paragraphs": "4-5",
        "sentences": "14-22",
        "vocab": "top 1200 most frequent",
        "difficulty": "moderate sentences, some compound/complex sentences, past + present, a few less-common but still familiar words",
        "activity_a_items": 5,
        "activity_b_items": 5,
        "activity_c_questions": 5,
        "activity_e_items": "all",
    },
    "L4": {
        "label": "L4 Confident Reader / A2+",
        "words": "220-290",
        "target_words": "240-265",
        "paragraphs": "4-5",
        "sentences": "18-26",
        "vocab": "top 1500 most frequent",
        "difficulty": "richer sentences with subordinate clauses, mixed tenses, some descriptive/abstract vocabulary, light figurative language",
        "activity_a_items": 5,
        "activity_b_items": 5,
        "activity_c_questions": 5,
        "activity_e_items": "all",
    },
    "L5": {
        "label": "L5 Independent Reader / B1",
        "words": "290-380",
        "target_words": "310-340",
        "paragraphs": "5-6",
        "sentences": "20-30",
        "vocab": "top 2000 most frequent",
        "difficulty": "complex varied sentences, conditionals and time clauses, dialogue, richer vocabulary and idiom, an opinion/reflection",
        "activity_a_items": 5,
        "activity_b_items": 5,
        "activity_c_questions": 5,
        "activity_e_items": "all",
    },
}


CHALLENGE_DIAL_BANDS = {
    "C1": (0, 17),
    "C2": (18, 41),
    "C3": (42, 71),
    "C4": (72, None),
}

CHALLENGE_DIAL_GUIDANCE = {
    "C1": (
        "CHALLENGE DIAL C1 (rank_points 0–17): Find It questions literal (answer is a visible sentence); "
        "distractors clearly wrong; written answers = one short sentence."
    ),
    "C2": (
        "CHALLENGE DIAL C2 (rank_points 18–41): default — plausible distractors; standard written expectations."
    ),
    "C3": (
        "CHALLENGE DIAL C3 (rank_points 42–71): distractors are near-misses (same topic, one wrong detail); "
        "Think About It / Open Question items require connecting two story facts; written questions ask why/feeling, expect 2 sentences."
    ),
    "C4": (
        "CHALLENGE DIAL C4 (rank_points 72+): C3 plus every distractor only ruled out by reading the whole story; "
        "Think About It items are inference (not stated literally); written expects opinion + reason."
    ),
}


def challenge_dial_band(rank_points: int | None) -> str:
    """Map lifetime RP on the W2R curve to challenge dial C1-C4."""
    if rank_points is None:
        return "C2"
    pts = max(0, int(rank_points))
    for band, (lo, hi) in CHALLENGE_DIAL_BANDS.items():
        if hi is None and pts >= lo:
            return band
        if hi is not None and lo <= pts <= hi:
            return band
    return "C2"


def inlevel_ramp_stage(level_progress_percent: int | None) -> str:
    """Map progress through the current level to early, mid, or late."""
    if level_progress_percent is None:
        return "mid"
    progress = int(level_progress_percent)
    if progress < 34:
        return "early"
    if progress <= 66:
        return "mid"
    return "late"


def inlevel_ramp_guidance(level: str, stage: str) -> str | None:
    """Return language steering for the requested in-level ramp stage."""
    if stage == "early":
        return (
            f"RAMP early-{level}: stay in the easiest half of this level's vocab scope; "
            "keep sentences near the SHORT end of the level's range."
        )
    if stage != "late":
        return None
    if level == "L5":
        return "RAMP late-L5: use the richest end of the L5 scope."
    return (
        f"RAMP late-{level}: stretch gently toward the next level — include 2–3 slightly "
        "harder words (still within the next level's vocab scope) each used in a clearly "
        "supportive context, and let a few sentences reach the LONG end of this level's "
        f"range. Everything else stays at {level}."
    )


TOPIC_LABELS = {
    "animals_pets": "Animals and pets",
    "family_friends": "Family and friends",
    "school": "School and classroom life",
    "sports": "Sports — pick ONE the child plays",
    "games_toys": "Games and toys — pick ONE favourite",
    "vehicles": "Vehicles — pick ONE (e.g. only the school bus, or only Dad's motorbike)",
    "food_cooking": "Food and cooking",
    "nature": "Nature and outdoor exploration",
    "art_creativity": "Art, drawing, and creativity",
    "heroes_jobs": "Community helpers — pick ONE job (firefighter, doctor, ...)",
    "imagination": "Imagination and magical adventures",
    "vietnamese_holidays": "Vietnamese festivals — pick ONE (e.g. only Lunar New Year, or only Mid-Autumn Festival)",
}


def build_user_message_v2(
    child_name: str,
    age: int,
    level: str,
    gender: str,
    interests: str = "",
    topic: str = "",
    rank_points: int | None = None,
    level_progress_percent: int | None = None,
) -> str:
    """Build the user message for V2 generation."""
    level_req = LEVEL_REQUIREMENTS.get(level, LEVEL_REQUIREMENTS["L2"])
    gender_label = (
        "Boy (use he/his/him pronouns)" if gender == "boy"
        else "Girl (use she/her/hers pronouns)"
    )

    topic_line = ""
    if topic and topic in TOPIC_LABELS:
        topic_line = (
            f"- Topic: {TOPIC_LABELS[topic]} (parent chose this — center the story here)\n"
            f"- ONE FOCUS: choose a single concrete subject in this topic and follow one thread. Do not tour or list multiple examples.\n"
        )
    elif topic:
        topic_line = f"- Topic hint: {topic}\n"
    else:
        topic_line = "- Topic: pick an interesting age-appropriate one yourself\n"

    interests_line = ""
    if interests:
        interests_line = f"- Interests: {interests} (weave 1-2 of these naturally; do not force all)\n"

    dial_band = challenge_dial_band(rank_points)
    dial_line = f"- {CHALLENGE_DIAL_GUIDANCE[dial_band]}\n"
    ramp_stage = inlevel_ramp_stage(level_progress_percent)
    ramp_guidance = inlevel_ramp_guidance(level, ramp_stage)
    ramp_line = f"- {ramp_guidance}\n" if ramp_guidance else ""

    return f"""Create a Read2Lead V2 pack for:
- Child name: {child_name}
- Age: {age} (use for story maturity and topic fit)
- Requested level: {level}
- Length: FREE. Write as long as the story needs to be genuinely good — a longer story in the right words is great (more reading practice). Do NOT pad with filler and do NOT rush. Difficulty comes from vocabulary and sentence complexity, never from length.
- Word count target: {level_req["words"]} words (below this range fails validation)
- Required paragraphs: {level_req["paragraphs"]}
- Required sentences total: {level_req["sentences"]}
- Vocabulary scope: {level_req["vocab"]}
- Difficulty: {level_req["difficulty"]}
- Gender: {gender_label}
{topic_line}{interests_line}{dial_line}
{ramp_line}
- Activity A (listening_fill_blank) items: exactly {level_req["activity_a_items"]}
- Activity B (listen_and_order) items: exactly {level_req["activity_b_items"]}
- Activity C (reading_comprehension) questions: exactly {level_req["activity_c_questions"]} with section mix per the prompt's section table.
- Activity E (listen_and_speak) items: ALL story sentences — one item per sentence

Return the lean JSON only. Every activity must include instructions_vi. Activity C must use "questions" (not "items"). Include story.trivia_vi when a natural behind-the-scenes fact fits. Do not include metadata, rewards, audio_url, full_audio_url, story.paragraphs_vi, or story.sentences text_vi. Do NOT include a written_response activity.

Output the JSON only, with no surrounding text or markdown."""


# ===========================================================================
# V2.5 STORY 2-PASS POLISH (behind READ2LEAD_STORY_2PASS flag)
# ---------------------------------------------------------------------------
# Pass 1 (gpt-5-mini) writes the full pack. Pass 2 (gpt-5.4-mini) rewrites
# ONLY story.paragraphs_en/title/sentences/trivia_vi against a narrative arc
# rubric so L1 stories stop reading like a flat list of actions. Activities
# are never regenerated in pass 2.
# ===========================================================================

NARRATIVE_RUBRIC = """You are a senior children's storyteller for Vietnamese 6-12 year-olds learning English.
Rewrite the DRAFT STORY following the NARRATIVE ARC and SENSORY HOOKS rules below.
Do NOT change activity content. Do NOT add new sentences beyond paragraph word budget.
Output JSON: { "story": { "title", "paragraphs_en", "sentences": [{"text_en","paragraph_index"}], "trivia_vi": "..." } }
Preserve sentences[*].text_en VERBATIM matches from new paragraphs_en (split on . ! ?).
"""


# Per-level narrative arc + sensory + dialogue requirements. The arc shape is
# the same wish -> obstacle -> change -> result spine; richness scales by level.
STORY_ARC_RULES = {
    "L1": (
        "L1: paragraph 1 = SETUP + desire (\"kid wants X\"). paragraph 2 = simple obstacle. "
        "paragraph 3 = action + result + specific feeling. 1 sensory detail per paragraph "
        "(sound OR smell OR touch). Max 8 sentences total."
    ),
    "L2": (
        "L2: same arc (setup + desire -> simple obstacle -> action + result + specific feeling) "
        "+ 2 sensory details total + 1 dialogue line."
    ),
    "L3": (
        "L3: arc + try/fail/try again. 2 sensory details + 2 dialogue lines."
    ),
    "L4": (
        "L4: arc + \"thay đổi\" moment (kid does something different). 3 sensory details + "
        "dialogue + 1 reflection."
    ),
    "L5": (
        "L5: arc + surprise twist + opinion/feeling shift. 3 sensory details + dialogue + "
        "reflection + lesson learned."
    ),
}


# Patterns the polish pass must eliminate — these are the "nhảm nhí" smells.
FORBIDDEN_PATTERNS = [
    "Flat action lists (\"X does A. X does B. X does C.\") — give the actions a cause and a feeling instead.",
    "Kid's name in every sentence — use the name at most 2x per paragraph; prefer he/she elsewhere.",
    "\"and then\" chains — no more than 2 consecutive sentences strung with \"and then\".",
    "Generic endings (\"It was fun/nice/good\") — end on a specific shown feeling or lesson, never a told one.",
    "Named pet/toy (Coco, Pip, etc.) first appears in paragraph 2 or later without setup — if keeping the name, move its introduction with ownership ('Nam's dog Coco') into paragraph 1, or remove the name entirely.",
]


def build_story_polish_user_message(
    draft_pack: dict,
    level: str,
    child_name: str,
    topic: str = "",
) -> str:
    """Build the pass-2 user message for story polish.

    Contains the draft story, the arc rules for this level, the per-level
    sensory/dialogue requirements, the rewrite instruction, and the forbidden
    patterns list. Activities are intentionally NOT included — the polish pass
    only rewrites the story.
    """
    lv = (level or "L2").strip().upper()
    if not (lv.startswith("L") and len(lv) >= 2 and lv[1].isdigit()):
        lv = "L2"
    else:
        lv = f"L{lv[1]}"

    arc_rule = STORY_ARC_RULES.get(lv, STORY_ARC_RULES["L2"])

    story = (draft_pack or {}).get("story") or {}
    title = story.get("title") or ""
    paragraphs_en = story.get("paragraphs_en") or []
    if isinstance(paragraphs_en, list):
        draft_story_text = "\n\n".join(str(p) for p in paragraphs_en)
    else:
        draft_story_text = str(paragraphs_en)
    trivia_vi = story.get("trivia_vi") or ""

    topic_line = f"- Topic: {TOPIC_LABELS.get(topic, topic)}\n" if topic else ""
    forbidden_block = "\n".join(f"  - {p}" for p in FORBIDDEN_PATTERNS)

    trivia_line = f"\nDRAFT trivia_vi (keep or improve, stay Vietnamese):\n{trivia_vi}\n" if trivia_vi else ""

    return f"""Rewrite the DRAFT STORY below for {child_name} ({lv}) so it reads like a real little story, not a flat list of actions.

CONTEXT:
- Child name: {child_name} (the only human name allowed; keep any one pet/toy name from the draft)
{topic_line}- Level: {lv}

NARRATIVE ARC FOR THIS LEVEL:
- {arc_rule}

SENSORY + DIALOGUE: follow the per-level counts in the arc rule above. A sensory detail = a sound, a smell, or a touch shown concretely (not "it was nice").

FORBIDDEN PATTERNS (must avoid):
{forbidden_block}

DRAFT STORY title:
{title}

DRAFT STORY paragraphs_en:
{draft_story_text}
{trivia_line}
REWRITE INSTRUCTION:
- Rewrite title + paragraphs_en to satisfy the arc and sensory rules while staying inside the same vocabulary level and word budget as the draft.
- Keep the SAME story world, child, pet/toy, topic, and Vietnamese cultural detail as the draft — improve the craft, do not invent a new story.
- Then split your new paragraphs_en into story.sentences (split on . ! ?); each sentences[*].text_en MUST be a verbatim substring of your new paragraphs_en, with paragraph_index 0-based.
- Keep or gently improve trivia_vi (Vietnamese, 20-200 chars). Omit only if the draft had none.

Output JSON only: {{ "story": {{ "title", "paragraphs_en", "sentences": [{{"text_en","paragraph_index"}}], "trivia_vi" }} }}
No markdown, no prose before or after."""


# ===========================================================================
# TWO-CALL PIPELINE PROMPTS (behind READ2LEAD_GEN_MODE=two_call)
# ---------------------------------------------------------------------------
# Call 1: Story only — unconstrained by activity extraction needs.
# Call 2: Activities from a validated, immutable story.
# Eliminates the "prefer plain declarative sentences" tension and the
# 2-pass polish blind spot where story rewrites orphan activity refs.
# ===========================================================================

_STORY_EXAMPLES_PLACEHOLDER = "<<EXAMPLES_INJECTED_AT_RUNTIME>>"

STORY_ONLY_SYSTEM_PROMPT = """You are a children's story writer for Vietnamese kids learning English.

OUTPUT: ONE JSON object. No markdown, no prose before or after.
{ "story": { "title": str, "paragraphs_en": [str], "trivia_vi": str } }

You write ONLY the title, the paragraphs, and an optional trivia_vi (1-2 warm Vietnamese sentences, 20-200 chars — omit if nothing fits). The server splits sentences automatically — do NOT include a sentences array.

RULES (break any = story rejected)
1. PRONOUNS — boy: he/his/him. Girl: she/her/hers. Never mix.
2. ENGLISH ONLY — no untranslated Vietnamese words in title or paragraphs. The child's name is fine.
3. ONE FOCUS — one small moment, one thread. Never tour or list examples from the topic.
4. NAMES — child's name for the child only (3-6 times). ONE pet or toy name allowed IF it fits — introduce it in paragraph 1 with ownership ("her dog Mun"). Everyone else: mom, dad, grandma, teacher, a friend.
5. WORD COUNT + PARAGRAPHS — targets are in the user message. Below the floor = rejected.

CRAFT (no validator — but a parent will notice)
- Every sentence earns its place: at least one concrete detail beyond subject + verb. No bare "He ran. He jumped. He smiled." chains.
- End on a SHOWN moment (a grin, a squeeze, a sound) — never a told feeling ("felt happy," "was proud," "felt warm inside").
- ONE Vietnamese cultural detail described in English (noodle soup, motorbike, Grandma's garden, a paper lantern). One only.

VOICE — write a story a Vietnamese parent would enjoy reading aloud to their child. Match the examples below for your level. Copy the FEEL, not the content — never reuse their characters, scenes, plot, or phrases. Every story must be fully original.

""" + _STORY_EXAMPLES_PLACEHOLDER + """

Output JSON only."""


# ---------------------------------------------------------------------------
# Golden example bank — 6 per level, randomly sampled 3 per API call.
# Each level covers different arc shapes (wish/worry/discovery/helping/cosy)
# and topics so the LLM sees variety every time.
# ---------------------------------------------------------------------------

_LEVEL_VOICE_HINT = {
    "L1": "L1 voice — present tense, top-500 words, every sentence adds a concrete detail, one dialogue line, one shown feeling",
    "L2": "L2 voice — present + simple past, top-800 words, simple connectors, one small moment with a twist, dialogue welcome",
    "L3": "L3 voice — moderate sentences, compound/complex with because/so/when, a small problem the child solves, dialogue exchange",
    "L4": "L4 voice — richer sentences with subordinate clauses, mixed tenses, rhythm variety, clear arc with a turn, reflection, natural dialogue",
    "L5": "L5 voice — complex varied sentences, conditionals, dialogue, richer vocabulary, opinion/reflection, a surprise twist",
}

GOLDEN_STORY_BANK: dict[str, list[str]] = {
    # ------------------------------------------------------------------
    # L1 — 6 stories (present tense, top-500 words, ~60-100 words each)
    # Arc coverage: discovery, cosy, wish, helping, worry, surprise
    # ------------------------------------------------------------------
    "L1": [
        # 1. discovery — nature (bird in park)
        '"Mai goes to the park with Mom. The park has a big tree with pink flowers. Mai sees a red bird in the tree. \'Look, Mom!\' she says. The bird sings a little song. Mai claps her hands and the bird flies up, then comes back down. It sits on a low branch and looks at her with round eyes. Mai stands very still and waves slowly. Mom laughs and squeezes her hand. Mai has the biggest smile all the way home."',

        # 2. cosy — family (rainy day)
        '"It is raining outside and Duc sits by the window. He watches the drops slide down the glass. Drip, drip, drip. Mom brings him a warm cup of cocoa. Duc holds the cup with both hands and feels the heat on his fingers. A big puddle grows in the yard. A little frog hops right through it — splash! Duc laughs so hard that cocoa almost spills. \'Did you see that, Mom?\' he asks. Mom nods and sits down next to him. They watch the rain together until the sky turns pink."',

        # 3. surprise — animals (lazy cat)
        '"Linh has a small gray cat named Mun. Every morning, Mun sits on the warm windowsill and watches the birds outside. \'Good morning, Mun,\' Linh whispers. One day, the window is open just a crack. Mun\'s tail goes swish, swish. Is he going to jump? Linh holds her breath. But Mun just yawns, curls up, and falls right back to sleep. Linh laughs and gives him a soft pat on his belly. \'You lazy cat,\' she says."',

        # 4. wish — food/cooking (making soup)
        '"Vy wants to help Dad make soup. Dad gives her a small spoon. Vy stirs the pot round and round. The soup smells like ginger and green onion. Steam rises up and tickles her nose. \'Is it ready?\' she asks. Dad dips in a big spoon, blows on it, and takes a sip. He nods and gives Vy a thumbs up. She pours the soup into two bowls — one big, one small. They sit at the table together. Vy takes a sip from her bowl and wiggles her toes."',

        # 5. helping — school (sharing crayons)
        '"It is art time and Khanh opens his crayon box. He has twelve colours — red, blue, yellow, and more. The girl next to him looks at her desk. She has no crayons today. Khanh slides his box to the middle. \'We can share,\' he says. She picks up the green one and draws a tree. Khanh draws a sun with the yellow one. They take turns with each colour. At the end, their pictures sit side by side on the wall. Khanh looks at both and grins."',

        # 6. worry — games/toys (lost toy)
        '"An cannot find his toy car. He looks under the bed. Not there. He looks behind the sofa. Not there. His eyes get big and watery. \'Mom, my red car is gone!\' he calls. Mom helps him look in the kitchen. She opens a drawer. There it is, sitting next to the spoons! An picks it up and holds it tight. He rolls it across the table — vroom, vroom. Mom shakes her head and laughs. An puts the car in his pocket so it stays close."',
    ],

    # ------------------------------------------------------------------
    # L2 — 6 stories (present + simple past, top-800 words, ~100-150 words)
    # Arc coverage: discovery, wish, surprise, cosy, helping, worry
    # ------------------------------------------------------------------
    "L2": [
        # 1. discovery — nature (seed in garden)
        '"Nam found a tiny seed in Grandma\'s garden. It was round and brown, smaller than his fingernail. \'What will it grow into?\' he asked. Grandma smiled. \'Plant it and see.\' Nam dug a small hole near the fence and dropped the seed in. He patted the dirt on top and poured water from the old green can. Every morning before school, he ran outside to check. Nothing happened on Monday. Nothing on Tuesday. On Wednesday, a tiny green shoot poked through the dirt. Nam crouched down so close that his nose almost touched it. He grinned and ran inside. \'Grandma, come look!\'"',

        # 2. wish — sports (riding a bike)
        '"Hoa wanted to ride her bike without help. Dad held the back of the seat and jogged beside her. \'Don\'t let go!\' she said. The wheels wobbled left, then right. Hoa squeezed the handles tight. Her heart was beating fast. Dad\'s footsteps got quieter behind her. She looked back — he was standing far away, waving both hands. She was riding by herself! The wind pushed her hair back and she laughed out loud. She rode all the way to the big mango tree at the end of the lane, then turned around and rode back. Dad caught her in a big hug."',

        # 3. surprise — animals (kitten under porch)
        '"Minh heard a scratching sound under the porch. He got down on his knees and looked. Two bright eyes stared back at him. It was a small kitten, gray with white paws. \'Mom, there\'s a kitten here!\' he called. Mom brought a bowl of warm milk. Minh set it near the steps and sat very still. The kitten sniffed the air. One paw came out, then another. It walked to the bowl and lapped the milk with tiny pink tongue. Minh reached out slowly and touched its back. The kitten purred and leaned into his hand. \'I think it likes me,\' Minh whispered."',

        # 4. cosy — family (grandma's stories)
        '"Every Sunday, Tam walked to Grandma\'s house at the end of the lane. Grandma always sat on the wooden bench by the door. \'Come sit,\' she said, and patted the spot next to her. Tam climbed up and leaned against Grandma\'s arm. The air smelled like jasmine from the garden. Grandma told a story about a turtle who carried a mountain on his back. Tam closed his eyes and saw the turtle walking slowly through a green forest. When the story ended, Grandma hummed a little song. Tam didn\'t want to go home yet. He stayed until the sky turned orange and the first star came out."',

        # 5. helping — school (friend falls down)
        '"At recess, Ly saw a friend trip on a rock. He fell on his hands and his eyes got red. Ly ran over and sat down next to him. \'Does it hurt?\' she asked. He nodded but didn\'t cry. Ly pulled a tissue from her pocket and wiped the dirt off his palms. She helped him stand up. \'Let\'s walk slowly,\' she said. They walked to the bench under the big tree. Ly got him a cup of water from the fountain. He took a sip and smiled a little. By the time the bell rang, he was laughing again. They walked back to class side by side."',

        # 6. worry — vehicles (first bus ride)
        '"It was Phuc\'s first time riding the school bus alone. Mom waved from the gate. The bus was big and yellow and smelled like old seats. Phuc climbed the steps and looked for an empty spot. Everyone seemed to know each other already. He sat near the window and held his bag on his lap. The bus turned a corner and he bumped against the wall. A boy across the aisle grinned at him. \'You new?\' the boy asked. Phuc nodded. \'Sit here next time — this side bumps less.\' Phuc moved over and they talked about football all the way to school. When the bus stopped, Phuc stepped off with a grin."',
    ],

    # ------------------------------------------------------------------
    # L3 — 6 stories (compound/complex, top-1200 words, ~150-220 words)
    # Arc coverage: worry, wish, helping, discovery, cosy, surprise
    # ------------------------------------------------------------------
    "L3": [
        # 1. worry — school (stage fright)
        '"Lan\'s class was putting on a play about the ocean, and Lan wanted to be the whale. She practiced her lines every night after dinner, standing in front of the bathroom mirror. On the day of the play, she peeked through the curtain. The whole hall was full — parents, teachers, even the principal. Her stomach flipped. When her turn came, she walked to the center of the stage. The lights were bright and hot. She opened her mouth, but nothing came out. Someone in the front row coughed. Then she heard her mom whisper from the second row: \'You\'ve got this, con.\' Lan took a deep breath, spread her arms wide like fins, and said her first line. Her voice came out clear and strong. By the end, the whole room clapped. Lan bowed and grinned so wide her cheeks hurt."',

        # 2. wish — food/cooking (fried rice)
        '"Tuan always wanted to cook something by himself, so on Saturday morning he decided to make fried rice. He pulled out the big pan and set it on the stove. He cracked two eggs — one went in the bowl and the other slid onto the counter. He wiped it up quickly before Mom noticed. He chopped a small carrot into tiny orange cubes, because that was what Grandma always did. The oil popped when he poured the rice in, and he jumped back. \'Don\'t be scared of it,\' Dad said from the doorway. \'Just keep stirring.\' Tuan stirred and stirred until the rice turned golden and the kitchen smelled warm and salty. He put it on two plates and brought one to Dad. Dad took a big bite and closed his eyes. \'This is really good,\' he said. Tuan ate his plate clean."',

        # 3. helping — art/creativity (lending a ruler)
        '"Bao wanted to draw a picture of his house for art class, but every time he tried, the roof looked crooked. He erased it three times until there was a gray smudge on the paper. The girl next to him leaned over. \'Why don\'t you use a ruler for the straight parts?\' she said. Bao didn\'t have a ruler, so she lent him hers — it was yellow with little stars on it. He lined it up carefully and drew one clean line, then another. The roof finally looked right. He added the front door, the two windows, and the potted plant that Mom kept on the step. When the teacher walked by, she stopped and smiled. \'That looks just like a real house,\' she said. Bao looked at the girl and they both grinned."',

        # 4. discovery — nature (tide pool)
        '"Hang had never been to the beach before, so when Mom said they were going on Sunday, she packed her bag the night before. The sand was hotter than she expected, and the waves were louder too. She walked along the rocks at the edge of the water until she found a small pool between two big stones. Inside the pool, she could see tiny crabs crawling sideways and a purple starfish stuck to the bottom. She crouched down and dipped her finger in. The water was cool and salty. A small crab waved its claw at her. \'Mom, come see this!\' she called. Mom knelt beside her and they watched the little creatures together. When the tide started coming in, the pool got bigger and the crabs drifted away. Hang waved goodbye to them. On the bus ride home, she fell asleep with sand still between her toes."',

        # 5. cosy — Vietnamese holiday (Tet morning)
        '"On the first morning of Tet, Duy woke up to the smell of sticky rice drifting through the house. Grandma was already in the kitchen, slicing banh chung into thick green squares. Duy put on his new red shirt — the one Mom had bought for the holiday — and walked barefoot to the table. Dad handed him a small red envelope and ruffled his hair. \'Happy New Year, con.\' Duy tucked it carefully into his pocket. After breakfast, the whole family sat on the floor and played cards while the apricot branches bloomed yellow in the corner. Duy kept losing, but he didn\'t mind because Grandma kept slipping him extra rice cakes under the table. By afternoon, cousins arrived and the house got loud with laughter. Duy sat on the doorstep eating watermelon seeds, watching the sun go down over the neighbour\'s roof."',

        # 6. surprise — games/toys (marble trick)
        '"Kien had a bag of glass marbles, and he thought he knew every trick with them — until his cousin visited from the countryside. She pulled out a single marble, old and cloudy, and flicked it with her thumb. It rolled in a perfect curve around the edge of a plate and came back to her hand. Kien\'s mouth dropped open. \'How did you do that?\' he asked. She showed him the flick — a twist of the thumb, not just a push. He tried ten times and missed every one. The marble rolled under the fridge, behind the shoe rack, and once into Grandma\'s water glass. But on the eleventh try, the marble curved. Just a little. His cousin clapped. \'See? You just have to let go of the push.\' Kien practised all afternoon, and by dinner he could curve the marble around a cup. It wasn\'t a full plate yet, but he grinned the whole way through the meal."',
    ],

    # ------------------------------------------------------------------
    # L4 — 6 stories (subordinate clauses, mixed tenses, ~220-290 words)
    # Arc coverage: wish, surprise, worry, discovery, helping, cosy
    # ------------------------------------------------------------------
    "L4": [
        # 1. wish — Vietnamese holiday (fixing a kite)
        '"The morning Nhi found the broken kite in the recycling bin, she almost walked past it. But the red fabric caught her eye — it was the same shade as the kites at the Mid-Autumn Festival last year. She pulled it out and held it up. One of the bamboo ribs had snapped clean in half, and the string was tangled into a knot the size of her fist. \'I can fix this,\' she told herself, though she wasn\'t sure she believed it. She spent Sunday afternoon at the kitchen table with tape, scissors, and a thin stick from the garden. The first repair held for about two seconds before the stick popped loose. She tried again, this time wrapping the tape tighter. On her third attempt, the frame stayed firm. She tied on a new tail made from an old grocery bag. It wasn\'t pretty. The tail was plastic and the tape showed. But when she ran across the field that evening and let the string out, the kite climbed. It wobbled at first, then caught the wind and rose steadily above the rooftops. Nhi stood there, arm stretched high, feeling the pull of something she had saved from being thrown away."',

        # 2. surprise — art/creativity (bottle cap mosaic)
        '"Khang had been collecting bottle caps for three months, keeping them in a shoebox under his bed. He had fifty-seven — red ones from soda, gold ones from tea, and a few rare blue ones his uncle brought from Da Nang. He wanted to make a mosaic for the school art fair. The problem was that he had no idea what to make. He spread the caps on the living room floor and stared at them. His little sister walked through and accidentally kicked a row. \'Sorry!\' she said, but the kicked caps had landed in a curve that looked like a wave. Khang tilted his head. A wave. He could make the ocean. He spent the next two evenings gluing caps onto cardboard — blue across the top, gold for the sand, red for a tiny crab in the corner. When he carried it to school, the art teacher held it up for the class. \'This is what happens when you pay attention to accidents,\' she said. Khang liked that. The best part of his mosaic was the part he hadn\'t planned."',

        # 3. worry — school (the wrong answer)
        '"Linh had always been good at math, so when the teacher asked who wanted to solve the bonus problem on the board, her hand went up before she could think about it. She walked to the front and picked up the chalk. Twenty pairs of eyes watched her write. She worked through the steps carefully — multiply, subtract, carry the one. When she wrote her answer and turned around, the teacher tilted her head. \'Not quite,\' she said gently. Linh felt her cheeks go hot. She stared at the board and saw it immediately: she had subtracted seven instead of eight. Such a small mistake. She fixed it in three seconds, but walking back to her desk felt like it took an hour. At lunch, a friend sat next to her. \'You know, the teacher always says the person who goes to the board learns twice,\' the friend said. \'Once from the problem, once from the mistake.\' Linh poked at her rice. She knew her friend was right, but it still stung. By the next class, though, she raised her hand again. This time she checked twice before turning around."',

        # 4. discovery — nature (fireflies)
        '"The first time Dung saw fireflies, he thought someone had scattered tiny lights across Grandma\'s garden. He was visiting for the summer, and the city where he lived didn\'t have them. He stood at the edge of the yard and watched the small green flashes blink on and off between the bushes. \'They\'re talking to each other,\' Grandma said from the porch. \'Each one flashes in its own pattern.\' Dung walked slowly toward the nearest light. It blinked twice, paused, then blinked again. He cupped his hands around it without closing them all the way. For a second, a warm glow lit up his palms. Then the firefly drifted up through his fingers and floated away. He tried to catch another, but every time he got close, it blinked somewhere else. Grandma laughed. \'They\'re faster than you think.\' He gave up chasing and just sat on the grass, watching the whole garden flicker. It looked like the ground was full of tiny stars that had decided to live closer to the earth."',

        # 5. helping — family (teaching grandma)
        '"Grandma got a new phone for her birthday, and she held it like it was made of glass. \'Everything is so small,\' she said, squinting at the screen. Phong sat next to her on the sofa and showed her how to swipe. \'Like turning a page,\' he said, and Grandma\'s face lit up. They spent the whole afternoon going through the basics — how to make a call, how to send a message, how to take a photo. Grandma typed with one finger, slowly, pressing each letter like she was afraid of breaking something. She accidentally called Dad three times and sent Mom a message that just said \'hhhhhhh.\' Phong didn\'t laugh. He showed her again, patiently, the way she used to show him how to tie his shoes. By evening, Grandma could open her favourite card game and take a selfie — even if the selfie only showed her forehead. She looked at Phong and said, \'You are a good teacher.\' He didn\'t say anything back. He just leaned against her shoulder, and they played the card game together until dinner."',

        # 6. cosy — food (Sunday pho)
        '"Every Sunday morning, Yen\'s family walked to the pho shop at the end of their alley. It was a tiny place — just four plastic tables and an old woman who had been making pho since before Yen\'s parents were born. The broth had been simmering since three in the morning, and you could smell it from two streets away: star anise, cinnamon, and something warm that Yen could never name. Dad always ordered the same thing: extra noodles, no bean sprouts. Mom liked hers with lime and a mountain of herbs. Yen added hot sauce until her bowl turned orange. They didn\'t talk much while they ate — just the sound of chopsticks and slurping. But afterwards, walking home through the quiet streets, Yen always felt like the morning had been full even though nothing had happened. One Sunday, the pho lady gave Yen an extra spring roll, wrapped in newspaper. \'For the walk home,\' she said with a wink. Yen ate it slowly, one bite per block, making it last."',
    ],

    # ------------------------------------------------------------------
    # L5 — 6 stories (complex sentences, conditionals, ~290-380 words)
    # Arc coverage: worry, discovery, wish, helping, cosy, surprise
    # ------------------------------------------------------------------
    "L5": [
        # 1. worry — school (public speaking)
        '"If you had asked Quyen on Monday what she thought about public speaking, she would have said she hated it. She had avoided every presentation since fourth grade — once she even pretended to lose her voice. So when the teacher assigned a five-minute speech about \'someone who inspires you,\' Quyen\'s first instinct was to be sick on Thursday. She picked her grandmother, mostly because Grandma\'s stories were easy to remember. She wrote the speech on index cards and practiced in her room with the door closed, speaking to the row of stuffed animals on her shelf. On Thursday morning, her hands were shaking before she even reached the podium. She looked at her cards, then at the class. Twenty-six faces looked back. She started talking about how Grandma had left her village at sixteen to work in Saigon, and how she used to describe the smell of jasmine on the bus ride home — a detail Quyen had always loved. Halfway through, she realized she wasn\'t looking at the cards anymore. She was just talking. When she finished, the room was quiet for a moment before the applause started. It wasn\'t the loudest clap she\'d ever heard, but it was enough. Walking back to her seat, she thought: the thing she had been afraid of for three years had taken five minutes."',

        # 2. discovery — community (old house neighbour)
        '"Duc had always assumed the old house at the end of his street was empty. The paint was peeling, the gate was rusted shut, and nobody ever went in or came out — at least not while he was watching. Then one Saturday, he saw a light in the upstairs window. It was faint and yellow, like a candle. He told a friend, who shrugged. \'Probably just the sun reflecting.\' But the next Saturday the light was there again, and this time Duc noticed the gate was slightly open. He stood across the street for ten minutes before crossing over and pushing it wider. The yard was full of plants — not wild ones, but herbs in clay pots, arranged in neat rows. Someone was gardening here. He heard a sound and turned. An old man stood in the doorway, holding a watering can. \'You must be the boy who watches from across the street,\' the man said, not unkindly. Duc nodded, embarrassed. The man smiled and held out a small pot with a basil plant. \'Take it. Water it every morning.\' Duc carried it home carefully, and from then on he waved whenever he passed the house. The old man always waved back."',

        # 3. wish — sports (the long-distance race)
        '"Mai had signed up for the school\'s two-kilometre race mostly to prove to herself that she could finish it. She wasn\'t fast — she knew that. During practice, she was always in the back third, watching the ponytails of faster girls bounce away from her. On race day, the starting line was crowded and loud. When the whistle blew, everyone surged forward and Mai was immediately behind. She focused on her breathing the way Dad had taught her: in through the nose, out through the mouth. By the halfway mark, her legs were heavy and the sun was in her eyes. Two girls stopped to walk. Then three more. Mai didn\'t stop. She didn\'t speed up either — she just kept the same steady pace, one foot after another, listening to her own breathing like a metronome. She passed the two-kilometre marker in nineteenth place out of thirty-four. Not a medal. Not even close. But when she crossed the line, she was still running. Dad was standing behind the rope, and the look on his face told her that the place didn\'t matter. That night, she wrote in her notebook: \'I didn\'t win. But I didn\'t stop.\'"',

        # 4. helping — family (dad's birthday)
        '"The idea for Dad\'s birthday present came to Anh during math class, which was fitting because Dad was an accountant who loved numbers more than most people loved weekends. Anh wanted to make a book — not a bought one, but a handmade one — with forty-two pages, one for each year of Dad\'s life. She asked Mom for stories about the early years and wrote them in her neatest handwriting. Page one: \'Born in a hospital during a rainstorm. Grandma said the thunder stopped the moment you cried.\' Page seven: \'Broke your arm falling out of a mango tree. Grandpa carried you three kilometres to the clinic.\' She drew small pictures in the margins — a mango tree, a raindrop, a pair of glasses like the ones Dad wore now. The hardest part was the last page, page forty-two, because she wanted it to say something true without being embarrassing. She settled on: \'This year you taught me that being patient is harder than being smart, and more useful.\' On his birthday, Dad opened it at the kitchen table. He read every page without saying a word. When he reached the last one, he took off his glasses and rubbed his eyes. \'This is the best present I\'ve ever received,\' he said quietly. Anh knew he meant it because he never said things like that."',

        # 5. cosy — food (banh mi after school)
        '"There was a banh mi cart parked outside Thi\'s school every afternoon at exactly three fifteen, run by an old uncle who had been there longer than any of the teachers. His cart — dented, faded blue, held together with wire and habit — was as much a part of the school as the front gate. Thi bought a banh mi every Friday. It was her end-of-week ritual, the small reward she gave herself for surviving five days of homework, quizzes, and sitting still. The uncle always remembered her order: extra pickled carrot, no chili, double cilantro. He never wrote it down. She would sit on the low wall across the street and eat slowly, watching the younger kids stream out of the gate in their white shirts. The bread was always warm and the crust crackled when she bit into it. Sometimes a friend joined her and they would talk about nothing — a song they both liked, a rumour about a substitute teacher, whether cats were smarter than dogs. Other Fridays, Thi sat alone, and that was fine too. The banh mi tasted the same either way. One afternoon, the uncle added a small slice of cucumber she hadn\'t asked for. She looked up. He shrugged. \'Something new,\' he said. It was good."',

        # 6. surprise — imagination (the map in the library book)
        '"When Khanh opened the old library book, a folded piece of paper fell out from between the last two pages. It was thin and yellow and had been there long enough to leave a faint rectangle on the page beneath it. She unfolded it carefully. It was a map — hand-drawn in blue ink, with tiny trees, a dotted path, and an X near what looked like the school\'s back garden. There was a note in the margin in neat, childish handwriting: \'Buried 14 March. Don\'t forget.\' Khanh checked the library card in the front of the book. The last borrower was a girl from twelve years ago. She showed the map to a friend, who immediately wanted to dig. They went to the back garden after school with a small trowel from the science room. The X was near the old guava tree. They dug for ten minutes and found a small metal tin, rusted shut. Inside was a friendship bracelet made of coloured string, a folded note that said \'Best friends forever,\' and a smooth river stone with a smiley face drawn on it. Nothing valuable. But Khanh held the bracelet up to the light and wondered about the two kids who had buried a box of friendship in the school garden twelve years ago and whether they were still friends. She put everything back in the tin, added a note of her own — \'Found by Khanh, still here\' — and buried it again."',
    ],
}

import random as _random


def _get_story_examples(level: str) -> str:
    """Return 3 randomly sampled golden examples for the given level."""
    lv = (level or "L2").strip().upper()
    if lv.startswith("L") and len(lv) >= 2 and lv[1].isdigit():
        lv = f"L{lv[1]}"
    bank = GOLDEN_STORY_BANK.get(lv, GOLDEN_STORY_BANK["L2"])
    voice_hint = _LEVEL_VOICE_HINT.get(lv, _LEVEL_VOICE_HINT["L2"])
    selected = _random.sample(bank, min(3, len(bank)))
    lines = [f"EXAMPLES ({voice_hint}):"]
    for i, story in enumerate(selected, 1):
        lines.append(f"\nExample {i}:\n{story}")
    return "\n".join(lines)



def build_story_system_prompt(level: str) -> str:
    """Build the complete story-only system prompt with level-appropriate examples."""
    return STORY_ONLY_SYSTEM_PROMPT.replace(
        _STORY_EXAMPLES_PLACEHOLDER, _get_story_examples(level)
    )


ACTIVITY_FROM_STORY_SYSTEM_PROMPT = """You are Read2Lead Activity Builder for Vietnamese children learning English.

You receive a VALIDATED, FINAL story and a numbered sentence list. Build 5 activities from it.

OUTPUT: ONE JSON object only. No markdown. No prose before or after.
{ "activities": [ A, B, C, E ] }

SENTENCE COPY RULE -- for Activities A, B, E: copy sentence text character-for-character from the numbered [NN] list. Do NOT paraphrase, shorten, fix typos, or change punctuation.

ACTIVITY JSON SHAPE
- Every activity MUST include: type, title_vi, identity_vi, instructions_vi.
- Activities A/B/E use key "items". Activity C uses key "questions" -- NEVER use "items" for C.
- Activity E: scoring_mode "self_rate" on the ACTIVITY object only, NOT on items.
- Forbidden V1 fields: power_chunks, matching_activity, fill_in_the_blank, story_cloze, written_response.

ACTIVITY A -- listening_fill_blank (exactly 5 items)
- source_sentence: copy EXACTLY from [NN] list (character-for-character)
- sentence_with_blank: same sentence with ONE multi-word chunk replaced by ________
- options_en: 3 options; correct chunk is 2+ words from source_sentence
- explanation_vi: natural Vietnamese translation of the COMPLETE source_sentence -- translate the whole sentence faithfully. NOT an answer clue or vocabulary note. Example: "He wants to float Sun in Grandma's canal." -> "Cau ay muon tha chiec thuyen Sun noi tren con kenh cua ba."
- Item fields: id, source_sentence, sentence_with_blank, options_en, correct_index, explanation_vi
- Vary correct_index across 0,1,2. No duplicate sentences across the 5 items.
- title_vi "Nghe va Dien cum", identity_vi with the detective emoji

ACTIVITY B -- listen_and_order (exactly 5 items)
- original_sentence: copy EXACTLY from [NN] list -- 5 DIFFERENT sentences (none used in A)
- Token count (HARD -- validation fails below minimum): L1: 5-7 | L2-L3: 6-9 | L4-L5: 7-12. Use the (Nw) word count shown in the list to pick sentences in range.
- scrambled_tokens: whitespace-split tokens of original_sentence in scrambled order (keep trailing punctuation on the last token)
- correct_order_indices: permutation so " ".join(scrambled_tokens[i] for i in indices) reconstructs original_sentence exactly
- translation_vi: short Vietnamese gloss of the sentence
- Item fields: id, original_sentence, scrambled_tokens, correct_order_indices, translation_vi
- title_vi "Nghe va Sap xep", identity_vi with hammer emoji

ACTIVITY C -- reading_comprehension (exactly 5 questions)
- Section mix for this level is given in the user message
- 3 options_en; vary correct_index across 0,1,2
- Question fields: id, section, question_en, options_en, correct_index
- title_vi "Doc va Hieu", identity_vi with book emoji

ACTIVITY E -- listen_and_speak (ALL story sentences — one item per sentence)
- text_en: copy EXACTLY every sentence from the [NN] list, in order. Every sentence MUST appear once.
- This is a read-out-loud activity — the child listens to each sentence and repeats it aloud
- Item fields: id, text_en, text_vi, tip_vi (at most 20 words, one pronunciation or speaking hint) -- NO scoring_mode on items
- title_vi "Nghe va Noi lai", identity_vi with microphone emoji

SELECTION STRATEGY
1. A (5 items): pick sentences where blanking a multi-word chunk makes a clear meaningful gap. Mark as used.
2. B (5 items): from remaining sentences, pick 5 in the (Nw) token range for this level. Mark as used.
3. E (ALL sentences): include EVERY sentence from the [NN] list, in order. All sentences appear exactly once. No duplicates.
4. All A/B/E must be exact copies from [NN] list -- no inventing or paraphrasing.

SELF-CHECK before outputting:
1. Exactly 4 activities in order: listening_fill_blank, listen_and_order, reading_comprehension, listen_and_speak?
2. All A source_sentences, B original_sentences, E text_en are exact copies from [NN] list?
3. B token counts in range; correct_order_indices reconstruct original_sentence exactly?
4. No duplicates within A (5 unique); within B (5 unique, none in A); E contains every sentence exactly once
5. Activity C section mix matches level requirement from user message?
6. All A explanation_vi are full-sentence Vietnamese translations (not answer clues)?

Output JSON only after self-check passes."""


_ACTIVITY_C_SECTION_MIX = {
    "L1": "Find It x4 + Think About It x1",
    "L2": "Find It x4 + Think About It x1",
    "L3": "Find It x3 + Think About It x2",
    "L4": "Find It x2 + Think About It x2 + Open Question x1",
    "L5": "Find It x2 + Think About It x2 + Open Question x1",
}

_ACTIVITY_B_TOKEN_RANGE = {
    "L1": "5-7", "L2": "6-9", "L3": "6-9", "L4": "7-12", "L5": "7-12",
}


def build_story_only_user_message(
    child_name: str,
    age: int,
    level: str,
    gender: str,
    interests: str = "",
    topic: str = "",
    rank_points: int | None = None,
    level_progress_percent: int | None = None,
    previous_story: dict | None = None,
    story_errors: list[str] | None = None,
) -> str:
    """Build the Call-1 user message for story-only generation (two-call pipeline)."""
    level_req = LEVEL_REQUIREMENTS.get(level, LEVEL_REQUIREMENTS["L2"])
    gender_label = (
        "Boy (use he/his/him pronouns)" if gender == "boy"
        else "Girl (use she/her/hers pronouns)"
    )

    if topic and topic in TOPIC_LABELS:
        topic_line = (
            f"- Topic: {TOPIC_LABELS[topic]} (parent chose this — center the story here)\n"
        )
    elif topic:
        topic_line = f"- Topic hint: {topic}\n"
    else:
        topic_line = "- Topic: pick an interesting age-appropriate one yourself\n"

    interests_line = f"- Interests: {interests} (weave 1-2 naturally; do not force all)\n" if interests else ""

    ramp_stage = inlevel_ramp_stage(level_progress_percent)
    ramp_guidance = inlevel_ramp_guidance(level, ramp_stage)
    ramp_line = f"- {ramp_guidance}\n" if ramp_guidance else ""

    msg = f"""Write a story for:
- Child: {child_name}, age {age}, {gender_label}
- Level: {level} — {level_req['label']}
- Vocabulary: {level_req['vocab']}
- Difficulty: {level_req['difficulty']}
- Word count: {level_req['words']} words (target {level_req['target_words']}; below range = rejected)
- Paragraphs: {level_req['paragraphs']}
{topic_line}{interests_line}{ramp_line}
Output JSON only: {{ "story": {{ "title", "paragraphs_en", "trivia_vi" }} }}
Do NOT include a sentences array — the server splits sentences automatically."""

    if story_errors:
        errors_block = "\n".join(f"  - {e}" for e in story_errors[:8])
        msg += f"\n\nIMPORTANT: The previous story failed validation. Fix these issues:\n{errors_block}"
        if isinstance(previous_story, dict):
            paras = previous_story.get("paragraphs_en") or []
            if paras:
                prev_text = "\n\n".join(str(p) for p in paras)
                msg += f"\n\nPREVIOUS STORY (do not re-roll — fix only the issues above):\n{prev_text}"

    return msg


def build_activity_from_story_user_message(
    story: dict,
    level: str,
    child_name: str,
    topic: str = "",
    rank_points: int | None = None,
    level_progress_percent: int | None = None,
    previous_activities: list | None = None,
    activity_errors: list[str] | None = None,
) -> str:
    """Build the Call-2 user message for activity generation from a validated story."""
    import json as _json
    level_req = LEVEL_REQUIREMENTS.get(level, LEVEL_REQUIREMENTS["L2"])
    c_mix = _ACTIVITY_C_SECTION_MIX.get(level, _ACTIVITY_C_SECTION_MIX["L2"])
    b_range = _ACTIVITY_B_TOKEN_RANGE.get(level, "6-9")

    dial_band = challenge_dial_band(rank_points)
    dial_line = CHALLENGE_DIAL_GUIDANCE[dial_band]

    sentences = story.get("sentences") or []
    sentence_lines: list[str] = []
    for i, s in enumerate(sentences):
        if not isinstance(s, dict):
            continue
        text = (s.get("text_en") or "").strip()
        if not text:
            continue
        word_count = len(text.split())
        sentence_lines.append(f"[{i:02d}] ({word_count}w) {text}")
    sentence_list = "\n".join(sentence_lines)

    title = story.get("title") or ""
    paras = story.get("paragraphs_en") or []
    story_text = "\n\n".join(str(p) for p in paras)
    topic_label = TOPIC_LABELS.get(topic, topic) if topic else ""
    topic_line = f"- Topic: {topic_label}\n" if topic_label else ""

    msg = f"""Build activities for this VALIDATED story. Do not modify the story.

STUDENT
- Child: {child_name}
- Level: {level} -- {level_req['label']}
{topic_line}
ACTIVITY COUNTS
- Activity A (listening_fill_blank): exactly {level_req['activity_a_items']} items
- Activity B (listen_and_order): exactly {level_req['activity_b_items']} items -- token range {b_range} words (use Nw column in list to pick)
- Activity C (reading_comprehension): exactly {level_req['activity_c_questions']} questions -- section mix: {c_mix}
- Activity E (listen_and_speak): ALL story sentences — every sentence from the numbered list below, in order, one item per sentence
- {dial_line}

STORY TITLE: {title}

STORY TEXT (for understanding plot -- do not modify):
{story_text}

STORY SENTENCES -- copy EXACTLY for Activity A/B/E (character-for-character from this list):
{sentence_list}

Output JSON only: {{ "activities": [A, B, C, E] }}"""

    if activity_errors:
        errors_block = "\n".join(f"  - {e}" for e in activity_errors[:10])
        msg += f"\n\nIMPORTANT: Previous activities failed validation. Fix these:\n{errors_block}"
        if isinstance(previous_activities, list) and previous_activities:
            prev_json = _json.dumps(previous_activities, ensure_ascii=False, indent=2)
            msg += f"\n\nPREVIOUS ACTIVITIES (fix the errors above, do not re-roll entirely):\n{prev_json[:3000]}"

    return msg
