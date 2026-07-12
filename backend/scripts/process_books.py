#!/usr/bin/env python3
"""Preprocess StoryWeaver books into validated Read2Lead book packs."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import html
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

LEVEL_MAP = {
    "1": {"level": "L1", "level_label": "Cấp 1"},
    "2": {"level": "L2", "level_label": "Cấp 2"},
    "3": {"level": "L3", "level_label": "Cấp 3"},
    "4": {"level": "L4", "level_label": "Cấp 4"},
}
# Levels the enrichment batch (--enrich-published) enumerates via the publish
# endpoint's book_index. Matches VALID_LEVELS in
# functions/api/publish-read2lead-book.js (L0 Emergent Reader through L4;
# no L5 book index exists on that endpoint).
ENRICH_LEVELS = ("L0", "L1", "L2", "L3", "L4")
DEFAULT_REPOS_ROOT = Path.home() / "work" / "repos"
MAX_ATTEMPTS = 3
LICENSE_NAME = "CC BY 4.0"
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
PAGE_RE = re.compile(
    r"--- Page (\d+) \(([^)]+)\) ---\s*(.*?)(?=\n--- Page|\Z)", re.DOTALL
)
IMAGE_CREDIT_RE = re.compile(
    r"(?:Cover page|Page (\d+)):\s*(.*?)(?=\s+(?:Cover page|Page \d+|Disclaimer):|\Z)",
    re.DOTALL,
)


class BookProcessingError(RuntimeError):
    """Operational failure whose message contains no credentials."""


@dataclass(frozen=True)
class StoryPage:
    page_num: int
    text: str
    image_path: Path


@dataclass(frozen=True)
class BookSource:
    directory: Path
    storyweaver_id: int
    source_slug: str
    book_slug: str
    title: str
    level: str
    level_label: str
    pages: tuple[StoryPage, ...]
    sentences: tuple[dict[str, Any], ...]
    attribution: dict[str, Any]


def clean_text(value: Any) -> str:
    text = html.unescape(str(value or "")).replace("\u00ad", "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def parse_page_sections(story_text: str) -> list[dict[str, Any]]:
    return [
        {
            "page_num": int(match.group(1)),
            "page_type": match.group(2).strip(),
            "text": clean_text(match.group(3)),
        }
        for match in PAGE_RE.finditer(story_text)
    ]


def parse_story_pages(story_txt_path: str | Path) -> list[dict[str, Any]]:
    sections = parse_page_sections(Path(story_txt_path).read_text(encoding="utf-8"))
    return [
        {"page_num": section["page_num"], "text": section["text"]}
        for section in sections
        if section["page_type"] == "StoryPage" and section["text"]
    ]


def _names(metadata: dict[str, Any], field: str) -> list[str]:
    result: list[str] = []
    for entry in metadata.get(field) or []:
        name = clean_text(entry.get("name") if isinstance(entry, dict) else entry)
        if name and name not in result:
            result.append(name)
    return result


def extract_attribution(
    story_text: str,
    metadata: dict[str, Any],
    story_pages: list[dict[str, Any]],
) -> dict[str, Any]:
    back_text = next(
        (
            section["text"]
            for section in parse_page_sections(story_text)
            if section["page_type"] == "BackInnerCoverPage"
        ),
        "",
    )
    if not back_text:
        raise BookProcessingError("missing StoryWeaver attribution page")
    authors = _names(metadata, "authors")
    illustrators = _names(metadata, "illustrators")
    creators = list(dict.fromkeys([*authors, *illustrators]))
    publisher_raw = metadata.get("publisher")
    publisher = clean_text(
        publisher_raw.get("name") if isinstance(publisher_raw, dict) else publisher_raw
    ) or "StoryWeaver / Pratham Books"
    story_id = int(metadata.get("id"))
    source_slug = clean_text(metadata.get("slug")) or str(story_id)
    credits_by_page: dict[int, str] = {}
    for match in IMAGE_CREDIT_RE.finditer(back_text):
        if match.group(1) is not None:
            credits_by_page[int(match.group(1))] = clean_text(match.group(2))
    fallback = (
        f"Illustration by {', '.join(illustrators)}."
        if illustrators
        else "Image credit is included in the complete StoryWeaver attribution."
    )
    return {
        "title": clean_text(metadata.get("title")),
        "creators": creators or [publisher],
        "publisher": publisher,
        "credit_text": back_text,
        "source_url": f"https://storyweaver.org.in/stories/{source_slug}",
        "image_credits": [
            {
                "page_index": index,
                "credit_text": credits_by_page.get(page["page_num"], fallback),
            }
            for index, page in enumerate(story_pages)
        ],
        "license": {"name": LICENSE_NAME, "url": LICENSE_URL},
    }


def default_sentence_splitter(paragraph: str) -> list[str]:
    backend_root = Path(
        os.getenv("READ2LEAD_BACKEND_ROOT", DEFAULT_REPOS_ROOT / "read2lead_v0_codex")
    )
    api_path = str(backend_root / "api")
    if api_path not in sys.path:
        sys.path.insert(0, api_path)
    from generate_qa import _split_paragraph_sentences

    return _split_paragraph_sentences(paragraph)


def validate_image(path: Path) -> None:
    try:
        from PIL import Image

        with Image.open(path) as image:
            image.verify()
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("unsupported image format")
    except Exception as exc:
        raise BookProcessingError(f"invalid image: {path.name}") from exc


def preflight_book(
    book_dir: str | Path,
    level_number: str,
    *,
    sentence_splitter: Callable[[str], list[str]] = default_sentence_splitter,
    image_validator: Callable[[Path], None] = validate_image,
) -> BookSource:
    directory = Path(book_dir)
    metadata_path = directory / "metadata.json"
    story_path = directory / "story.txt"
    if not metadata_path.is_file() or not story_path.is_file():
        raise BookProcessingError("missing metadata.json or story.txt")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    story_text = story_path.read_text(encoding="utf-8")
    raw_pages = parse_story_pages(story_path)
    if not 3 <= len(raw_pages) <= 24:
        raise BookProcessingError("book must contain 3 to 24 StoryPages")

    pages: list[StoryPage] = []
    sentences: list[dict[str, Any]] = []
    for paragraph_index, page in enumerate(raw_pages):
        image_path = directory / f"page_{page['page_num']:02d}.jpg"
        if not image_path.is_file():
            raise BookProcessingError(f"missing image: {image_path.name}")
        image_validator(image_path)
        pages.append(StoryPage(page["page_num"], page["text"], image_path))
        for sentence in sentence_splitter(page["text"]):
            text = clean_text(sentence)
            if text:
                sentences.append({"text_en": text, "paragraph_index": paragraph_index})
    if len(sentences) < 10:
        raise BookProcessingError("book must contain at least 10 sentences")

    storyweaver_id = int(metadata.get("id"))
    source_slug = clean_text(metadata.get("slug")) or directory.name
    level_info = LEVEL_MAP[level_number]
    return BookSource(
        directory=directory,
        storyweaver_id=storyweaver_id,
        source_slug=source_slug,
        book_slug=f"book_{storyweaver_id}",
        title=clean_text(metadata.get("title")) or source_slug,
        level=level_info["level"],
        level_label=level_info["level_label"],
        pages=tuple(pages),
        sentences=tuple(sentences),
        attribution=extract_attribution(story_text, metadata, raw_pages),
    )


def retry_call(
    operation: Callable[[], Any],
    *,
    attempts: int = MAX_ATTEMPTS,
    sleeper: Callable[[float], None] = time.sleep,
    delay_seconds: float = 5.0,
) -> Any:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            return operation()
        except Exception as exc:
            last_error = exc
            if attempt + 1 < attempts:
                sleeper(delay_seconds)
    raise BookProcessingError(
        f"operation failed after {attempts} attempts ({type(last_error).__name__})"
    ) from last_error


BOOK_ACTIVITY_SYSTEM_PROMPT = """Build exactly two Read2Lead activities from a fixed
StoryWeaver story. Return JSON only: {"activities": [A, B]}.
A is listening_fill_blank using exactly the 5 fixed A sentences supplied.
B is listen_and_order using exactly the 5 fixed B sentences supplied.
Use the existing Read2Lead fields, three options for A, and token arrays for B
that reconstruct each original sentence exactly. Include natural Vietnamese
explanation/gloss fields. Do not generate C, E, or D."""


def build_book_activity_prompt(source: BookSource) -> str:
    numbered = "\n".join(
        f"[{index}] {sentence['text_en']}"
        for index, sentence in enumerate(source.sentences)
    )
    suitable = [
        (index, sentence["text_en"])
        for index, sentence in enumerate(source.sentences)
        if 4 <= len(sentence["text_en"].split()) <= 16
    ][:10]
    if len({text for _, text in suitable}) < 10:
        raise BookProcessingError(
            "book needs 10 unique sentences of 4-16 words for activities A/B"
        )
    fixed_a = "\n".join(f"[{index}] {text}" for index, text in suitable[:5])
    fixed_b = "\n".join(f"[{index}] {text}" for index, text in suitable[5:10])
    return (
        f"Level: {source.level}\nTitle: {source.title}\n"
        "Use each fixed sentence exactly once; do not choose or substitute sentences.\n"
        f"FIXED A SENTENCES:\n{fixed_a}\n"
        f"FIXED B SENTENCES:\n{fixed_b}\n"
        f"STORY SENTENCES:\n{numbered}"
    )


def build_deterministic_ab(source: BookSource) -> list[dict[str, Any]]:
    suitable: list[str] = []
    for sentence in source.sentences:
        text = sentence["text_en"]
        if text not in suitable and 4 <= len(text.split()) <= 16:
            suitable.append(text)
    if len(suitable) < 10:
        raise BookProcessingError(
            "book needs 10 unique sentences of 4-16 words for activities A/B"
        )

    option_words: list[str] = []
    for text in suitable:
        for token in text.split():
            word = re.sub(r"[^A-Za-z'-]", "", token)
            if len(word) >= 3 and word.lower() not in {item.lower() for item in option_words}:
                option_words.append(word)

    a_items = []
    for index, sentence in enumerate(suitable[:5]):
        tokens = sentence.split()
        token_index = max(
            range(len(tokens)),
            key=lambda position: len(re.sub(r"[^A-Za-z'-]", "", tokens[position])),
        )
        answer = re.sub(r"[^A-Za-z'-]", "", tokens[token_index])
        blanked = list(tokens)
        blanked[token_index] = tokens[token_index].replace(answer, "________", 1)
        distractors = [
            word for word in option_words
            if word.lower() != answer.lower()
        ][:2]
        a_items.append(
            {
                "id": f"a_{index}",
                "source_sentence": sentence,
                "sentence_with_blank": " ".join(blanked),
                "options_en": [answer, *distractors],
                "correct_index": 0,
                "explanation_vi": "Nghe kỹ câu chuyện và chọn từ còn thiếu.",
            }
        )

    b_items = []
    for index, sentence in enumerate(suitable[5:10]):
        tokens = sentence.split()
        b_items.append(
            {
                "id": f"b_{index}",
                "original_sentence": sentence,
                "scrambled_tokens": list(reversed(tokens)),
                "correct_order_indices": list(reversed(range(len(tokens)))),
                "translation_vi": "Sắp xếp các từ để tạo lại câu trong truyện.",
            }
        )

    return [
        {
            "type": "listening_fill_blank",
            "title_vi": "Nghe điền",
            "identity_vi": "Thám tử nghe",
            "instructions_vi": "Nghe rồi chọn từ còn thiếu.",
            "items": a_items,
        },
        {
            "type": "listen_and_order",
            "title_vi": "Xếp câu",
            "identity_vi": "Thợ xây câu",
            "instructions_vi": "Nghe rồi xếp các từ đúng thứ tự.",
            "items": b_items,
        },
    ]
def validate_ab_activities(activities: Any, source: BookSource) -> list[dict[str, Any]]:
    if not isinstance(activities, list) or [
        activity.get("type") for activity in activities if isinstance(activity, dict)
    ] != ["listening_fill_blank", "listen_and_order"]:
        raise BookProcessingError("book activity response must contain A then B")
    story_sentences = {sentence["text_en"] for sentence in source.sentences}
    activity_a, activity_b = activities
    if len(activity_a.get("items") or []) != 5 or len(activity_b.get("items") or []) != 5:
        raise BookProcessingError("book activities A and B must contain 5 items each")
    used: set[str] = set()
    for item in activity_a["items"]:
        sentence = item.get("source_sentence")
        if sentence not in story_sentences or sentence in used:
            raise BookProcessingError("activity A sentence is not a unique story sentence")
        used.add(sentence)
        if len(item.get("options_en") or []) != 3 or item.get("correct_index") not in (0, 1, 2):
            raise BookProcessingError("activity A options are invalid")
        if (item.get("sentence_with_blank") or "").count("________") != 1:
            raise BookProcessingError("activity A requires one blank")
    for item in activity_b["items"]:
        sentence = item.get("original_sentence")
        if sentence not in story_sentences or sentence in used:
            raise BookProcessingError("activity B sentence is not a unique unused story sentence")
        used.add(sentence)
        tokens = item.get("scrambled_tokens") or []
        order = item.get("correct_order_indices") or []
        try:
            rebuilt = " ".join(tokens[index] for index in order)
        except (IndexError, TypeError):
            raise BookProcessingError("activity B order indices are invalid")
        if rebuilt != sentence:
            raise BookProcessingError("activity B tokens do not reconstruct the story sentence")
    return activities


def validate_guided_listening(guided: Any, source: BookSource) -> None:
    if not isinstance(guided, list) or len(guided) != len(source.pages):
        raise BookProcessingError("guided listening must contain one entry per page")
    seen: dict[int, int] = {}
    for paragraph_index, entry in enumerate(guided):
        if entry.get("paragraph_index") != paragraph_index:
            raise BookProcessingError("guided listening paragraph order is invalid")
        for question in entry.get("questions") or []:
            sentence_index = question.get("sentence_index")
            if not isinstance(sentence_index, int):
                raise BookProcessingError("guided listening sentence index is invalid")
            seen[sentence_index] = seen.get(sentence_index, 0) + 1
    if set(seen) != set(range(len(source.sentences))) or any(
        count != 2 for count in seen.values()
    ):
        raise BookProcessingError("guided listening requires exactly two questions per sentence")


def attach_activity_audio(
    activities: list[dict[str, Any]], source: BookSource, sentence_audio: list[str]
) -> None:
    audio_by_text = {
        sentence["text_en"]: sentence_audio[index]
        for index, sentence in enumerate(source.sentences)
    }
    for item in activities[0]["items"]:
        item["audio_url"] = audio_by_text[item["source_sentence"]]
    for item in activities[1]["items"]:
        item["audio_url"] = audio_by_text[item["original_sentence"]]


def build_read_aloud(source: BookSource, sentence_audio: list[str]) -> dict[str, Any]:
    return {
        "type": "read_aloud",
        "title_vi": "Đọc to",
        "identity_vi": "Con đọc từng câu cho Minny nghe nhé!",
        "instructions_vi": "Nghe lại câu mẫu rồi đọc to và rõ.",
        "scoring_mode": "whisper_stt",
        "items": [
            {
                "id": f"ra_{index}",
                "text_en": sentence["text_en"],
                "audio_url": sentence_audio[index],
            }
            for index, sentence in enumerate(source.sentences)
        ],
    }


def build_pack(
    source: BookSource,
    *,
    book_images: list[str],
    page_audio: list[str],
    sentence_audio: list[str],
    guided_listening: list[dict[str, Any]],
    ab_activities: list[dict[str, Any]],
) -> dict[str, Any]:
    validate_guided_listening(guided_listening, source)
    activities = validate_ab_activities(ab_activities, source)
    attach_activity_audio(activities, source, sentence_audio)
    return {
        "schema_version": 2,
        "student_name": "Student",
        "level": source.level,
        "level_label": source.level_label,
        "topic": source.title,
        "slug": source.book_slug,
        "audio_filename": f"{source.book_slug}.mp3",
        "book_slug": source.book_slug,
        "book_images": book_images,
        "book_page_audio": page_audio,
        "book_attribution": source.attribution,
        "story": {
            "title": source.title,
            "paragraphs_en": [page.text for page in source.pages],
            "sentences": [
                {**sentence, "audio_url": sentence_audio[index]}
                for index, sentence in enumerate(source.sentences)
            ],
        },
        "activities": [*activities, build_read_aloud(source, sentence_audio)],
        "guided_listening": guided_listening,
        "rewards": {
            "coins_on_complete": 15,
            "xp_on_complete": 20,
            "bonus_coins_per_activity_attempted": 2,
        },
        "parent_note_vi": (
            f"Con vừa đọc xong truyện '{source.title}'. "
            "Ba mẹ hãy hỏi con kể lại câu chuyện bằng tiếng Anh nhé!"
        ),
        "next_suggestion_vi": "Con tiếp tục đọc thêm truyện mới để luyện nghe và đọc hiểu nhé!",
    }


def validate_pack(pack: dict[str, Any], schema_path: Path) -> None:
    paragraphs = pack.get("story", {}).get("paragraphs_en") or []
    images = pack.get("book_images") or []
    page_audio = pack.get("book_page_audio") or []
    if not len(paragraphs) == len(images) == len(page_audio):
        raise BookProcessingError("page text, image, and audio arrays must have equal lengths")
    sentences = pack.get("story", {}).get("sentences") or []
    read_aloud = next(
        (
            activity
            for activity in pack.get("activities") or []
            if activity.get("type") == "read_aloud"
        ),
        None,
    )
    if not read_aloud or [item.get("text_en") for item in read_aloud["items"]] != [
        sentence.get("text_en") for sentence in sentences
    ]:
        raise BookProcessingError("read aloud must contain every story sentence in order")
    try:
        from jsonschema import Draft7Validator

        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        errors = sorted(
            Draft7Validator(schema).iter_errors(pack), key=lambda error: list(error.path)
        )
    except Exception as exc:
        raise BookProcessingError("schema validation could not run") from exc
    if errors:
        location = "/".join(str(part) for part in errors[0].path) or "(root)"
        raise BookProcessingError(f"pack schema validation failed at {location}")


class ProductionServices:
    def __init__(self) -> None:
        self.backend_root = Path(
            os.getenv("READ2LEAD_BACKEND_ROOT", DEFAULT_REPOS_ROOT / "read2lead_v0_codex")
        )
        sys.path.insert(0, str(self.backend_root))
        sys.path.insert(0, str(self.backend_root / "api"))
        from audio.generate_story_audio_openai import generate_story_audio
        from generate_qa import generate_guided_listening
        from openai import OpenAI
        from r2_uploader import upload_file
        import requests

        self._tts = generate_story_audio
        self._guided = generate_guided_listening
        self._upload = upload_file
        # When OPENROUTER_API_KEY is set, route chat completions through
        # OpenRouter (OpenAI-compatible; response_format JSON mode passes
        # through to OpenAI-family models) — used when the direct OpenAI
        # account has no credit. TTS is unaffected (never called in
        # --enrich-published mode).
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if openrouter_key:
            self._client = OpenAI(
                api_key=openrouter_key, base_url="https://openrouter.ai/api/v1"
            )
            self._chat_model = os.getenv("READ2LEAD_ENRICH_MODEL", "openai/gpt-5-mini")
        else:
            self._client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
            self._chat_model = os.getenv("READ2LEAD_ENRICH_MODEL", "gpt-5-mini")
        self._requests = requests
        self.public_url = os.environ["R2_PUBLIC_URL"].rstrip("/")

    def complete_json(self, system: str, prompt: str) -> dict[str, Any]:
        response = self._client.chat.completions.create(
            model=self._chat_model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": prompt},
            ],
            max_completion_tokens=4096,
            timeout=180.0,
            extra_body={"reasoning_effort": "low"},
        )
        return json.loads((response.choices[0].message.content or "").strip())

    def generate_guided(self, source: BookSource) -> list[dict[str, Any]]:
        story = {
            "paragraphs_en": [page.text for page in source.pages],
            "sentences": list(source.sentences),
        }
        return self._guided(
            story,
            llm_fallback=lambda prompt: self.complete_json(
                "Return only validated listening-question JSON.", prompt
            ),
        )

    def generate_ab(self, source: BookSource) -> list[dict[str, Any]]:
        return validate_ab_activities(build_deterministic_ab(source), source)

    def generate_guided_for_paragraphs(
        self,
        paragraphs: list[str],
        *,
        complete_json: Callable[[str, str], dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        """Same LLM path as generate_guided(), for a raw paragraph list.

        Used by the enrichment batch (--enrich-published), which starts from
        an already-published pack rather than a freshly preflighted
        BookSource. `complete_json` defaults to self.complete_json but can be
        overridden by a caller that wants to count/wrap LLM calls.
        """
        complete = complete_json or self.complete_json
        story = {"paragraphs_en": paragraphs}
        return self._guided(
            story,
            llm_fallback=lambda prompt: complete(
                "Return only validated listening-question JSON.", prompt
            ),
        )

    def tts(self, text: str, output_path: Path) -> None:
        self._tts(text, output_path)

    def upload(self, local_path: Path, key: str, content_type: str) -> str:
        return self._upload(str(local_path), key, content_type)

    def publish_book(self, level: str, pack: dict[str, Any]) -> None:
        publish_url = os.getenv("READ2LEAD_PUBLISH_URL", "").strip()
        if not publish_url:
            self.kv_put(f"book:{pack['book_slug']}", pack)
            current = self.kv_get(f"book_index:{level}")
            index = [str(item) for item in current if item] if isinstance(current, list) else []
            self.kv_put(
                f"book_index:{level}",
                sorted(set([*index, pack["book_slug"]])),
            )
            return
        response = self._requests.post(
            publish_url,
            headers={
                "X-Read2Lead-Secret": os.environ["READ2LEAD_BACKEND_SECRET"],
                "Content-Type": "application/json",
            },
            json={
                "level": level,
                "pack": pack,
                "activate_level": os.getenv("READ2LEAD_ACTIVATE_LEVEL") == level,
            },
            timeout=60,
        )
        response.raise_for_status()

    def kv_get(self, key: str) -> Any:
        response = self._requests.get(
            self._kv_url(key),
            headers={"Authorization": f"Bearer {os.environ['CF_KV_API_TOKEN']}"},
            timeout=30,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    def kv_put(self, key: str, value: Any) -> None:
        response = self._requests.put(
            self._kv_url(key),
            headers={
                "Authorization": f"Bearer {os.environ['CF_KV_API_TOKEN']}",
                "Content-Type": "application/json",
            },
            data=json.dumps(value, ensure_ascii=False).encode("utf-8"),
            timeout=30,
        )
        response.raise_for_status()

    @staticmethod
    def _kv_url(key: str) -> str:
        account = os.environ["CF_ACCOUNT_ID"]
        namespace = os.environ["CF_KV_NAMESPACE_ID"]
        return (
            f"https://api.cloudflare.com/client/v4/accounts/{account}/storage/kv/"
            f"namespaces/{namespace}/values/{quote(key, safe='')}"
        )


def deterministic_asset_urls(
    source: BookSource, public_url: str
) -> tuple[list[str], list[str], list[str]]:
    base = f"{public_url.rstrip('/')}/books/{source.book_slug}"
    return (
        [f"{base}/page_{page.page_num:02d}.jpg" for page in source.pages],
        [f"{base}/page_{page.page_num:02d}.mp3" for page in source.pages],
        [f"{base}/s_{index:03d}.mp3" for index in range(len(source.sentences))],
    )


def publish_pack(
    services: Any,
    *,
    level: str,
    source: BookSource,
    pack: dict[str, Any],
    generated_files: list[tuple[Path, str, str]],
) -> None:
    for local_path, key, content_type in generated_files:
        retry_call(lambda p=local_path, k=key, c=content_type: services.upload(p, k, c))
    if callable(getattr(services, "publish_book", None)):
        retry_call(lambda: services.publish_book(level, pack))
        return
    retry_call(lambda: services.kv_put(f"book:{source.book_slug}", pack))
    current = retry_call(lambda: services.kv_get(f"book_index:{level}"))
    if current is None:
        index: list[str] = []
    elif isinstance(current, list):
        index = [str(item) for item in current if item]
    else:
        raise BookProcessingError("book index is not a JSON array")
    retry_call(
        lambda: services.kv_put(
            f"book_index:{level}", sorted(set([*index, source.book_slug]))
        )
    )


def process_book(source: BookSource, services: Any, *, schema_path: Path) -> dict[str, Any]:
    images, page_audio, sentence_audio = deterministic_asset_urls(
        source, services.public_url
    )
    with tempfile.TemporaryDirectory(prefix=f"{source.book_slug}-") as raw_temp:
        temp_dir = Path(raw_temp)
        generated: list[tuple[Path, str, str]] = []
        print(f"GENERATE guided questions {source.book_slug}")
        guided_listening = services.generate_guided(source)
        print(f"GENERATE A/B activities {source.book_slug}")
        ab_activities = services.generate_ab(source)
        print(f"GENERATE audio {source.book_slug}")
        for page in source.pages:
            output = temp_dir / f"page_{page.page_num:02d}.mp3"
            retry_call(lambda p=page, o=output: services.tts(p.text, o))
            generated.append(
                (
                    output,
                    f"books/{source.book_slug}/page_{page.page_num:02d}.mp3",
                    "audio/mpeg",
                )
            )
        for index, sentence in enumerate(source.sentences):
            output = temp_dir / f"s_{index:03d}.mp3"
            retry_call(lambda s=sentence, o=output: services.tts(s["text_en"], o))
            generated.append(
                (output, f"books/{source.book_slug}/s_{index:03d}.mp3", "audio/mpeg")
            )
        pack = build_pack(
            source,
            book_images=images,
            page_audio=page_audio,
            sentence_audio=sentence_audio,
            guided_listening=guided_listening,
            ab_activities=ab_activities,
        )
        print(f"VALIDATE pack {source.book_slug}")
        validate_pack(pack, schema_path)
        image_files = [
            (
                page.image_path,
                f"books/{source.book_slug}/page_{page.page_num:02d}.jpg",
                "image/jpeg",
            )
            for page in source.pages
        ]
        publish_pack(
            services,
            level=source.level,
            source=source,
            pack=pack,
            generated_files=[*image_files, *generated],
        )
        return pack


# --- Book enrichment (--enrich-published): translations + vocabulary ---------
#
# Adds Vietnamese sentence translations and a root vocabulary list to an
# ALREADY-PUBLISHED book pack, without regenerating TTS audio or images —
# existing sentences/audio_urls are reused verbatim. Loads the pack over HTTP
# from the publish endpoint's machine-secret read side (no direct Cloudflare
# KV credentials needed) and regenerates guided_listening from the pack's own
# paragraphs via the same generate_qa.generate_guided_listening path used at
# build time.

BOOK_ENRICHMENT_SYSTEM_PROMPT = (
    "You translate one page of a children's English story into Vietnamese and "
    "pick hard words for a Vietnamese child learning English. Return JSON only."
)


def build_enrichment_prompt(page_sentences: list[dict[str, Any]], paragraph_text: str) -> str:
    numbered = "\n".join(
        f"[{i}] {sentence['text_en']}" for i, sentence in enumerate(page_sentences)
    )
    return f"""Translate each English sentence below into simple, child-friendly
