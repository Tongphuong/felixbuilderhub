"""Guided Listening Q&A generation for Read2Lead V2 packs.

Generates 2 WH- comprehension questions per sentence using LLM.
Questions start with Who/What/Where/When/Why/How and test
listening comprehension — NOT vocabulary or word-picking.
"""
from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

Question = dict[str, Any]
ParagraphQuestions = dict[str, Any]
LLMFallback = Callable[[str], str | list[Question]]
CountAwareLLMFallback = Callable[[str, int], str | list[Question]]
ParagraphCompleteCallback = Callable[[ParagraphQuestions], None]


_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_MIN_SENTENCE_WORDS = 3
_MAX_GUIDED_ATTEMPTS = 3
_WH_STARTERS = frozenset(
    {"who", "whose", "what", "which", "where", "when", "why", "how"}
)


def _is_insufficient_quota_error(exc: BaseException) -> bool:
    """Return True only for OpenAI's non-transient billing quota error."""
    current: BaseException | None = exc
    seen: set[int] = set()
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if getattr(current, "code", None) == "insufficient_quota":
            return True
        body = getattr(current, "body", None)
        if isinstance(body, dict):
            error = body.get("error", body)
            if isinstance(error, dict) and error.get("code") == "insufficient_quota":
                return True
        if "insufficient_quota" in str(current):
            return True
        current = current.__cause__ or current.__context__
    return False


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
    required_index_sequence = ", ".join(
        str(sentence_index)
        for sentence_index in range(len(sentences))
        for _ in range(2)
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
- Questions MUST start with: Who, Whose, What, Which, Where, When, Why, or How
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
- Return questions in this exact sentence_index sequence: {required_index_sequence}
- sentence_index matches the [N] number from the sentence list
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


def _normalize_sentence_indexes_by_order(
    questions: list[Question], sentence_count: int
) -> None:
    """Repair model index labels when the fixed-length output order is complete.

    The prompt requires the exact order ``0, 0, 1, 1, ...`` and the production
    response schema requires exactly two items per sentence. Models sometimes
    preserve that order while emitting a wrong numeric label. Treating the
    array position as authoritative avoids regenerating an otherwise valid
    page. Wrong-length responses are intentionally left untouched so normal
    validation and retry behavior still applies.
    """
    if len(questions) != sentence_count * 2:
        return
    for question_index, question in enumerate(questions):
        question["sentence_index"] = question_index // 2


def _normalize_question_starters(questions: list[Question]) -> None:
    """Preserve rare non-WH questions by wrapping them in a WH prompt."""
    for question in questions:
        text = _clean_text(question.get("question_en", ""))
        first_word = text.split()[0].lower() if text.split() else ""
        if text and first_word not in _WH_STARTERS:
            question["question_en"] = (
                f"What is the correct answer to this question: {text}"
            )


def _v3_validation_error(
    questions: Sequence[Question],
    sentence_count: int,
) -> str | None:
    """Return a safe, actionable v3 validation error or None."""
    if not questions:
        return "questions list is empty"

    # Check: exactly 2 questions per sentence
    counts: dict[int, int] = {}
    for question_index, q in enumerate(questions):
        si = q.get("sentence_index")
        if not isinstance(si, int) or si < 0 or si >= sentence_count:
            return (
                f"question {question_index} has invalid sentence_index; "
                f"expected an integer from 0 to {sentence_count - 1}"
            )
        counts[si] = counts.get(si, 0) + 1

    for i in range(sentence_count):
        if counts.get(i, 0) != 2:
            return (
                f"sentence_index {i} has {counts.get(i, 0)} questions; "
                "expected exactly 2"
            )

    for question_index, q in enumerate(questions):
        # Must be choice type
        if q.get("type") != "choice":
            return f"question {question_index} type must be choice"
        # question_en required, min 3 chars
        if not isinstance(q.get("question_en"), str) or len(q["question_en"]) < 3:
            return f"question {question_index} question_en must be at least 3 characters"
        # Must start with Wh- word
        first_word = q["question_en"].split()[0].lower() if q["question_en"].split() else ""
        if first_word not in _WH_STARTERS:
            return (
                f"question {question_index} must start with "
                "Who, Whose, What, Which, Where, When, Why, or How"
            )
        # 3 options, correct_index 0-2
        options = q.get("options_en") or []
        if len(options) != 3:
            return f"question {question_index} has {len(options)} options; expected exactly 3"
        if q.get("correct_index") not in (0, 1, 2):
            return f"question {question_index} correct_index must be 0, 1, or 2"
        # No Vietnamese
        if "question_vi" in q or "options_vi" in q:
            return f"question {question_index} must not include Vietnamese fields"

    return None


def _valid_v3_questions(questions: Sequence[Question], sentence_count: int) -> bool:
    """Validate v3 WH- comprehension questions."""
    return _v3_validation_error(questions, sentence_count) is None


def _guided_listening_retry_prompt(base_prompt: str, failure_reason: str) -> str:
    """Add bounded corrective feedback without including raw model output."""
    return f"""{base_prompt}

CORRECTION FOR RETRY:
Your previous JSON response was rejected because: {failure_reason}
Return a corrected JSON object that follows every rule above. Do not explain the correction."""


def _process_single_paragraph(
    paragraph_index: int,
    paragraph_text: str,
    para_sentences: list[str],
    sentence_offset: int,
    all_sentences: list[str],
    llm_fallback: LLMFallback | None,
    llm_fallback_with_count: CountAwareLLMFallback | None,
    quota_abort: threading.Event | None = None,
) -> ParagraphQuestions:
    """Process one paragraph: build prompt, call LLM with retries, number questions.

    This is self-contained so it can run in a worker thread.
    """
    prompt = build_guided_listening_prompt(
        paragraph_text,
        para_sentences,
        story_context=all_sentences,
        paragraph_index=paragraph_index,
    )

    last_error = ""
    attempt_prompt = prompt
    questions: list[Question] = []
    for attempt in range(_MAX_GUIDED_ATTEMPTS):
        if quota_abort is not None and quota_abort.is_set():
            raise RuntimeError(
                "insufficient_quota: guided generation aborted after sibling failure"
            )
        try:
            raw = (
                llm_fallback_with_count(attempt_prompt, len(para_sentences))
                if llm_fallback_with_count is not None
                else llm_fallback(attempt_prompt)
            )
            questions = _parse_llm_questions(raw)
            _normalize_sentence_indexes_by_order(questions, len(para_sentences))
            _normalize_question_starters(questions)
        except Exception as exc:
            if _is_insufficient_quota_error(exc):
                if quota_abort is not None:
                    quota_abort.set()
                raise
            last_error = f"{type(exc).__name__}: {exc}"
            if attempt < _MAX_GUIDED_ATTEMPTS - 1:
                print(
                    f"GUIDED retry paragraph={paragraph_index} "
                    f"attempt={attempt + 1} reason={last_error}"
                )
                attempt_prompt = _guided_listening_retry_prompt(prompt, last_error)
            continue

        validation_error = _v3_validation_error(questions, len(para_sentences))
        if validation_error is None:
            break
        last_error = f"questions failed v3 validation: {validation_error}"
        if attempt < _MAX_GUIDED_ATTEMPTS - 1:
            print(
                f"GUIDED retry paragraph={paragraph_index} "
                f"attempt={attempt + 1} reason={last_error}"
            )
            attempt_prompt = _guided_listening_retry_prompt(prompt, last_error)
    else:
        raise ValueError(
            f"guided_listening paragraph {paragraph_index} LLM failed: {last_error}"
        )

    # Assign IDs and sentence_index (offset by sentence_offset for global indexing)
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
            "sentence_index": sentence_offset + si,
        }
        numbered.append(item)

    return {"paragraph_index": paragraph_index, "questions": numbered}


