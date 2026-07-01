"""Invariant tests for V2 prompt — guards against accidental rule deletion.

Each test asserts that a critical instruction substring exists in
SYSTEM_PROMPT_V2. If a refactor accidentally removes a rule, these
tests fail loudly.
"""
from __future__ import annotations

from prompt_v2 import (
    SYSTEM_PROMPT_V2,
    LEVEL_REQUIREMENTS,
    CHALLENGE_DIAL_GUIDANCE,
    FORBIDDEN_PATTERNS,
    NARRATIVE_RUBRIC,
    STORY_ARC_RULES,
    TOPIC_LABELS,
    build_story_polish_user_message,
    build_user_message_v2,
    challenge_dial_band,
    inlevel_ramp_guidance,
    inlevel_ramp_stage,
)


# ---------------- Critical rule substrings ----------------

def test_prompt_forbids_chunk_fields():
    assert "power_chunks" in SYSTEM_PROMPT_V2
    assert "FORBIDDEN" in SYSTEM_PROMPT_V2 or "forbidden" in SYSTEM_PROMPT_V2
    assert "matching_activity" in SYSTEM_PROMPT_V2
    assert "story_cloze" in SYSTEM_PROMPT_V2


def test_prompt_specifies_story_first():
    assert "STORY FIRST" in SYSTEM_PROMPT_V2


def test_prompt_specifies_6_levels():
    for level in ("L0", "L1", "L2", "L3", "L4", "L5"):
        assert level in SYSTEM_PROMPT_V2


def test_prompt_lists_4_activity_types():
    for activity_type in (
        "listening_fill_blank",
        "listen_and_order",
        "reading_comprehension",
        "written_response",
        "listen_and_speak",
    ):
        assert activity_type in SYSTEM_PROMPT_V2


def test_prompt_requires_sentences_verbatim():
    assert "VERBATIM" in SYSTEM_PROMPT_V2
    assert "story.sentences" in SYSTEM_PROMPT_V2


def test_prompt_pronoun_rule_present():
    assert "he/his/him" in SYSTEM_PROMPT_V2
    assert "she/her/hers" in SYSTEM_PROMPT_V2


def test_prompt_audio_url_empty_string_rule():
    assert "audio_url" in SYSTEM_PROMPT_V2
    assert "full_audio_url" in SYSTEM_PROMPT_V2


def test_prompt_no_invented_named_characters():
    assert "use the child's name" in SYSTEM_PROMPT_V2
    assert "Do NOT invent human names" in SYSTEM_PROMPT_V2
    assert "ONE pet or toy" in SYSTEM_PROMPT_V2


def test_prompt_workflow_step_order():
    assert "1) Write paragraphs_en" in SYSTEM_PROMPT_V2
    assert "length is free" in SYSTEM_PROMPT_V2
    assert "2) Split into story.sentences" in SYSTEM_PROMPT_V2
    assert "3) Build A" in SYSTEM_PROMPT_V2
    assert "4) Self-check" in SYSTEM_PROMPT_V2


def test_prompt_requires_activity_schema_keys():
    assert "instructions_vi" in SYSTEM_PROMPT_V2
    assert 'questions (NOT items)' in SYSTEM_PROMPT_V2 or 'questions (array)' in SYSTEM_PROMPT_V2
    assert "translation_vi" in SYSTEM_PROMPT_V2
    assert "scoring_mode" in SYSTEM_PROMPT_V2
    assert "NOT on items" in SYSTEM_PROMPT_V2 or "NOT on item" in SYSTEM_PROMPT_V2


def test_activity_a_explanation_is_full_sentence_translation():
    assert "translation of the COMPLETE source_sentence" in SYSTEM_PROMPT_V2
    assert "Translate the whole sentence faithfully and naturally" in SYSTEM_PROMPT_V2
    assert "It is NOT an answer explanation" in SYSTEM_PROMPT_V2
    assert "never an answer explanation" in SYSTEM_PROMPT_V2


def test_prompt_requires_wh_comprehension_guided_listening_questions():
    """v3: 2 WH- comprehension questions per sentence, all choice type, no VI."""
    assert "2 WH- comprehension questions per sentence" in SYSTEM_PROMPT_V2
    assert "NOT word-picking or fill-in-the-blank" in SYSTEM_PROMPT_V2
    assert "Who, What, Where, When, Why, or How" in SYSTEM_PROMPT_V2
    assert "NO yes_no questions" in SYSTEM_PROMPT_V2
    assert "All 3 options must come from the story context" in SYSTEM_PROMPT_V2
    assert "NO Vietnamese translations" in SYSTEM_PROMPT_V2
    assert "listening comprehension" in SYSTEM_PROMPT_V2


# ---------------- Level requirement table ----------------

def test_level_requirements_has_all_5_levels():
    assert set(LEVEL_REQUIREMENTS.keys()) == {"L0", "L1", "L2", "L3", "L4", "L5"}