Vietnamese for a child aged 6-12 who is learning English. Keep translations
faithful to the English meaning and easy for a young child to understand —
short, natural spoken Vietnamese, not a literal word-for-word translation.

PAGE TEXT:
{paragraph_text}

SENTENCES:
{numbered}

Also pick 2 to 4 genuinely hard English words from this page for a Vietnamese
child learning English (skip character and place names). For each, give a
short, simple Vietnamese meaning.

OUTPUT JSON ONLY:
{{
  "sentences": [
    {{"index": 0, "text_vi": "..."}},
    {{"index": 1, "text_vi": "..."}}
  ],
  "hard_words": [
    {{"word_en": "...", "meaning_vi": "..."}}
  ]
}}

RULES:
- Exactly one entry in "sentences" per sentence above; "index" matches the [N] number
- Every text_vi must be non-empty
- hard_words: 0 to 4 entries, never more than 4; skip character/place names
- No markdown, no prose — just the JSON object"""


def validate_enrichment_response(
    response: Any, page_sentence_count: int
) -> tuple[list[str], list[dict[str, str]]]:
    """Validate one page's enrichment JSON. Returns (text_vi_list, hard_words)."""
    if not isinstance(response, dict):
        raise BookProcessingError("enrichment response is not a JSON object")
    sentences = response.get("sentences")
    if not isinstance(sentences, list) or len(sentences) != page_sentence_count:
        got = len(sentences) if isinstance(sentences, list) else "no"
        raise BookProcessingError(
            f"enrichment response has {got} sentences; expected {page_sentence_count}"
        )
    by_index: dict[int, str] = {}
    for entry in sentences:
        if not isinstance(entry, dict):
            raise BookProcessingError("enrichment sentence entry is not an object")
        index = entry.get("index")
        text_vi = clean_text(entry.get("text_vi"))
        if not isinstance(index, int) or not text_vi:
            raise BookProcessingError("enrichment sentence missing index or text_vi")
        by_index[index] = text_vi
    if set(by_index) != set(range(page_sentence_count)):
        raise BookProcessingError("enrichment response sentence indexes do not cover the page")
    text_vi_list = [by_index[i] for i in range(page_sentence_count)]

    hard_words_raw = response.get("hard_words") if response.get("hard_words") is not None else []
    if not isinstance(hard_words_raw, list):
        raise BookProcessingError("enrichment hard_words must be a list")
    # The model sometimes offers more than 4 useful words; keep the first 4
    # rather than rejecting the whole page (batch-observed failure mode).
    hard_words_raw = hard_words_raw[:4]
    hard_words: list[dict[str, str]] = []
    for entry in hard_words_raw:
        if not isinstance(entry, dict):
            raise BookProcessingError("enrichment hard_word entry is not an object")
        word_en = clean_text(entry.get("word_en"))
        meaning_vi = clean_text(entry.get("meaning_vi"))
        if not word_en or not meaning_vi:
            raise BookProcessingError("enrichment hard_word missing word_en or meaning_vi")
        hard_words.append({"word_en": word_en, "meaning_vi": meaning_vi})
    return text_vi_list, hard_words


