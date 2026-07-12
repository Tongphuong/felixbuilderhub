"""Tests for the --enrich-published book enrichment batch (R2L-PAGE-LOOP fix
round 2 addendum): translations + vocabulary + guided_listening regeneration
for an ALREADY-PUBLISHED pack, without re-doing TTS/images.

No live LLM or KV/network calls — the LLM helper and the publish-endpoint GET
are mocked throughout.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import process_books  # noqa: E402
import generate_qa  # noqa: E402

from tests.test_book_pack_schema import book_pack  # noqa: E402

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "schemas" / "pack.schema.v2.json"


class _FakeHTTPResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


class FakeServices:
    """Duck-typed double for ProductionServices — no OpenAI/R2/network calls.

    complete_json branches on prompt content (enrichment vs guided-listening)
    the same way a real LLM response would differ by what was asked for.
    """

    def __init__(self):
        self.calls: list[str] = []
        self.published: list[tuple[str, dict]] = []

    def complete_json(self, system, prompt):
        self.calls.append(prompt)
        indices = sorted(int(match) for match in re.findall(r"\[(\d+)\]", prompt))
        if "PAGE TEXT:" in prompt:
            return {
                "sentences": [{"index": i, "text_vi": f"vi-{i}"} for i in indices],
                "hard_words": (
                    [{"word_en": f"word{indices[0]}", "meaning_vi": f"nghia{indices[0]}"}]
                    if indices
                    else []
                ),
            }
        questions = []
        wh_words = ["Who", "What", "Where"]
        for sentence_index in indices:
            for _ in (1, 2):
                questions.append({
                    "type": "choice",
                    "sentence_index": sentence_index,
                    "question_en": f"{wh_words[sentence_index % 3]} is here?",
                    "options_en": ["A", "B", "C"],
                    "correct_index": 0,
                    "answerable_from_sentence": True,
                })
        return {"questions": questions}

    def generate_guided_for_paragraphs(self, paragraphs, *, complete_json=None):
        complete = complete_json or self.complete_json
        return generate_qa.generate_guided_listening(
            {"paragraphs_en": paragraphs},
            llm_fallback=lambda prompt: complete(
                "Return only validated listening-question JSON.", prompt
            ),
        )

    def publish_book(self, level, pack):
        self.published.append((level, pack))


# ── validate_enrichment_response ────────────────────────────────────────────


def test_validate_enrichment_response_accepts_well_formed():
    response = {
        "sentences": [{"index": 0, "text_vi": "Xin chao"}, {"index": 1, "text_vi": "Tam biet"}],
        "hard_words": [{"word_en": "hello", "meaning_vi": "xin chao"}],
    }
    text_vi, hard_words = process_books.validate_enrichment_response(response, 2)
    assert text_vi == ["Xin chao", "Tam biet"]
    assert hard_words == [{"word_en": "hello", "meaning_vi": "xin chao"}]


def test_validate_enrichment_response_allows_zero_hard_words():
    response = {"sentences": [{"index": 0, "text_vi": "Xin chao"}]}
    text_vi, hard_words = process_books.validate_enrichment_response(response, 1)
    assert text_vi == ["Xin chao"]
    assert hard_words == []


def test_validate_enrichment_response_rejects_sentence_count_mismatch():
    response = {"sentences": [{"index": 0, "text_vi": "Xin chao"}]}
    with pytest.raises(process_books.BookProcessingError, match="expected 2"):
        process_books.validate_enrichment_response(response, 2)


def test_validate_enrichment_response_rejects_empty_text_vi():
    response = {"sentences": [{"index": 0, "text_vi": "   "}]}
    with pytest.raises(process_books.BookProcessingError):
        process_books.validate_enrichment_response(response, 1)


def test_validate_enrichment_response_rejects_too_many_hard_words():
    response = {
        "sentences": [{"index": 0, "text_vi": "Xin chao"}],
        "hard_words": [{"word_en": f"w{i}", "meaning_vi": f"m{i}"} for i in range(5)],
    }
    with pytest.raises(process_books.BookProcessingError, match="hard_words"):
        process_books.validate_enrichment_response(response, 1)


def test_validate_enrichment_response_rejects_hard_word_missing_meaning():
    response = {
        "sentences": [{"index": 0, "text_vi": "Xin chao"}],
        "hard_words": [{"word_en": "hello"}],
    }
    with pytest.raises(process_books.BookProcessingError, match="hard_word"):
        process_books.validate_enrichment_response(response, 1)


# ── enrich_pack ──────────────────────────────────────────────────────────────


def test_enrich_pack_fills_text_vi_and_vocabulary_one_call_per_page():
    pack = {
        "story": {
            "paragraphs_en": ["Mai sees a cat.", "The cat runs fast."],
            "sentences": [
                {"text_en": "Mai sees a cat.", "paragraph_index": 0, "audio_url": "https://a/s0.mp3"},
                {"text_en": "The cat runs fast.", "paragraph_index": 1, "audio_url": "https://a/s1.mp3"},
            ],
        },
        "book_images": ["https://a/p0.jpg"],
    }
    calls = []

    def fake_complete_json(system, prompt):
        calls.append(prompt)
        return {
            "sentences": [{"index": 0, "text_vi": "vi-text"}],
            "hard_words": [{"word_en": "cat", "meaning_vi": "con meo"}],
        }

    enriched = process_books.enrich_pack(pack, fake_complete_json)

    assert len(calls) == 2  # one complete_json call per page
    assert enriched["story"]["sentences"][0]["text_vi"] == "vi-text"
    assert enriched["story"]["sentences"][1]["text_vi"] == "vi-text"
    assert enriched["vocabulary"] == [
        {"word_en": "cat", "meaning_vi": "con meo", "paragraph_index": 0},
        {"word_en": "cat", "meaning_vi": "con meo", "paragraph_index": 1},
    ]
    # audio/images reused verbatim
    assert enriched["story"]["sentences"][0]["audio_url"] == "https://a/s0.mp3"
    assert enriched["book_images"] == ["https://a/p0.jpg"]
    # input pack is not mutated
    assert "text_vi" not in pack["story"]["sentences"][0]


# ── ProductionServices.generate_guided_for_paragraphs ───────────────────────


def test_generate_guided_for_paragraphs_routes_through_injected_complete_json():
    # Bypass __init__ (no OPENAI_API_KEY/R2 env or SDK imports needed) — this
    # unit-tests just the one new method against the real generate_qa path.
    services = process_books.ProductionServices.__new__(process_books.ProductionServices)
    services._guided = generate_qa.generate_guided_listening

    def fake_complete(system, prompt):
        count = len(re.findall(r"\[\d+\]", prompt))
        questions = []
        for sentence_index in range(count):
            for _ in (1, 2):
                questions.append({
                    "type": "choice",
                    "sentence_index": sentence_index,
                    "question_en": "Who is here?",
                    "options_en": ["A", "B", "C"],
                    "correct_index": 0,
                    "answerable_from_sentence": True,
                })
        return {"questions": questions}

    guided = services.generate_guided_for_paragraphs(
        ["Mai sees a cat."], complete_json=fake_complete
    )
    assert len(guided) == 1
    assert len(guided[0]["questions"]) == 2


# ── discover_published_slugs / fetch_published_* (mocked HTTP + env) ───────


def test_enrich_levels_matches_publish_endpoint_valid_levels():
    """No L5 book index exists on functions/api/publish-read2lead-book.js."""
    assert process_books.ENRICH_LEVELS == ("L0", "L1", "L2", "L3", "L4")


def test_discover_published_slugs_returns_only_slug_without_fetching(monkeypatch):
    def fail_if_called(level):
        raise AssertionError("must not fetch an index when only_slug is given")

    monkeypatch.setattr(process_books, "fetch_published_index", fail_if_called)
    assert process_books.discover_published_slugs(only_slug="book_42") == ["book_42"]


def test_discover_published_slugs_dedupes_across_levels_and_applies_limit(monkeypatch):
    index_by_level = {
        "L0": ["book_1"],
        "L1": ["book_1", "book_2"],
        "L2": ["book_3"],
        "L3": [],
        "L4": ["book_4"],
    }
    monkeypatch.setattr(process_books, "fetch_published_index", lambda level: index_by_level[level])
    assert process_books.discover_published_slugs() == ["book_1", "book_2", "book_3", "book_4"]
    assert process_books.discover_published_slugs(limit=2) == ["book_1", "book_2"]


def test_fetch_published_index_hits_expected_url_and_auth_header(monkeypatch):
    monkeypatch.setenv("READ2LEAD_PUBLISH_URL", "https://hub.example.com/api/publish-read2lead-book")
    monkeypatch.setenv("READ2LEAD_BACKEND_SECRET", "s3cr3t")
    seen = {}

    def fake_urlopen(request, timeout=30):
        seen["url"] = request.full_url
        seen["secret"] = request.get_header("X-read2lead-secret")
        return _FakeHTTPResponse({"ok": True, "level": "L1", "slugs": ["book_9"]})

    monkeypatch.setattr(process_books, "urlopen", fake_urlopen)
    assert process_books.fetch_published_index("L1") == ["book_9"]
    assert seen["url"] == "https://hub.example.com/api/publish-read2lead-book?index=L1"
    assert seen["secret"] == "s3cr3t"


def test_fetch_published_index_raises_when_not_ok(monkeypatch):
    monkeypatch.setenv("READ2LEAD_PUBLISH_URL", "https://hub.example.com/api/publish-read2lead-book")
    monkeypatch.setenv("READ2LEAD_BACKEND_SECRET", "s3cr3t")
    monkeypatch.setattr(
        process_books,
        "urlopen",
        lambda request, timeout=30: _FakeHTTPResponse({"ok": False, "error": "invalid_level"}),
    )
    with pytest.raises(process_books.BookProcessingError, match="invalid_level"):
        process_books.fetch_published_index("L9")


def test_fetch_published_pack_returns_pack(monkeypatch):
    monkeypatch.setenv("READ2LEAD_PUBLISH_URL", "https://hub.example.com/api/publish-read2lead-book")
    monkeypatch.setenv("READ2LEAD_BACKEND_SECRET", "s3cr3t")
    monkeypatch.setattr(
        process_books,
        "urlopen",
        lambda request, timeout=30: _FakeHTTPResponse({"ok": True, "slug": "book_9", "pack": {"a": 1}}),
    )
    assert process_books.fetch_published_pack("book_9") == {"a": 1}


def test_fetch_published_pack_raises_on_not_found(monkeypatch):
    monkeypatch.setenv("READ2LEAD_PUBLISH_URL", "https://hub.example.com/api/publish-read2lead-book")
    monkeypatch.setenv("READ2LEAD_BACKEND_SECRET", "s3cr3t")
    monkeypatch.setattr(
        process_books,
        "urlopen",
        lambda request, timeout=30: _FakeHTTPResponse({"ok": False, "error": "not_found"}),
    )
    with pytest.raises(process_books.BookProcessingError, match="not_found"):
        process_books.fetch_published_pack("book_missing")


# ── required_enrich_env_missing ──────────────────────────────────────────────


def test_required_enrich_env_missing_lists_absent_vars(monkeypatch):
    for name in ("OPENAI_API_KEY", "R2_PUBLIC_URL", "READ2LEAD_PUBLISH_URL", "READ2LEAD_BACKEND_SECRET"):
        monkeypatch.delenv(name, raising=False)
    assert set(process_books.required_enrich_env_missing()) == {
        "OPENAI_API_KEY",
        "R2_PUBLIC_URL",
        "READ2LEAD_PUBLISH_URL",
        "READ2LEAD_BACKEND_SECRET",
    }
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    monkeypatch.setenv("R2_PUBLIC_URL", "https://pub.example.com")
    monkeypatch.setenv("READ2LEAD_PUBLISH_URL", "https://hub.example.com/api/publish-read2lead-book")
    monkeypatch.setenv("READ2LEAD_BACKEND_SECRET", "s3cr3t")
    assert process_books.required_enrich_env_missing() == []


# ── parse_args ───────────────────────────────────────────────────────────────


def test_parse_args_requires_level_unless_enrich_published():
    with pytest.raises(SystemExit):
        process_books.parse_args([])

    args = process_books.parse_args(["--enrich-published"])
    assert args.level is None
    assert args.enrich_published is True

    args = process_books.parse_args(["--level", "1"])
    assert args.level == "1"


def test_parse_args_rejects_limit_below_one():
    with pytest.raises(SystemExit):
        process_books.parse_args(["--enrich-published", "--limit", "0"])


# ── enrich_and_publish_book (full round trip against a valid book pack) ────


def test_enrich_and_publish_book_writes_local_file_and_skips_publish_by_default(monkeypatch, tmp_path):
    original_pack = book_pack()
    monkeypatch.setattr(process_books, "fetch_published_pack", lambda slug: original_pack)
    fake = FakeServices()

    result = process_books.enrich_and_publish_book(
        "book_167470", fake, schema_path=SCHEMA_PATH, out_dir=tmp_path, publish=False
    )

    # 4 paragraphs: 4 enrichment calls + 4 guided-listening-regeneration calls
    assert result == {"slug": "book_167470", "llm_calls": 8}
    assert fake.published == []

    out_file = tmp_path / "book_167470.json"
    assert out_file.exists()
    saved = json.loads(out_file.read_text(encoding="utf-8"))
    assert saved["vocabulary"], "vocabulary must be populated"
    assert all(sentence.get("text_vi") for sentence in saved["story"]["sentences"])
    # audio/images reused verbatim from the original published pack
    for original, enriched_sentence in zip(
        original_pack["story"]["sentences"], saved["story"]["sentences"]
    ):
        assert enriched_sentence["audio_url"] == original["audio_url"]
    assert saved["book_images"] == original_pack["book_images"]
    assert saved["book_page_audio"] == original_pack["book_page_audio"]


def test_enrich_and_publish_book_publishes_when_flag_set(monkeypatch, tmp_path):
    original_pack = book_pack()
    monkeypatch.setattr(process_books, "fetch_published_pack", lambda slug: original_pack)
    fake = FakeServices()

    process_books.enrich_and_publish_book(
        "book_167470", fake, schema_path=SCHEMA_PATH, out_dir=tmp_path, publish=True
    )

    assert len(fake.published) == 1
    published_level, published_pack = fake.published[0]
    assert published_level == "L1"
    assert published_pack["book_slug"] == "book_167470"