def generate_guided_listening(
    story: dict[str, Any],
    *,
    llm_fallback: LLMFallback | None = None,
    llm_fallback_with_count: CountAwareLLMFallback | None = None,
    max_workers: int = 1,
    completed_entries: Sequence[ParagraphQuestions] | None = None,
    on_paragraph_complete: ParagraphCompleteCallback | None = None,
) -> list[ParagraphQuestions]:
    """Generate guided_listening entries with WH- comprehension questions.

    Calls LLM for each paragraph to generate 2 questions per sentence.
    When ``max_workers`` > 1, paragraphs are processed concurrently via
    ThreadPoolExecutor. Output ordering is always by paragraph_index.
    """
    paragraphs = story.get("paragraphs_en")
    if not isinstance(paragraphs, list) or not paragraphs:
        raise ValueError("story.paragraphs_en must be a non-empty list")

    if llm_fallback is None and llm_fallback_with_count is None:
        raise ValueError("llm_fallback is required for guided_listening generation")

    # Build full sentence list for context
    all_sentences: list[str] = []
    for paragraph in paragraphs:
        all_sentences.extend(_split_paragraph_sentences(_clean_text(paragraph)))

    # Pre-compute paragraph data with sentence offsets so each paragraph
    # can be processed independently (thread-safe).
    paragraph_data: list[tuple[int, str, list[str], int]] = []
    sentence_cursor = 0
    for paragraph_index, paragraph in enumerate(paragraphs):
        paragraph_text = _clean_text(paragraph)
        para_sentences = _split_paragraph_sentences(paragraph_text)
        if not para_sentences:
            continue
        paragraph_data.append(
            (paragraph_index, paragraph_text, para_sentences, sentence_cursor)
        )
        sentence_cursor += len(para_sentences)

    cached_by_index = {
        entry.get("paragraph_index"): entry
        for entry in completed_entries or []
        if isinstance(entry, dict)
    }
    results: dict[int, ParagraphQuestions] = {}
    pending_data: list[tuple[int, str, list[str], int]] = []
    for p_index, p_text, p_sentences, p_offset in paragraph_data:
        cached = cached_by_index.get(p_index)
        localized_questions: list[Question] = []
        if isinstance(cached, dict) and isinstance(cached.get("questions"), list):
            for question in cached["questions"]:
                if not isinstance(question, dict):
                    continue
                global_index = question.get("sentence_index")
                localized_questions.append(
                    {
                        **question,
                        "sentence_index": (
                            global_index - p_offset
                            if isinstance(global_index, int)
                            else -1
                        ),
                    }
                )
        if (
            isinstance(cached, dict)
            and len(localized_questions) == len(cached.get("questions", []))
            and _valid_v3_questions(localized_questions, len(p_sentences))
        ):
            results[p_index] = cached
        else:
            pending_data.append((p_index, p_text, p_sentences, p_offset))

    if results:
        print(f"GUIDED cache pages={len(results)}/{len(paragraph_data)}")

    if max_workers <= 1:
        # Serial path — preserves exact original behavior
        for p_index, p_text, p_sentences, p_offset in pending_data:
            entry = _process_single_paragraph(
                p_index,
                p_text,
                p_sentences,
                p_offset,
                all_sentences,
                    llm_fallback,
                    llm_fallback_with_count,
                    None,
                )
            results[p_index] = entry
            if on_paragraph_complete is not None:
                on_paragraph_complete(entry)
        return [results[p_index] for p_index, _, _, _ in paragraph_data]

    # Concurrent path — results collected and sorted by paragraph_index
    total = len(paragraph_data)
    completed = len(results)
    quota_abort = threading.Event()
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(
                _process_single_paragraph,
                p_index,
                p_text,
                p_sentences,
                p_offset,
                all_sentences,
                llm_fallback,
                llm_fallback_with_count,
                quota_abort,
            ): p_index
            for p_index, p_text, p_sentences, p_offset in pending_data
        }
        for future in as_completed(futures):
            try:
                result = future.result()
            except Exception:
                for pending in futures:
                    pending.cancel()
                raise
            results[result["paragraph_index"]] = result
            if on_paragraph_complete is not None:
                on_paragraph_complete(result)
            completed += 1
            print(f"GUIDED progress {completed}/{total}")

    return [results[p_index] for p_index, _, _, _ in paragraph_data]


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