def build_book_enrichment_prompt(
    pages: list[tuple[int, str, list[dict[str, Any]]]],
) -> str:
    """Whole-book variant of build_enrichment_prompt: every page in ONE call
    (books are ~10 sentences), so the free-tier daily request quota covers the
    full batch. `pages` = [(page_index, paragraph_text, page_sentences)].
    """
    blocks = []
    for page_index, paragraph_text, page_sentences in pages:
        numbered = "\n".join(
            f"[{i}] {sentence['text_en']}" for i, sentence in enumerate(page_sentences)
        )
        blocks.append(f"PAGE {page_index}:\n{paragraph_text}\nSENTENCES:\n{numbered}")
    pages_text = "\n\n".join(blocks)
    return f"""Translate each English sentence below into simple, child-friendly
Vietnamese for a child aged 6-12 who is learning English. Keep translations
faithful to the English meaning and easy for a young child to understand —
short, natural spoken Vietnamese, not a literal word-for-word translation.

{pages_text}

For EACH page also pick 2 to 4 genuinely hard English words for a Vietnamese
child learning English (skip character and place names). For each, give a
short, simple Vietnamese meaning.

OUTPUT JSON ONLY:
{{
  "pages": [
    {{
      "page": 0,
      "sentences": [{{"index": 0, "text_vi": "..."}}],
      "hard_words": [{{"word_en": "...", "meaning_vi": "..."}}]
    }}
  ]
}}

RULES:
- One entry in "pages" per PAGE above; "page" matches the PAGE number
- Exactly one entry in each page's "sentences" per sentence; "index" matches the [N] number within that page
- Every text_vi must be non-empty
- hard_words per page: 0 to 4 entries, never more than 4; skip character/place names
- No markdown, no prose — just the JSON object"""