def test_level_requirements_have_activity_counts():
    for level, req in LEVEL_REQUIREMENTS.items():
        for key in ("activity_a_items", "activity_b_items", "activity_c_questions", "activity_e_items"):
            assert key in req, f"{level} missing {key}"
        for key in ("activity_a_items", "activity_b_items", "activity_c_questions"):
            assert isinstance(req[key], int)
        # activity_e_items is now "all" (string) — all story sentences
        assert req["activity_e_items"] == "all"


# ---------------- User message builder ----------------

def test_build_user_message_includes_level():
    msg = build_user_message_v2("Mai", 7, "L2", "girl")
    assert "L2" in msg
    assert "Required level_label" not in msg
    assert "she/her/hers" in msg


def test_build_user_message_with_topic_label():
    msg = build_user_message_v2("Bin", 9, "L3", "boy", topic="school")
    assert "School and classroom life" in msg


def test_build_user_message_with_interests():
    msg = build_user_message_v2("Lan", 8, "L2", "girl", interests="vẽ tranh, mèo")
    assert "vẽ tranh" in msg


def test_build_user_message_audio_url_instruction():
    msg = build_user_message_v2("Mai", 7, "L1", "girl")
    assert "audio_url" in msg
    assert "Do not include" in msg


def test_prompt_has_one_focus_rule():
    assert "ONE FOCUS" in SYSTEM_PROMPT_V2
    assert "NEVER tour" in SYSTEM_PROMPT_V2


def test_prompt_has_narrative_craft():
    assert "NARRATIVE CRAFT" in SYSTEM_PROMPT_V2
    assert "show, don't tell" in SYSTEM_PROMPT_V2
    assert "READ-ALOUD TEST" in SYSTEM_PROMPT_V2
    assert (
        SYSTEM_PROMPT_V2.index("\nSTORY\n")
        < SYSTEM_PROMPT_V2.index("\nNARRATIVE CRAFT")
        < SYSTEM_PROMPT_V2.index("\nACTIVITY A")
    )


def test_prompt_requires_english_only_reading_fields():
    assert "ENGLISH-ONLY READING" in SYSTEM_PROMPT_V2
    assert "all English-facing activity fields" in SYSTEM_PROMPT_V2
    assert "Grandma's house" in SYSTEM_PROMPT_V2
    assert "a motorbike" in SYSTEM_PROMPT_V2
    assert "Lunar New Year" in SYSTEM_PROMPT_V2
    assert "Cultural authenticity comes from the scene" in SYSTEM_PROMPT_V2


def test_prompt_does_not_prime_mixed_language_story_examples():
    forbidden_examples = (
        "grandma (Bà)",
        "grandpa (Ông)",
        "Bà's house",
        "Bà's garden",
        "a xe máy",
        "the xe máy",
        "bowl of phở",
        "one Tết morning",
        "only Tết",
        "only Trung Thu",
        "Gấu",
        "Bông",
    )
    for example in forbidden_examples:
        assert example not in SYSTEM_PROMPT_V2


def test_topic_labels_are_not_checklists():
    # Cramming guard: a topic label must not enumerate 3+ comma-separated
    # examples inside parentheses (that reads as a "include all of these" list).
    import re

    for key, label in TOPIC_LABELS.items():
        m = re.search(r"\(([^)]*)\)", label)
        if not m:
            continue
        inside = m.group(1)
        # "pick ONE (e.g. a, or b)" is fine; "a, b, c, d" is a checklist.
        if "ONE" in label or "e.g." in inside:
            continue
        assert inside.count(",") < 2, f"{key} label looks like a checklist: {label}"


def test_cramming_prone_topic_labels_require_one_focus():
    assert TOPIC_LABELS["school"] == "School and classroom life"
    for key in ("sports", "games_toys", "vehicles", "heroes_jobs", "vietnamese_holidays"):
        assert "pick ONE" in TOPIC_LABELS[key], f"{key} must explicitly narrow the topic"


def test_user_message_carries_one_focus():
    msg = build_user_message_v2("Bin", 9, "L3", "boy", topic="vehicles")
    assert "ONE FOCUS" in msg
    assert "choose a single concrete subject" in msg
    assert "Do not tour or list multiple examples." in msg


def test_vietnamese_holiday_topic_uses_english_names():
    msg = build_user_message_v2(
        "Bin", 9, "L3", "boy", topic="vietnamese_holidays",
    )
    assert "Lunar New Year" in msg
    assert "Mid-Autumn Festival" in msg
    assert "Tết" not in msg
    assert "Trung Thu" not in msg


def test_prompt_has_style_example_and_priority():
    assert "STYLE EXAMPLE" in SYSTEM_PROMPT_V2
    assert "NEVER reuse this content" in SYSTEM_PROMPT_V2
    assert "PRIORITY:" in SYSTEM_PROMPT_V2


def test_prompt_has_arc_variety_and_read_aloud():
    assert "ARC VARIETY" in SYSTEM_PROMPT_V2
    assert "READ-ALOUD TEST" in SYSTEM_PROMPT_V2


def test_prompt_craft_is_level_scaled():
    assert "CRAFT BY LEVEL" in SYSTEM_PROMPT_V2
    for lvl in ("L1-L2", "L3", "L4-L5"):
        assert lvl in SYSTEM_PROMPT_V2


