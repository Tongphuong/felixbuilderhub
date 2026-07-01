"""V2 Read2Lead pack validator.

Replaces V1's chunk-based regex validation. V2 validator is purely
structural: checks JSON shape against schema and a small set of
cross-field invariants (sentences come from story, scrambled tokens
reconstruct sentence, MCQ shape).

Audio URL fields are NOT validated (they're empty at LLM-output time;
the server fills them later via the audio pipeline).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

try:
    from jsonschema import Draft7Validator
except ImportError:  # pragma: no cover - jsonschema is a hard runtime dep
    Draft7Validator = None  # type: ignore[assignment]


LEVEL_RULES_V2 = {
    # Ranges widened ~25% vs original spec - Sonnet routinely lands 5-15%
    # outside the strict bound, which is pedagogically fine for the kid
    # but wasted retry $ when validator rejected. Prompt still targets
    # mid-range (see prompt_v2.LEVEL_REQUIREMENTS); validator only catches
    # genuinely off-level output (e.g. L2 story of 350 words).
    # ┌──────────────────────────────────────────────────────────────────┐
    # │ VALIDATOR FLOOR — do not lower min_* values further.            │
    # │ If LLM output fails these bounds, fix prompt_v2.py or add      │
    # │ retry context — do not widen the validator.                     │
    # │ Last audit: 2026-06-09 (Claude).                               │
    # └──────────────────────────────────────────────────────────────────┘
    "L0": {
        "label": "L0 Emergent / Pre-A1",
        "min_words": 15,
        "min_paragraphs": 2,
        "max_paragraphs": 4,
        "min_sentences": 3,
        "max_sentences": 12,
        "activity_a_items": 3,
        "activity_b_items": 3,
        "activity_c_questions": 3,
        "activity_c_section_mix": ["Find It", "Find It", "Think About It"],
        "activity_e_items": "all",
    },
    "L1": {
        "label": "L1 Beginner / A1",
        "min_words": 50,    # was 60
        "min_paragraphs": 3,
        "max_paragraphs": 5,   # was 4 - Sonnet sometimes uses 5
        "min_sentences": 6,    # was 8
        # max_sentences = token/TTS cost guard only (not a difficulty lever); difficulty = vocab + complexity in the prompt.
        "max_sentences": 22,   # was 17 (was 14)
        "activity_a_items": 5,
        "activity_b_items": 5,
        "activity_c_questions": 5,
        "activity_c_section_mix": ["Find It", "Find It", "Find It", "Find It", "Think About It"],
        "activity_e_items": "all",
    },
    "L2": {
        "label": "L2 Early Reader / A1+",
        "min_words": 85,    # was 100
        "min_paragraphs": 3,
        "max_paragraphs": 5,
        "min_sentences": 9,     # was 12
        # max_sentences = token/TTS cost guard only (not a difficulty lever); difficulty = vocab + complexity in the prompt.
        "max_sentences": 27,    # was 21 (was 18)
        "activity_a_items": 5,
        "activity_b_items": 5,
        "activity_c_questions": 5,
        "activity_c_section_mix": ["Find It", "Find It", "Find It", "Find It", "Think About It"],
        "activity_e_items": "all",
    },
    "L3": {
        "label": "L3 Growing Reader / A2",
        "min_words": 130,   # was 150
        "min_paragraphs": 3,    # was 4
        "max_paragraphs": 6,    # was 5
        "min_sentences": 11,    # was 14
        # max_sentences = token/TTS cost guard only (not a difficulty lever); difficulty = vocab + complexity in the prompt.
        "max_sentences": 32,    # was 25 (was 22)
        "activity_a_items": 5,
        "activity_b_items": 5,
        "activity_c_questions": 5,
        "activity_c_section_mix": ["Find It", "Find It", "Find It", "Think About It", "Think About It"],
        "activity_e_items": "all",
    },
    "L4": {
        "label": "L4 Confident Reader / A2+",
        "min_words": 190,   # was 220
        "min_paragraphs": 4,
        "max_paragraphs": 6,
        "min_sentences": 15,    # was 18
        # max_sentences = token/TTS cost guard only (not a difficulty lever); difficulty = vocab + complexity in the prompt.
        "max_sentences": 38,    # was 29 (was 26)
        "activity_a_items": 5,
        "activity_b_items": 5,
        "activity_c_questions": 5,
        "activity_c_section_mix": ["Find It", "Find It", "Think About It", "Think About It", "Open Question"],
        "activity_e_items": "all",
    },
    "L5": {
        "label": "L5 Independent Reader / B1",
        "min_words": 250,   # was 290
        "min_paragraphs": 4,    # was 5
        "max_paragraphs": 7,    # was 6
        "min_sentences": 17,    # was 20
        # max_sentences = token/TTS cost guard only (not a difficulty lever); difficulty = vocab + complexity in the prompt.
        "max_sentences": 44,    # was 33 (was 30)
        "activity_a_items": 5,
        "activity_b_items": 5,
        "activity_c_questions": 5,
        "activity_c_section_mix": ["Find It", "Find It", "Think About It", "Think About It", "Open Question"],
        "activity_e_items": "all",
    },
}


_SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "pack.schema.v2.json"


def _load_schema() -> dict | None:
    """Lazily load and cache the V2 schema JSON."""
    if not _SCHEMA_PATH.exists():
        return None
    with open(_SCHEMA_PATH, encoding="utf-8") as f:
        return json.load(f)


_PACK_SCHEMA_V2: dict | None = None


def _schema() -> dict | None:
    global _PACK_SCHEMA_V2
    if _PACK_SCHEMA_V2 is None:
        _PACK_SCHEMA_V2 = _load_schema()
    return _PACK_SCHEMA_V2


def _count_english_words(paragraphs: list[str]) -> int:
    joined = " ".join(str(p) for p in paragraphs)
    return len(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", joined))


def _normalize_for_match(text: str) -> str:
    """Lowercase, collapse whitespace. Used for substring tolerance only."""
    return re.sub(r"\s+", " ", text.lower()).strip()


def _normalize_for_reconstruction(text: str) -> str:
    """Strip trailing punctuation + collapse whitespace for token-reconstruction
    comparison. LLM frequently drops the trailing period when scrambling tokens
    even when instructed to preserve it - that's cosmetic, not pedagogically
    meaningful, so we normalize both sides before comparing."""
    text = (text or "").strip()
    # Strip ONE trailing punctuation char if present (don't strip mid-sentence punct)
    if text and text[-1] in ".!?,;:":
        text = text[:-1].rstrip()
    return re.sub(r"\s+", " ", text)


def _sentence_in_paragraph(sentence: str, paragraph: str) -> bool:
    """Check if `sentence` appears verbatim (case-insensitive, whitespace-normalized) in `paragraph`."""
    return _normalize_for_match(sentence) in _normalize_for_match(paragraph)


def _validate_schema(data: dict, errors: list[str]) -> None:
    schema = _schema()
    if schema is None or Draft7Validator is None:
        errors.append("[validator_v2] WARNING: schema file or jsonschema lib unavailable; skipping schema check")
        return
    schema_errors = sorted(
        Draft7Validator(schema).iter_errors(data),
        key=lambda e: list(e.path),
    )
    for err in schema_errors[:25]:
        location = "/".join(str(p) for p in err.path) or "(root)"
        errors.append(f"schema: {location}: {err.message}")


def _validate_story(data: dict, level_rule: dict, errors: list[str]) -> None:
    story = data.get("story") or {}
    paragraphs_en = story.get("paragraphs_en") or []
    sentences = story.get("sentences") or []

    if not isinstance(paragraphs_en, list) or not paragraphs_en:
        errors.append("story.paragraphs_en missing or empty")
        return

    if not (level_rule["min_paragraphs"] <= len(paragraphs_en) <= level_rule["max_paragraphs"]):
        errors.append(
            f"story.paragraphs_en count {len(paragraphs_en)} not in "
            f"[{level_rule['min_paragraphs']}, {level_rule['max_paragraphs']}]"
        )

    word_count = _count_english_words(paragraphs_en)
    if word_count < level_rule["min_words"]:
        errors.append(
            f"story word count {word_count} below minimum {level_rule['min_words']}"
        )

    if not (level_rule["min_sentences"] <= len(sentences) <= level_rule["max_sentences"]):
        errors.append(
            f"story.sentences count {len(sentences)} not in "
            f"[{level_rule['min_sentences']}, {level_rule['max_sentences']}]"
        )

    for idx, sentence_obj in enumerate(sentences):
        if not isinstance(sentence_obj, dict):
            errors.append(f"story.sentences[{idx}] not an object")
            continue
        text_en = sentence_obj.get("text_en", "")
        paragraph_index = sentence_obj.get("paragraph_index")
        if not isinstance(text_en, str) or not text_en:
            errors.append(f"story.sentences[{idx}].text_en empty")
            continue
        if not isinstance(paragraph_index, int):
            errors.append(f"story.sentences[{idx}].paragraph_index not int")
            continue
        if paragraph_index < 0 or paragraph_index >= len(paragraphs_en):
            errors.append(
                f"story.sentences[{idx}].paragraph_index {paragraph_index} "
                f"out of range [0, {len(paragraphs_en) - 1}]"
            )
            continue
        if not _sentence_in_paragraph(text_en, paragraphs_en[paragraph_index]):
            errors.append(
                f"story.sentences[{idx}] text_en not found verbatim in "
                f"paragraphs_en[{paragraph_index}]"
            )

    trivia_vi = story.get("trivia_vi")
    if trivia_vi is not None:
        if not isinstance(trivia_vi, str):
            errors.append("story.trivia_vi must be a string when present")
        else:
            length = len(trivia_vi.strip())
            if length < 20 or length > 200:
                errors.append(
                    f"story.trivia_vi length {length} not in [20, 200]"
                )


def _sentence_set_normalized(sentences: list[dict]) -> set[str]:
    return {
        _normalize_for_match(s.get("text_en", ""))
        for s in sentences
        if isinstance(s, dict) and s.get("text_en")
    }


def _story_text_normalized(data: dict) -> str:
    return _normalize_for_match(" ".join((data.get("story") or {}).get("paragraphs_en") or []))


def _sentence_known_in_story(sentence: str, sentence_set: set[str], story_text: str) -> bool:
    normalized = _normalize_for_match(sentence)
    return normalized in sentence_set or normalized in story_text


def _validate_activity_a(
    activity: dict,
    level_rule: dict,
    sentence_set: set[str],
    story_text: str,
    errors: list[str],
) -> None:
    expected = level_rule["activity_a_items"]
    items = activity.get("items") or []
    if len(items) != expected:
        errors.append(
            f"activity[A] items count {len(items)} != expected {expected} for level"
        )
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"activity[A].items[{idx}] not an object")
            continue
        source = item.get("source_sentence", "")
        sentence_with_blank = item.get("sentence_with_blank", "")
        options_en = item.get("options_en") or []
        correct_index = item.get("correct_index")
        if not isinstance(source, str) or not source:
            errors.append(f"activity[A].items[{idx}].source_sentence empty")
        elif not _sentence_known_in_story(source, sentence_set, story_text):
            errors.append(
                f"activity[A].items[{idx}].source_sentence not found verbatim in story text"
            )
        if not isinstance(sentence_with_blank, str) or sentence_with_blank.count("________") != 1:
            errors.append(f"activity[A].items[{idx}].sentence_with_blank must contain exactly one ________ blank")
        if len(options_en) != 3:
            errors.append(f"activity[A].items[{idx}] options_en must have exactly 3 entries")
        if not isinstance(correct_index, int) or correct_index not in (0, 1, 2):
            errors.append(
                f"activity[A].items[{idx}].correct_index must be int in {{0,1,2}}, got {correct_index!r}"
            )
            continue
        answer = options_en[correct_index] if correct_index < len(options_en) else ""
        if isinstance(answer, str):
            if _normalize_for_match(answer) not in _normalize_for_match(source):
                errors.append(f"activity[A].items[{idx}] correct chunk not found in source_sentence")


def _validate_activity_b(
    activity: dict,
    level_rule: dict,
    sentence_set: set[str],
    story_text: str,
    errors: list[str],
) -> None:
    expected = level_rule["activity_b_items"]
    items = activity.get("items") or []
    if len(items) != expected:
        errors.append(
            f"activity[B] items count {len(items)} != expected {expected} for level"
        )
    seen_sentences: set[str] = set()
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"activity[B].items[{idx}] not an object")
            continue
        original = item.get("original_sentence", "")
        tokens = item.get("scrambled_tokens") or []
        indices = item.get("correct_order_indices") or []

        if not isinstance(original, str) or not original:
            errors.append(f"activity[B].items[{idx}].original_sentence empty")
            continue
        normalized_orig = _normalize_for_match(original)
        if not _sentence_known_in_story(original, sentence_set, story_text):
            errors.append(
                f"activity[B].items[{idx}].original_sentence not found verbatim in story text"
            )
        if normalized_orig in seen_sentences:
            errors.append(
                f"activity[B].items[{idx}].original_sentence duplicates an earlier item — pick a different sentence"
            )
        seen_sentences.add(normalized_orig)

        if not isinstance(tokens, list) or not isinstance(indices, list):
            errors.append(f"activity[B].items[{idx}] tokens or indices not lists")
            continue
        if len(tokens) != len(indices):
            errors.append(
                f"activity[B].items[{idx}] scrambled_tokens length {len(tokens)} "
                f"!= correct_order_indices length {len(indices)}"
            )
            continue
        n = len(tokens)
        if n > 16:
            errors.append(
                f"activity[B].items[{idx}] has {n} scrambled tokens; max 16 for listen_and_order"
            )
        if sorted(indices) != list(range(n)):
            errors.append(
                f"activity[B].items[{idx}].correct_order_indices must be a permutation of [0..{n - 1}], "
                f"got {indices}"
            )
            continue
        reconstructed = " ".join(tokens[i] for i in indices)
        normalized_reconstructed = _normalize_for_reconstruction(reconstructed)
        normalized_original = _normalize_for_reconstruction(original)
        if normalized_reconstructed != normalized_original:
            errors.append(
                f"activity[B].items[{idx}] reconstructed '{reconstructed}' != original_sentence '{original}' (after normalizing trailing punctuation)"
            )


def _validate_activity_c(activity: dict, level_rule: dict, errors: list[str]) -> None:
    expected = level_rule["activity_c_questions"]
    questions = activity.get("questions") or []
    if len(questions) != expected:
        errors.append(
            f"activity[C] questions count {len(questions)} != expected {expected} for level"
        )
    expected_mix = level_rule["activity_c_section_mix"]
    actual_mix = [q.get("section") for q in questions if isinstance(q, dict)]
    if actual_mix != expected_mix:
        errors.append(
            f"activity[C] section mix mismatch: expected {expected_mix}, got {actual_mix}"
        )
    for idx, q in enumerate(questions):
        if not isinstance(q, dict):
            errors.append(f"activity[C].questions[{idx}] not an object")
            continue
        options_en = q.get("options_en") or []
        correct_index = q.get("correct_index")
        if len(options_en) != 3:
            errors.append(
                f"activity[C].questions[{idx}] options_en must have exactly 3 entries"
            )
        if not isinstance(correct_index, int) or correct_index not in (0, 1, 2):
            errors.append(
                f"activity[C].questions[{idx}].correct_index must be int in {{0,1,2}}"
            )


def _validate_activity_d(activity: dict, level_rule: dict, errors: list[str]) -> None:
    expected = level_rule["activity_d_questions"]
    questions = activity.get("questions") or []
    if len(questions) != expected:
        errors.append(
            f"activity[D] questions count {len(questions)} != expected {expected} for level"
        )
    for idx, q in enumerate(questions):
        if not isinstance(q, dict):
            errors.append(f"activity[D].questions[{idx}] not an object")
            continue
        for field in ("question_en", "question_vi"):
            if not isinstance(q.get(field), str) or not q.get(field).strip():
                errors.append(f"activity[D].questions[{idx}].{field} empty")


def _validate_activity_e(
    activity: dict,
    level_rule: dict,
    sentence_set: set[str],
    story_text: str,
    errors: list[str],
    story_sentence_count: int = 0,
) -> None:
    expected = level_rule["activity_e_items"]
    items = activity.get("items") or []
    if expected == "all":
        if story_sentence_count > 0 and len(items) != story_sentence_count:
            errors.append(
                f"activity[E] items count {len(items)} != story sentence count {story_sentence_count}"
            )
    elif len(items) != expected:
        errors.append(
            f"activity[E] items count {len(items)} != expected {expected} for level"
        )
    if activity.get("scoring_mode") != "self_rate":
        errors.append(
            f"activity[E].scoring_mode must be 'self_rate' in V2, got {activity.get('scoring_mode')!r}"
        )
    seen_sentences: set[str] = set()
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append(f"activity[E].items[{idx}] not an object")
            continue
        text_en = item.get("text_en", "")
        if not isinstance(text_en, str) or not text_en:
            errors.append(f"activity[E].items[{idx}].text_en empty")
            continue
        normalized = _normalize_for_match(text_en)
        if not _sentence_known_in_story(text_en, sentence_set, story_text):
            errors.append(
                f"activity[E].items[{idx}].text_en not found verbatim in story text"
            )
        if normalized in seen_sentences:
            errors.append(
                f"activity[E].items[{idx}].text_en duplicates an earlier item"
            )
        seen_sentences.add(normalized)


def _validate_activities(data: dict, level_rule: dict, errors: list[str]) -> None:
    activities = data.get("activities") or []

    expected_types = [
        "listening_fill_blank",
        "listen_and_order",
        "reading_comprehension",
        "listen_and_speak",
    ]
    actual_types = [a.get("type") for a in activities if isinstance(a, dict)]
    if actual_types != expected_types:
        errors.append(
            f"activities types must be {expected_types}, got {actual_types}"
        )
        return

    sentence_set = _sentence_set_normalized(
        (data.get("story") or {}).get("sentences", [])
    )
    story_text = _story_text_normalized(data)

    _validate_activity_a(activities[0], level_rule, sentence_set, story_text, errors)
    _validate_activity_b(activities[1], level_rule, sentence_set, story_text, errors)
    _validate_activity_c(activities[2], level_rule, errors)
    story_sentences = (data.get("story") or {}).get("sentences") or []
    _validate_activity_e(activities[3], level_rule, sentence_set, story_text, errors, len(story_sentences))



def validate_guided_listening(pack: dict) -> tuple[bool, list[str]]:
    """Validate v3 Guided Listening: 2 WH- comprehension questions per sentence."""
    errors: list[str] = []
    if not isinstance(pack, dict):
        return False, ["pack is not a JSON object"]

    story = pack.get("story") or {}
    paragraphs = story.get("paragraphs_en") or []
    story_sentences = story.get("sentences") or []
    guided = pack.get("guided_listening")

    if guided is None:
        return True, []
    if not isinstance(paragraphs, list) or not paragraphs:
        return False, ["guided_listening requires story.paragraphs_en"]
    if not isinstance(guided, list):
        return False, ["guided_listening must be an array"]
    if len(guided) != len(paragraphs):
        errors.append(
            f"guided_listening paragraph count {len(guided)} != story.paragraphs_en count {len(paragraphs)}"
        )

    # Count sentences per paragraph for coverage checks
    para_sentence_counts: dict[int, int] = {}
    for s in story_sentences:
        if isinstance(s, dict):
            pi = s.get("paragraph_index", 0)
            para_sentence_counts[pi] = para_sentence_counts.get(pi, 0) + 1

    expected_id_re = re.compile(r"^gl_p([0-9]+)_s([0-9]+)_q([12])$")

    for paragraph_index, entry in enumerate(guided):
        if not isinstance(entry, dict):
            errors.append(f"guided_listening[{paragraph_index}] not an object")
            continue
        if entry.get("paragraph_index") != paragraph_index:
            errors.append(
                f"guided_listening[{paragraph_index}].paragraph_index must be {paragraph_index}"
            )

        questions = entry.get("questions")
        if not isinstance(questions, list):
            errors.append(f"guided_listening[{paragraph_index}].questions must be an array")
            continue

        expected_count = para_sentence_counts.get(paragraph_index, 0) * 2
        if expected_count > 0 and len(questions) != expected_count:
            errors.append(
                f"guided_listening[{paragraph_index}].questions count {len(questions)} "
                f"!= {expected_count} (2 per sentence)"
            )

        # Track questions per sentence
        q_per_sentence: dict[int, int] = {}

        for q_index, question in enumerate(questions):
            if not isinstance(question, dict):
                errors.append(f"guided_listening[{paragraph_index}].questions[{q_index}] not an object")
                continue

            # ID format: gl_p{X}_s{Y}_q{1|2}
            qid = question.get("id")
            match = expected_id_re.match(qid or "") if isinstance(qid, str) else None
            if not match:
                errors.append(
                    f"guided_listening[{paragraph_index}].questions[{q_index}].id invalid "
                    f"(expected gl_p{paragraph_index}_s<N>_q<1|2>)"
                )

            # Only choice type allowed
            qtype = question.get("type")
            if qtype != "choice":
                errors.append(
                    f"guided_listening[{paragraph_index}].questions[{q_index}].type "
                    f"must be 'choice', got {qtype!r}"
                )

            # No Vietnamese
            for vi_field in ("question_vi", "options_vi"):
                if vi_field in question:
                    errors.append(
                        f"guided_listening[{paragraph_index}].questions[{q_index}] "
                        f"must not contain {vi_field}"
                    )

            # question_en required
            question_en = question.get("question_en")
            if not isinstance(question_en, str) or len(question_en.strip()) < 3:
                errors.append(
                    f"guided_listening[{paragraph_index}].questions[{q_index}].question_en empty or too short"
                )

            # sentence_index required
            sentence_index = question.get("sentence_index")
            if not isinstance(sentence_index, int) or isinstance(sentence_index, bool):
                errors.append(
                    f"guided_listening[{paragraph_index}].questions[{q_index}].sentence_index must be int"
                )
            elif sentence_index < 0 or sentence_index >= len(story_sentences):
                errors.append(
                    f"guided_listening[{paragraph_index}].questions[{q_index}].sentence_index "
                    f"{sentence_index} out of range [0, {len(story_sentences) - 1}]"
                )
            else:
                q_per_sentence[sentence_index] = q_per_sentence.get(sentence_index, 0) + 1
                # Verify sentence_index belongs to this paragraph
                story_sentence = story_sentences[sentence_index]
                if (
                    isinstance(story_sentence, dict)
                    and story_sentence.get("paragraph_index") != paragraph_index
                ):
                    errors.append(
                        f"guided_listening[{paragraph_index}].questions[{q_index}].sentence_index "
                        f"{sentence_index} belongs to paragraph {story_sentence.get('paragraph_index')}, "
                        f"not {paragraph_index}"
                    )

            # Options: 3 options, correct_index 0-2
            options_en = question.get("options_en")
            if not isinstance(options_en, list) or len(options_en) != 3:
                errors.append(
                    f"guided_listening[{paragraph_index}].questions[{q_index}].options_en "
                    f"must have exactly 3 entries"
                )
            else:
                for opt_index, option in enumerate(options_en):
                    if not isinstance(option, str) or not option.strip():
                        errors.append(
                            f"guided_listening[{paragraph_index}].questions[{q_index}].options_en[{opt_index}] empty"
                        )

            correct_index = question.get("correct_index")
            if not isinstance(correct_index, int) or correct_index not in (0, 1, 2):
                errors.append(
                    f"guided_listening[{paragraph_index}].questions[{q_index}].correct_index "
                    f"must be 0, 1, or 2"
                )

        # Check: exactly 2 questions per sentence
        for si, count in q_per_sentence.items():
            if count != 2:
                errors.append(
                    f"guided_listening[{paragraph_index}] sentence_index {si} has {count} questions, expected 2"
                )

    return len(errors) == 0, errors

def validate_story_only(story_obj: dict, expected_level: str) -> tuple[bool, list[str]]:
    """Validate a story-only LLM response (two-call pipeline, between Call 1 and Call 2).

    Checks paragraph count, word count, sentence count, and per-sentence
    verbatim match. Does NOT require activities to be present.
    """
    if not isinstance(story_obj, dict):
        return False, ["story is not a JSON object"]
    level_code = (expected_level or "").strip().upper()
    level_rule = LEVEL_RULES_V2.get(level_code)
    if level_rule is None:
        return False, [f"unsupported expected_level {expected_level!r}"]
    errors: list[str] = []
    _validate_story({"story": story_obj}, level_rule, errors)
    return len(errors) == 0, errors


def validate_pack_v2(data: dict, expected_level: str | None = None) -> tuple[bool, list[str]]:
    """Validate a V2 pack against schema + cross-field invariants.

    Args:
        data: pack dict (LLM output, possibly post-fill from server)
        expected_level: one of L1-L5, or None to skip level-specific checks

    Returns:
        (is_valid, errors) — is_valid=True iff errors is empty.
    """
    errors: list[str] = []

    if not isinstance(data, dict):
        return False, ["pack is not a JSON object"]

    _validate_schema(data, errors)

    if expected_level is None:
        return len(errors) == 0, errors

    level_code = expected_level.strip().upper()
    level_rule = LEVEL_RULES_V2.get(level_code)
    if level_rule is None:
        errors.append(f"unsupported expected_level {expected_level!r}")
        return False, errors

    if data.get("level") not in (None, level_code):
        errors.append(
            f"data.level {data.get('level')!r} != expected_level {level_code!r}"
        )

    _validate_story(data, level_rule, errors)
    _validate_activities(data, level_rule, errors)
    _, guided_errors = validate_guided_listening(data)
    errors.extend(guided_errors)

    return len(errors) == 0, errors