def enrich_pack(
    pack: dict[str, Any],
    complete_json: Callable[[str, str], dict[str, Any]],
    *,
    whole_book: bool = False,
) -> dict[str, Any]:
    """Return a copy of `pack` with story.sentences[].text_vi and root
    vocabulary filled in. Default: one `complete_json` call per page. With
    `whole_book=True`: a single call for the entire book (free-tier quota
    mode); each page's sub-object is validated with the SAME
    validate_enrichment_response. Does NOT touch
    audio_url/book_images/book_page_audio — those are reused verbatim.
    """
    story = pack.get("story") or {}
    sentences = story.get("sentences") or []
    paragraphs = story.get("paragraphs_en") or []
    sentences_by_page: dict[int, list[tuple[int, dict[str, Any]]]] = {}
    for index, sentence in enumerate(sentences):
        page = int(sentence.get("paragraph_index") or 0)
        sentences_by_page.setdefault(page, []).append((index, sentence))

    updated_sentences = [dict(sentence) for sentence in sentences]
    vocabulary: list[dict[str, Any]] = []

    def apply_page(page_index: int, page_sentences, response: Any) -> None:
        text_vi_list, hard_words = validate_enrichment_response(response, len(page_sentences))
        for (sentence_index, _), text_vi in zip(page_sentences, text_vi_list):
            updated_sentences[sentence_index]["text_vi"] = text_vi
        for hard_word in hard_words:
            vocabulary.append({**hard_word, "paragraph_index": page_index})

    if whole_book:
        pages = [
            (page_index, paragraph_text, [s for _, s in sentences_by_page.get(page_index, [])])
            for page_index, paragraph_text in enumerate(paragraphs)
            if sentences_by_page.get(page_index)
        ]
        if pages:
            response = complete_json(
                BOOK_ENRICHMENT_SYSTEM_PROMPT, build_book_enrichment_prompt(pages)
            )
            page_objects = response.get("pages") if isinstance(response, dict) else None
            if not isinstance(page_objects, list):
                raise BookProcessingError("whole-book enrichment response missing pages list")
            by_page = {
                entry.get("page"): entry
                for entry in page_objects
                if isinstance(entry, dict)
            }
            for page_index, _, _ in pages:
                if page_index not in by_page:
                    raise BookProcessingError(
                        f"whole-book enrichment response missing page {page_index}"
                    )
            for page_index, _, _ in pages:
                apply_page(
                    page_index,
                    sentences_by_page[page_index],
                    by_page[page_index],
                )
    else:
        for page_index, paragraph_text in enumerate(paragraphs):
            page_sentences = sentences_by_page.get(page_index, [])
            if not page_sentences:
                continue
            prompt = build_enrichment_prompt(
                [sentence for _, sentence in page_sentences], paragraph_text
            )
            response = complete_json(BOOK_ENRICHMENT_SYSTEM_PROMPT, prompt)
            apply_page(page_index, page_sentences, response)

    enriched = dict(pack)
    enriched["story"] = {**story, "sentences": updated_sentences}
    enriched["vocabulary"] = vocabulary
    return enriched