def test_prompt_difficulty_not_length():
    assert "DIFFICULTY = VOCABULARY" in SYSTEM_PROMPT_V2
    assert "Length: FREE" in build_user_message_v2("Mai", 7, "L3", "girl", topic="school")


def test_challenge_dial_band_thresholds():
    assert challenge_dial_band(None) == "C2"
    assert challenge_dial_band(0) == "C1"
    assert challenge_dial_band(17) == "C1"
    assert challenge_dial_band(18) == "C2"
    assert challenge_dial_band(41) == "C2"
    assert challenge_dial_band(42) == "C3"
    assert challenge_dial_band(71) == "C3"
    assert challenge_dial_band(72) == "C4"
    assert challenge_dial_band(200) == "C4"


def test_build_user_message_includes_dial_per_band():
    for band, guidance in CHALLENGE_DIAL_GUIDANCE.items():
        assert band in guidance
    c1 = build_user_message_v2("Mai", 7, "L2", "girl", rank_points=5)
    assert "CHALLENGE DIAL C1" in c1
    c4 = build_user_message_v2("Mai", 7, "L2", "girl", rank_points=72)
    assert "CHALLENGE DIAL C4" in c4
    default = build_user_message_v2("Mai", 7, "L2", "girl")
    assert "CHALLENGE DIAL C2" in default


# ---------------- V2.5 story 2-pass polish rubric ----------------

def test_narrative_rubric_constant_exists():
    assert isinstance(NARRATIVE_RUBRIC, str)
    assert NARRATIVE_RUBRIC.strip()
    assert "NARRATIVE ARC" in NARRATIVE_RUBRIC
    assert "Do NOT change activity content" in NARRATIVE_RUBRIC
    # Verbatim sentence contract must survive the rewrite.
    assert "VERBATIM" in NARRATIVE_RUBRIC
    assert "paragraphs_en" in NARRATIVE_RUBRIC


def test_story_arc_rules_cover_all_levels():
    assert set(STORY_ARC_RULES.keys()) == {"L0", "L1", "L2", "L3", "L4", "L5"}
    for level, rule in STORY_ARC_RULES.items():
        assert isinstance(rule, str) and rule.strip(), f"{level} arc rule empty"
    # L1 is the level the "nhảm nhí" bug was observed on — guard its shape.
    assert "desire" in STORY_ARC_RULES["L1"]
    assert "obstacle" in STORY_ARC_RULES["L1"]
    assert "sensory" in STORY_ARC_RULES["L1"]


def test_forbidden_patterns_list_non_empty():
    assert isinstance(FORBIDDEN_PATTERNS, list)
    assert len(FORBIDDEN_PATTERNS) >= 4
    joined = " ".join(FORBIDDEN_PATTERNS)
    assert "Flat action lists" in joined
    assert "and then" in joined


def test_build_polish_user_message_contains_arc_rules_for_level():
    draft = {
        "story": {
            "title": "Bin and the Box",
            "paragraphs_en": [
                "Bin finds a small box.",
                "He opens the door.",
            ],
            "trivia_vi": "Mot su that nho.",
        }
    }
    for level in ("L0", "L1", "L2", "L3", "L4", "L5"):
        msg = build_story_polish_user_message(draft, level, "Bin", topic="games_toys")
        assert STORY_ARC_RULES[level] in msg, f"{level} arc rule missing from polish msg"
        # Draft story + forbidden patterns + child name carried through.
        assert "Bin finds a small box." in msg
        assert FORBIDDEN_PATTERNS[0] in msg
        assert "Bin" in msg
        # Activities must NOT leak into the story-only polish message.
        assert "listening_fill_blank" not in msg


def test_inlevel_ramp_stage_thresholds():
    assert inlevel_ramp_stage(None) == "mid"
    assert inlevel_ramp_stage(0) == "early"
    assert inlevel_ramp_stage(33) == "early"
    assert inlevel_ramp_stage(34) == "mid"
    assert inlevel_ramp_stage(50) == "mid"
    assert inlevel_ramp_stage(66) == "mid"
    assert inlevel_ramp_stage(67) == "late"
    assert inlevel_ramp_stage(100) == "late"


def test_build_user_message_includes_inlevel_ramp_guidance():
    early = build_user_message_v2(
        "Mai", 7, "L2", "girl", level_progress_percent=10,
    )
    assert "RAMP early-L2" in early
    assert "easiest half" in early

    mid = build_user_message_v2(
        "Mai", 7, "L2", "girl", level_progress_percent=50,
    )
    assert "RAMP early-" not in mid
    assert "RAMP late-" not in mid

    late = build_user_message_v2(
        "Mai", 7, "L2", "girl", level_progress_percent=80,
    )
    assert "RAMP late-L2" in late
    assert "stretch gently toward the next level" in late

    late_l5 = inlevel_ramp_guidance("L5", "late")
    assert late_l5 is not None
    assert "RAMP late-L5" in late_l5
    assert "next level" not in late_l5
