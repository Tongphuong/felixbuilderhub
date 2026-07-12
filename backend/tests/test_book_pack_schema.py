"""JSON Schema coverage for StoryWeaver book packs and legacy compatibility."""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

import pytest
from jsonschema import Draft7Validator

from tests.fixtures.sample_pack_v2_l1 import minimal_l1_pack_v2


SCHEMA = json.loads(
    (Path(__file__).resolve().parents[1] / "schemas" / "pack.schema.v2.json").read_text(
        encoding="utf-8"
    )
)
VALIDATOR = Draft7Validator(SCHEMA)


def schema_errors(pack: dict) -> list[str]:
    return [error.message for error in VALIDATOR.iter_errors(pack)]


def book_pack() -> dict:
    pack = minimal_l1_pack_v2()
    sentences = pack["story"]["sentences"]
    paragraphs = pack["story"]["paragraphs_en"]
    pack.update(
        {
            "slug": "book_167470",
            "audio_filename": "book_167470.mp3",
            "book_slug": "book_167470",
            "book_images": [
                f"https://audio.felixbuilderhub.com/books/book_167470/page_{i:02d}.jpg"
                for i in range(len(paragraphs))
            ],
            "book_page_audio": [
                f"https://audio.felixbuilderhub.com/books/book_167470/page_{i:02d}.mp3"
                for i in range(len(paragraphs))
            ],
            "book_attribution": {
                "title": pack["story"]["title"],
                "creators": ["Author Example", "Illustrator Example"],
                "publisher": "Pratham Books",
                "credit_text": "Published on StoryWeaver by Pratham Books.",
                "source_url": "https://storyweaver.org.in/stories/167470",
                "image_credits": [
                    {
                        "page_index": i,
                        "credit_text": "Illustration by Illustrator Example.",
                    }
                    for i in range(len(paragraphs))
                ],
                "license": {
                    "name": "CC BY 4.0",
                    "url": "https://creativecommons.org/licenses/by/4.0/",
                },
            },
        }
    )
    pack["story"].pop("paragraphs_vi", None)
    pack["guided_listening"] = []
    for paragraph_index in range(len(paragraphs)):
        questions = []
        for sentence_index, sentence in enumerate(sentences):
            if sentence["paragraph_index"] != paragraph_index:
                continue
            for question_number in (1, 2):
                questions.append(
                    {
                        "id": (
                            f"gl_p{paragraph_index}_s{sentence_index}_q{question_number}"
                        ),
                        "type": "choice",
                        "question_en": "What happens in this sentence?",
                        "options_en": ["This happens", "Something else", "Nothing"],
                        "correct_index": 0,
                        "sentence_index": sentence_index,
                    }
                )
        pack["guided_listening"].append(
            {"paragraph_index": paragraph_index, "questions": questions}
        )
    read_aloud = {
        "type": "read_aloud",
        "title_vi": "Đọc to",
        "identity_vi": "Con đọc từng câu cho Minny nghe nhé!",
        "instructions_vi": "Nghe lại câu mẫu rồi đọc to và rõ.",
        "scoring_mode": "whisper_stt",
        "items": [
            {
                "id": f"ra_{index}",
                "text_en": sentence["text_en"],
                "audio_url": (
                    "https://audio.felixbuilderhub.com/"
                    f"books/book_167470/s_{index:03d}.mp3"
                ),
            }
            for index, sentence in enumerate(sentences)
        ],
    }
    pack["activities"] = [read_aloud]
    return pack


def test_legacy_pack_remains_valid():
    assert schema_errors(minimal_l1_pack_v2()) == []


def test_book_pack_with_read_aloud_only_is_valid():
    assert schema_errors(book_pack()) == []


def test_legacy_pack_still_requires_at_least_four_activities():
    pack = minimal_l1_pack_v2()
    pack["activities"] = pack["activities"][:3]
    assert schema_errors(pack)


@pytest.mark.parametrize(
    ("mutation", "expected_fragment"),
    [
        (lambda pack: pack.pop("book_attribution"), "required property"),
        (
            lambda pack: pack["activities"].extend(
                [deepcopy(pack["activities"][0])] * 2
            ),
            "too long",
        ),
        (lambda pack: pack.__setitem__("slug", "167470-book"), "does not match"),
        (
            lambda pack: pack.__setitem__("audio_filename", "book_167470.wav"),
            "does not match",
        ),
    ],
)
def test_invalid_book_contract_is_rejected(mutation, expected_fragment):
    pack = book_pack()
    mutation(pack)
    errors = schema_errors(pack)
    assert errors
    assert any(expected_fragment in error for error in errors)


def test_book_pack_accepts_vocabulary():
    pack = book_pack()
    pack["vocabulary"] = [
        {"word_en": "kite", "meaning_vi": "con diều", "paragraph_index": 0},
        {"word_en": "tall", "meaning_vi": "cao", "paragraph_index": 1},
    ]
    assert schema_errors(pack) == []


def test_legacy_pack_accepts_vocabulary_too():
    """vocabulary is a root property, not book-only — the standard (non-book)
    pack shape must accept it as well."""
    pack = minimal_l1_pack_v2()
    pack["vocabulary"] = [{"word_en": "bird", "meaning_vi": "con chim", "paragraph_index": 1}]
    assert schema_errors(pack) == []


def test_pack_without_vocabulary_remains_valid():
    """vocabulary is optional — omitting it entirely must not break anything."""
    assert "vocabulary" not in minimal_l1_pack_v2()
    assert schema_errors(minimal_l1_pack_v2()) == []


@pytest.mark.parametrize(
    ("vocabulary_item", "expected_fragment"),
    [
        ({"word_en": "", "meaning_vi": "x", "paragraph_index": 0}, "should be non-empty"),
        ({"word_en": "x", "meaning_vi": "", "paragraph_index": 0}, "should be non-empty"),
        ({"word_en": "x", "meaning_vi": "y", "paragraph_index": -1}, "less than the minimum"),
        ({"word_en": "x", "meaning_vi": "y"}, "is a required property"),
        (
            {"word_en": "x", "meaning_vi": "y", "paragraph_index": 0, "extra": 1},
            "Additional properties are not allowed",
        ),
    ],
)
def test_book_pack_rejects_invalid_vocabulary_shapes(vocabulary_item, expected_fragment):
    pack = book_pack()
    pack["vocabulary"] = [vocabulary_item]
    errors = schema_errors(pack)
    assert errors
    assert any(expected_fragment in error for error in errors)


def test_book_pack_rejects_more_than_24_pages():
    pack = book_pack()
    paragraph = pack["story"]["paragraphs_en"][0]
    pack["story"]["paragraphs_en"] = [paragraph] * 25
    pack["book_images"] = [
        f"https://audio.felixbuilderhub.com/books/book_167470/page_{i:02d}.jpg"
        for i in range(25)
    ]
    pack["book_page_audio"] = [
        f"https://audio.felixbuilderhub.com/books/book_167470/page_{i:02d}.mp3"
        for i in range(25)
    ]
    assert any("too long" in error for error in schema_errors(pack))