def complete_json_gemini(system: str, prompt: str) -> dict[str, Any]:
    """JSON-mode chat call against the Gemini API free tier (GOOGLE_API_KEY).
    Retries on 429/5xx with backoff — free-tier RPM limits are expected.
    Model overridable via READ2LEAD_GEMINI_MODEL.
    """
    import requests as _requests

    # gemini-2.0-flash was retired upstream (404 "no longer available");
    # 2.5-flash is the current free-tier workhorse. Key goes in the
    # x-goog-api-key HEADER, never the URL, so HTTP errors can't leak it.
    model = os.getenv("READ2LEAD_GEMINI_MODEL", "gemini-2.5-flash")
    key = os.environ["GOOGLE_API_KEY"]
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{model}:generateContent"
    )
    body = {
        "system_instruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "response_mime_type": "application/json",
            "temperature": 0.2,
        },
    }
    headers = {"x-goog-api-key": key, "Content-Type": "application/json"}
    last_error = "unknown"
    for attempt in range(5):
        try:
            response = _requests.post(url, json=body, headers=headers, timeout=180)
            if response.status_code in (429, 500, 502, 503):
                last_error = f"gemini HTTP {response.status_code}"
                time.sleep(8 * (attempt + 1))
                continue
            if response.status_code != 200:
                # Never re-raise requests' HTTPError — its message embeds the
                # full request URL. Ours carries status + API error text only.
                api_message = ""
                try:
                    api_message = str(response.json().get("error", {}).get("message", ""))[:200]
                except Exception:
                    pass
                raise BookProcessingError(
                    f"gemini HTTP {response.status_code}: {api_message}"
                )
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text.strip())
        except (KeyError, IndexError, ValueError) as exc:
            last_error = f"{type(exc).__name__}: {exc}"
            time.sleep(4 * (attempt + 1))
    raise BookProcessingError(f"gemini enrichment call failed: {last_error}")


