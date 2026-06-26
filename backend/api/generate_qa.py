"""Guided Listening Q&A generation for Read2Lead V2 packs.

Generates 2 WH- comprehension questions per sentence using LLM.
Questions start with Who/What/Where/When/Why/How and test
listening comprehension — NOT vocabulary or word-picking.
"""
from __future__ import annotations

import json
import re
from collections.abc import Callable, Sequence
from typing import Any

Question = dict[str, Any]
ParagraphQuestions = dict[str, Any]
LLMFallback = Callable[[str], str | list[Question]]


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_MIN_SENTENCE_WORDS = 3


def _split_paragraph_sentences(paragraph: str) -> list[str]:
    paragraph = str(paragraph).strip()
    if not paragraph:
        return []
    raw_parts = [p.strip() for p in _SENTENCE_SPLIT_RE.split(paragraph) if p.strip()]
    merged: list[str] = []
    for part in raw_parts:
        if merged and len(merged[-1].split()) < _MIN_SENTENCE_WORDS:
            merged[-1] = merged[-1] + " " + part
        else:
            merged.append(part)
    if len(merged) > 1 and len(merged[-1].split()) < _MIN_SENTENCE_WORDS:
        merged[-2] = merged[-2] + " " + merged[-1]
        merged.pop()
    return merged


def _clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def build_guided_listening_prompt(
    paragraph: str,
    sentences: list[str],
    story_context: list[str] | None = None,
    paragraph_index: int = 0,
) -> str:
    """Build the LLM prompt to generate WH- comprehension questions."""
    sentence_text = "\n".join(
        f"  [{i}] {s}" for i, s in enumerate(sentences)
    )

    context_block = ""
    if story_context:
        context_text = " ".join(story_context)
        context_block = f"""
FULL STORY CONTEXT (for plausible distractors):
{context_text}
"""

    return f"""Generate listening comprehension questions for the paragraph below.

PARAGRAPH:
{paragraph}
{context_block}
SENTENCES:
{sentence_text}

TASK: For EACH sentence, generate exactly 2 WH- comprehension questions.
- Questions MUST start with: Who, What, Where, When, Why, or How
- Each question has 3 answer options — the correct answer + 2 plausible distractors
- All distractors must be details from the story context, not random words
- These are listening COMPREHENSION questions — they test whether the child understood what happened
- Do NOT ask about individual words or vocabulary (no "What does X mean?" or "Which word means Y?")
- No Vietnamese translations needed

OUTPUT JSON ONLY:
{{
  "questions": [
    {{"sentence_index": 0, "question_en": "Who goes to the park?", "options_en": ["Mai", "Her dad", "Her friend"], "correct_index": 0}},
    {{"sentence_index": 0, "question_en": "Where does Mai go?", "options_en": ["To the park", "To school", "To the market"], "correct_index": 0}},
    {{"sentence_index": 1, "question_en": "What is in the park?", "options_en": ["A big tree", "A small pond", "A red slide"], "correct_index": 0}},
    {{"sentence_index": 1, "question_en": "Why is Mai excited?", "options_en": ["She sees a bird", "She has ice cream", "Mom is running"], "correct_index": 0}}
  ]
}}

RULES:
- Exactly 2 questions per sentence
- sententence_index matches the [N] number from the sentence list
- options_en: exactly 3 strings
- correct_index: 0, 1, or 2 — the index of the correct answer
- All options must be story-grounded
- No markdown, no prose — just the JSON object"""


def _parse_llm_questions(raw: list[Question] | str | dict) -> list[Question]:
    if isinstance(raw, str):
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            parsed = parsed.get("questions")
        raw = parsed
    elif isinstance(raw, dict):
        raw = raw.get("questions")
    if not isinstance(raw, list):
        raise ValueError("LLM must return a list of question objects")
    result = []
    for q in raw:
        if not isinstance(q, dict):
            continue
        # Auto-inject type if LLM omits it
        if "type" not in q:
            q["type"] = "choice"
        result.append(q)
    return result