def _read2lead_publish_get(params: dict[str, str]) -> dict[str, Any]:
    """GET the publish endpoint's machine-secret read side (plain urllib, no
    `requests` dependency). Same base URL + secret as the existing publish
    POST flow: READ2LEAD_PUBLISH_URL + READ2LEAD_BACKEND_SECRET.
    """
    base_url = os.environ["READ2LEAD_PUBLISH_URL"].rstrip("/")
    secret = os.environ["READ2LEAD_BACKEND_SECRET"]
    query = urlencode(params)
    request = Request(
        f"{base_url}?{query}",
        headers={
            "X-Read2Lead-Secret": secret,
            # Cloudflare bot protection 403s urllib's default Python UA;
            # identify honestly as the ops batch instead.
            "User-Agent": "read2lead-enrich-batch/1.0",
        },
    )
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        raise BookProcessingError(f"published book fetch failed: HTTP {exc.code}") from exc
    except URLError as exc:
        raise BookProcessingError(f"published book fetch failed: {exc.reason}") from exc


def fetch_published_index(level: str) -> list[str]:
    data = _read2lead_publish_get({"index": level})
    if not data.get("ok"):
        raise BookProcessingError(
            f"published index fetch failed for {level}: {data.get('error', 'unknown')}"
        )
    return [str(slug) for slug in data.get("slugs") or []]


def fetch_published_pack(slug: str) -> dict[str, Any]:
    data = _read2lead_publish_get({"slug": slug})
    if not data.get("ok"):
        raise BookProcessingError(
            f"published pack fetch failed for {slug}: {data.get('error', 'unknown')}"
        )
    pack = data.get("pack")
    if not isinstance(pack, dict):
        raise BookProcessingError(f"published pack fetch returned no pack for {slug}")
    return pack


def discover_published_slugs(
    *, only_slug: str | None = None, limit: int | None = None
) -> list[str]:
    if only_slug:
        return [only_slug]
    slugs: list[str] = []
    seen: set[str] = set()
    for level in ENRICH_LEVELS:
        for slug in fetch_published_index(level):
            if slug not in seen:
                seen.add(slug)
                slugs.append(slug)
    if limit is not None:
        slugs = slugs[:limit]
    return slugs


def enrich_and_publish_book(
    slug: str,
    services: Any,
    *,
    schema_path: Path,
    out_dir: Path,
    publish: bool,
) -> dict[str, Any]:
    """Enrich one already-published pack and write it locally (one JSON per
    slug); optionally publish it back. Returns {"slug", "llm_calls"} so the
    caller can print a per-book cost-relevant stat.
    """
    pack = fetch_published_pack(slug)
    llm_calls = 0

    def counted_complete_json(system: str, prompt: str) -> dict[str, Any]:
        nonlocal llm_calls
        llm_calls += 1
        return services.complete_json(system, prompt)

    # Hybrid cost plan (founder-approved 2026-07-12): translations + vocabulary
    # ride the Gemini FREE tier in one whole-book call when GOOGLE_API_KEY is
    # set; question regeneration below stays on services.complete_json (the
    # proven generator path, OpenRouter/OpenAI).
    use_gemini = bool(os.getenv("GOOGLE_API_KEY", "").strip())

    def counted_gemini(system: str, prompt: str) -> dict[str, Any]:
        nonlocal llm_calls
        llm_calls += 1
        return complete_json_gemini(system, prompt)

    enriched = enrich_pack(
        pack,
        counted_gemini if use_gemini else counted_complete_json,
        whole_book=use_gemini,
    )
    print(f"GENERATE guided questions (enrich) {slug}")
    enriched["guided_listening"] = services.generate_guided_for_paragraphs(
        enriched["story"]["paragraphs_en"], complete_json=counted_complete_json
    )

    print(f"VALIDATE enriched pack {slug}")
    validate_pack(enriched, schema_path)

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{slug}.json").write_text(
        json.dumps(enriched, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"ENRICH {slug}: {llm_calls} LLM call(s)")

    if publish:
        level = str(enriched.get("level") or "")
        if level not in ENRICH_LEVELS:
            raise BookProcessingError(f"enriched pack {slug} has invalid level {level!r}")
        retry_call(lambda: services.publish_book(level, enriched))
        print(f"PUBLISHED {slug}")

    return {"slug": slug, "llm_calls": llm_calls}


def required_enrich_env_missing() -> list[str]:
    required = ["OPENAI_API_KEY", "R2_PUBLIC_URL", "READ2LEAD_PUBLISH_URL", "READ2LEAD_BACKEND_SECRET"]
    return [name for name in required if not os.getenv(name)]