def _valid_v3_questions(questions: Sequence[Question], sentence_count: int) -> bool:
    """Validate v3 WH- comprehension questions."""
    if not questions:
        return False

    # Check: exactly 2 questions per sentence
    counts: dict[int, int] = {}
    for q in questions:
        si = q.get("sentence_index")
        if not isinstance(si, int) or si < 0 or si >= sentence_count:
            return False
        counts[si] = counts.get(si, 0) + 1

    for i in range(sentence_count):
        if counts.get(i, 0) != 2:
            return False

    for q in questions:
        # Must be choice type
        if q.get("type") != "choice":
            return False
        # question_en required, min 3 chars
        if not isinstance(q.get("question_en"), str) or len(q["question_en"]) < 3:
            return False
        # Must start with Wh- word
        first_word = q["question_en"].split()[0].lower() if q["question_en"].split() else ""
        if first_word not in {"who", "what", "where", "when", "why", "how"}:
            return False
        # 3 options, correct_index 0-2
        options = q.get("options_en") or []
        if len(options) != 3:
            return False
        if q.get("correct_index") not in (0, 1, 2):
            return False
        # No Vietnamese
        if "question_vi" in q or "options_vi" in q:
            return False

    return True


def generate_guided_listening(
    story: dict[str, Any],
    *,
    llm_fallback: LLMFallback | None = None,
) -> list[ParagraphQuestions]:
    """Generate guided_listening entries with WH- comprehension questions.

    Calls LLM for each paragraph to generate 2 questions per sentence.
    """
    paragraphs = story.get("paragraphs_en")
    if not isinstance(paragraphs, list) or not paragraphs:
        raise ValueError("story.paragraphs_en must be a non-empty list")

    if llm_fallback is None:
        raise ValueError("llm_fallback is required for guided_listening generation")

    # Build full sentence list for context
    all_sentences: list[str] = []
    for paragraph in paragraphs:
        all_sentences.extend(_split_paragraph_sentences(_clean_text(paragraph)))

    entries: list[ParagraphQuestions] = []
    sentence_cursor = 0

    for paragraph_index, paragraph in enumerate(paragraphs):
        paragraph_text = _clean_text(paragraph)
        para_sentences = _split_paragraph_sentences(paragraph_text)

        if not para_sentences:
            continue

        # Build prompt and call LLM
        prompt = build_guided_listening_prompt(
            paragraph_text,
            para_sentences,
            story_context=all_sentences,
            paragraph_index=paragraph_index,
        )

        last_error = ""
        for _ in range(2):
            try:
                raw = llm_fallback(prompt)
                questions = _parse_llm_questions(raw)
            except Exception as exc:
                last_error = str(exc)
                continue

            if _valid_v3_questions(questions, len(para_sentences)):
                break
            last_error = "questions failed v3 validation"
        else:
            raise ValueError(
                f"guided_listening paragraph {paragraph_index} LLM failed: {last_error}"
            )

        # Assign IDs and sentence_index
        numbered: list[Question] = []
        q_counter: dict[int, int] = {}  # sentence_index → next question number
        for q in questions:
            si = q["sentence_index"]
            q_num = q_counter.get(si, 1)
            q_counter[si] = q_num + 1

            item: Question = {
                "id": f"gl_p{paragraph_index}_s{si}_q{q_num}",
                "type": "choice",
                "question_en": _clean_text(q["question_en"]),
                "options_en": [_clean_text(o) for o in q["options_en"]],
                "correct_index": q["correct_index"],
                "sentence_index": sentence_cursor + si,
            }
            numbered.append(item)

        entries.append({"paragraph_index": paragraph_index, "questions": numbered})
        sentence_cursor += len(para_sentences)

    return entries


def add_guided_listening(
    pack: dict[str, Any],
    *,
    llm_fallback: LLMFallback | None = None,
) -> dict[str, Any]:
    """Return a shallow-copied pack with guided_listening generated from story."""
    updated = dict(pack)
    updated["guided_listening"] = generate_guided_listening(
        updated.get("story") or {},
        llm_fallback=llm_fallback,
    )
    return updated