def main_enrich(args: argparse.Namespace) -> int:
    missing = required_enrich_env_missing()
    if missing:
        print(
            f"Missing required environment variables: {', '.join(missing)}",
            file=sys.stderr,
        )
        return 2
    try:
        slugs = discover_published_slugs(only_slug=args.slug, limit=args.limit)
    except BookProcessingError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    if not slugs:
        print("No published books found to enrich.", file=sys.stderr)
        return 2

    services = ProductionServices()
    schema_path = services.backend_root / "schemas" / "pack.schema.v2.json"
    out_dir = args.out_dir or (Path(__file__).resolve().parent / "enriched_books")

    failures = 0
    total_calls = 0
    for slug in slugs:
        try:
            result = enrich_and_publish_book(
                slug, services, schema_path=schema_path, out_dir=out_dir, publish=args.publish
            )
            total_calls += result["llm_calls"]
        except BookProcessingError as exc:
            failures += 1
            print(f"ERROR {slug}: {exc}", file=sys.stderr)
        except Exception as exc:
            failures += 1
            print(f"ERROR {slug}: {type(exc).__name__}: {exc}", file=sys.stderr)

    print(
        f"ENRICH TOTAL: {len(slugs) - failures}/{len(slugs)} book(s) enriched, "
        f"{total_calls} LLM call(s)"
    )
    return 1 if failures else 0


def checkpoint_path(level_number: str) -> Path:
    return Path(__file__).resolve().parent / f".book_checkpoint_{level_number}.txt"


def error_path(level_number: str) -> Path:
    return Path(__file__).resolve().parent / f".book_errors_{level_number}.txt"


def read_checkpoint(level_number: str) -> set[str]:
    path = checkpoint_path(level_number)
    if not path.exists():
        return set()
    return {
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    }


def append_line(path: Path, line: str) -> None:
    existing = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    if line in existing:
        return
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text("\n".join([*existing, line]) + "\n", encoding="utf-8")
    temp.replace(path)


def discover_books(level_number: str, book_filter: str | None = None) -> list[Path]:
    env_name = f"STORYWEAVER_LEVEL{level_number}_DIR"
    root = Path(
        os.getenv(env_name, DEFAULT_REPOS_ROOT / f"storyweaver_level{level_number}")
    )
    if not root.is_dir():
        raise BookProcessingError(f"book directory not found for level {level_number}")
    books = sorted(path for path in root.iterdir() if path.is_dir())
    if book_filter:
        needle = book_filter.strip().lower()
        books = [
            path
            for path in books
            if path.name.lower() == needle
            or path.name.lower().startswith(f"{needle}-")
        ]
    return books


def required_execution_env_missing() -> list[str]:
    required = [
        "OPENAI_API_KEY",
        "R2_ENDPOINT",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_NAME",
        "R2_PUBLIC_URL",
    ]
    if os.getenv("READ2LEAD_PUBLISH_URL"):
        required.append("READ2LEAD_BACKEND_SECRET")
    else:
        required.extend(["CF_ACCOUNT_ID", "CF_KV_NAMESPACE_ID", "CF_KV_API_TOKEN"])
    return [name for name in required if not os.getenv(name)]


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build validated StoryWeaver Read2Lead packs"
    )
    parser.add_argument("--level", choices=sorted(LEVEL_MAP), help="Required unless --enrich-published")
    parser.add_argument("--book", help="Only process a StoryWeaver ID or directory slug")
    parser.add_argument("--max", type=int, dest="max_books", help="Maximum books")
    parser.add_argument("--resume", action="store_true", help="Skip checkpointed books")
    parser.add_argument(
        "--dry-run", action="store_true", help="Parse/preflight only; no external calls"
    )
    parser.add_argument(
        "--enrich-published",
        action="store_true",
        help=(
            "Enrich already-published packs with Vietnamese sentence "
            "translations + vocabulary and regenerate guided_listening, "
            "reusing existing TTS audio/images verbatim (no re-generation)"
        ),
    )
    parser.add_argument(
        "--slug", help="With --enrich-published: only this one book_slug (single-book dry run)"
    )
    parser.add_argument(
        "--limit", type=int, help="With --enrich-published: maximum books to enrich"
    )
    parser.add_argument(
        "--publish",
        action="store_true",
        help="With --enrich-published: POST enriched packs back to the publish endpoint",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        help="With --enrich-published: local directory for enriched pack JSON "
        "(default: scripts/enriched_books)",
    )
    args = parser.parse_args(argv)
    if args.max_books is not None and args.max_books < 1:
        parser.error("--max must be at least 1")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be at least 1")
    if not args.enrich_published and not args.level:
        parser.error("--level is required unless --enrich-published is set")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.enrich_published:
        return main_enrich(args)
    try:
        books = discover_books(args.level, args.book)
    except BookProcessingError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2
    if args.max_books:
        books = books[: args.max_books]
    if not books:
        print("No matching books found.", file=sys.stderr)
        return 2

    completed = read_checkpoint(args.level) if args.resume else set()
    sources: list[BookSource] = []
    for directory in books:
        if directory.name in completed:
            print(f"SKIP checkpoint: {directory.name}")
            continue
        try:
            source = preflight_book(directory, args.level)
            sources.append(source)
            print(
                f"PREFLIGHT OK {source.book_slug}: "
                f"{len(source.pages)} pages, {len(source.sentences)} sentences"
            )
        except Exception as exc:
            append_line(error_path(args.level), f"{directory.name}\t{type(exc).__name__}")
            print(f"SKIP {directory.name}: {type(exc).__name__}", file=sys.stderr)

    if args.dry_run:
        print(f"DRY RUN: {len(sources)} book(s) ready; no external calls or writes.")
        return 0 if sources else 1
    missing = required_execution_env_missing()
    if missing:
        print(
            f"Missing required environment variables: {', '.join(missing)}",
            file=sys.stderr,
        )
        return 2

    services = ProductionServices()
    schema_path = services.backend_root / "schemas" / "pack.schema.v2.json"
    failures = 0
    for source in sources:
        try:
            process_book(source, services, schema_path=schema_path)
            append_line(checkpoint_path(args.level), source.directory.name)
            print(f"DONE {source.book_slug}")
        except BookProcessingError as exc:
            failures += 1
            append_line(error_path(args.level), f"{source.directory.name}\t{type(exc).__name__}")
            print(f"ERROR {source.book_slug}: {exc}", file=sys.stderr)
        except Exception as exc:
            failures += 1
            append_line(error_path(args.level), f"{source.directory.name}\t{type(exc).__name__}")
            print(f"ERROR {source.book_slug}: {type(exc).__name__}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
