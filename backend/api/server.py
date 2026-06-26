"""Read2Lead V2 API server. Endpoint POST /generate-async-v2."""
import os
import json
import re
import shutil
import sys
import tempfile
import threading
import time
import uuid
import uuid as uuid_module
from hmac import compare_digest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
API_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(API_DIR))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))


def _validate_env():
    """Fail fast at startup if any required env var is missing."""
    required = [
        "ANTHROPIC_API_KEY",
        "READ2LEAD_BACKEND_SECRET",
        "R2_ENDPOINT",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_NAME",
        "R2_PUBLIC_URL",
    ]
    missing = [k for k in required if not os.environ.get(k)]
    if not (os.environ.get("READ2LEAD_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")):
        missing.append("READ2LEAD_OPENAI_API_KEY or OPENAI_API_KEY")
    if missing:
        raise SystemExit(f"FATAL: Missing required env vars: {', '.join(missing)}")


_validate_env()

from flask import Flask, jsonify, request
from generator_v2 import generate_pack_v2
from prompt_v2 import challenge_dial_band, inlevel_ramp_stage
from validator_v2 import LEVEL_RULES_V2, validate_pack_v2, _normalize_for_match

# Must match pack.schema.v2.json listen_and_order scrambled_tokens maxItems.
ACTIVITY_B_SCHEMA_MAX_TOKENS = 16
ACTIVITY_B_MIN_TOKENS = 3

# Audio pipeline - added in W4.1 (was accidentally deleted in W4 V1 cleanup).
_AUDIO_DIR = Path(__file__).resolve().parent.parent / "audio"
if str(_AUDIO_DIR) not in sys.path:
    sys.path.insert(0, str(_AUDIO_DIR))
from generate_story_audio_openai import (
    ALLOWED_TTS_VOICES,
    DEFAULT_INSTRUCTIONS as TTS_INSTRUCTIONS,
    DEFAULT_MODEL,
    DEFAULT_VOICE,
    build_speech_create_kwargs,
    open_speech_stream,
    generate_story_audio,
    resolve_tts_model,
    resolve_tts_voice,
)
from r2_uploader import upload_file

TTS_MODEL = resolve_tts_model()
TTS_VOICE = resolve_tts_voice()
print(f"[tts-config] model={TTS_MODEL} voice={TTS_VOICE}")


# Unicode-letter + space + hyphen + apostrophe. Accepts Vietnamese diacritics (Phương, Tú, Quỳnh).
_VALID_NAME_RE = re.compile(r"^[^\W\d_]+(?:[\s\-'][^\W\d_]+)*$", re.UNICODE)


app = Flask(__name__)
MAX_REVIEW_UPLOAD_BYTES = 45 * 1024 * 1024
BACKEND_SECRET_HEADER = "X-Read2Lead-Secret"

# Task state được publish lên Cloudflare KV qua proxy endpoint /api/task-state.
# Persistent qua Render restart, không còn in-memory dict.
TTS_SPEED_BY_LEVEL = {
    "L1": 0.85,
    "L2": 0.95,
    "L3": 1.0,
    "L4": 1.0,
    "L5": 1.0,
}

def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(minimum, int(raw))
    except ValueError:
        print(f"[config] Invalid {name}={raw!r}; using default={default}")
        return default


# Hobby-tier guardrails: cap concurrent pack jobs + shared TTS pool (env overridable).
MAX_CONCURRENT_GENERATIONS = _env_int("MAX_CONCURRENT_GENERATIONS", 2)
MAX_QUEUED_GENERATIONS = _env_int("MAX_QUEUED_GENERATIONS", 4)
_AUDIO_MAX_WORKERS = _env_int("AUDIO_EXECUTOR_WORKERS", 5)
_GENERATION_MAX_WORKERS = _env_int(
    "GENERATION_EXECUTOR_WORKERS", MAX_CONCURRENT_GENERATIONS
)

_AUDIO_EXECUTOR = ThreadPoolExecutor(max_workers=_AUDIO_MAX_WORKERS)
_GENERATION_EXECUTOR = ThreadPoolExecutor(max_workers=_GENERATION_MAX_WORKERS)
_AUDIO_JOB_TIMEOUT_S = 90
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_CF_PROXY_URL = os.environ.get("CF_PROXY_URL", "https://felixbuilderhub.com").rstrip("/")

# Queue counters cho UX "Bạn là người thứ X". Bảo vệ bằng lock.
_QUEUE_COUNTERS_LOCK = threading.Lock()
_active_generations = 0
_queued_generations = 0


def _publish_task_state(task_id: str, state: dict) -> None:
    """POST task state to Cloudflare KV proxy. Retry once on network failure."""
    import time
    import urllib.error
    import urllib.request

    secret = os.environ.get("READ2LEAD_BACKEND_SECRET", "")
    if not secret:
        print(f"[task {task_id}] _publish_task_state: missing READ2LEAD_BACKEND_SECRET")
        return

    payload = {"task_id": task_id, **state}
    body = json.dumps(payload).encode("utf-8")
    url = f"{_CF_PROXY_URL}/api/task-state"
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Read2Lead-Backend/1.0 (Render)",
            "Accept": "application/json",
            BACKEND_SECRET_HEADER: secret,
        },
    )
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                if 200 <= res.status < 300:
                    return
                body_preview = res.read().decode("utf-8", errors="ignore")[:200]
                print(f"[task {task_id}] _publish_task_state non-2xx: {res.status} body={body_preview}")
                return
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8", errors="ignore")[:200]
            except Exception:
                pass
            print(f"[task {task_id}] _publish_task_state HTTPError {e.code} body={err_body!r}")
            return
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"[task {task_id}] _publish_task_state attempt {attempt + 1} failed: {e}")
            if attempt == 0:
                time.sleep(1)
    print(f"[task {task_id}] _publish_task_state: gave up after 2 attempts")


def require_backend_secret():
    expected = os.environ.get("READ2LEAD_BACKEND_SECRET")
    if not expected:
        return jsonify({"ok": False, "error": "Backend auth not configured"}), 500

    provided = request.headers.get(BACKEND_SECRET_HEADER, "")
    if not compare_digest(provided, expected):
        return jsonify({"ok": False, "error": "Unauthorized"}), 401

    return None


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True}), 200


@app.route("/health-v2", methods=["GET"])
def health_v2():
    """V2 health check. Returns ok + V2 version marker so monitoring
    distinguishes V1 vs V2 deploy."""
    payload = {"ok": True, "version": "v2.0.0-w1", "tts_model": TTS_MODEL, "tts_voice": TTS_VOICE}
    deploy_commit = (os.environ.get("RENDER_GIT_COMMIT") or "").strip()
    if deploy_commit:
        payload["deploy_commit"] = deploy_commit[:7]
    return jsonify(payload)


@app.route("/generate-async-v2", methods=["POST"])
def generate_async_v2():
    """Queue a V2 pack generation task and publish state to Cloudflare KV."""
    auth_error = require_backend_secret()
    if auth_error:
        return auth_error

    data = request.get_json(force=True, silent=True) or {}

    child_name = (data.get("child_name") or "").strip()
    age = data.get("age")
    level = (data.get("level") or "").strip().upper()
    gender = (data.get("child_gender") or "").strip().lower()
    interests = (data.get("interests") or "").strip()[:120]
    topic = (data.get("topic") or "").strip()[:60]
    rank_points_raw = data.get("rank_points")
    rank_points = None
    if rank_points_raw is not None:
        try:
            rank_points = max(0, int(rank_points_raw))
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Invalid rank_points"}), 400
    level_progress_percent_raw = data.get("level_progress_percent")
    level_progress_percent = None
    if level_progress_percent_raw is not None:
        try:
            candidate = int(level_progress_percent_raw)
            if 0 <= candidate <= 100:
                level_progress_percent = candidate
        except (TypeError, ValueError):
            pass

    if not child_name or len(child_name) > 50 or not _VALID_NAME_RE.match(child_name):
        return jsonify({"ok": False, "error": "Invalid child_name"}), 400
    try:
        age = int(age)
        if age < 5 or age > 14:
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify({"ok": False, "error": "Invalid age (5-14)"}), 400
    if level not in ("L1", "L2", "L3", "L4", "L5"):
        return jsonify({"ok": False, "error": "Invalid level (L1-L5)"}), 400
    if gender not in ("boy", "girl"):
        return jsonify({"ok": False, "error": "Invalid child_gender (boy/girl)"}), 400

    capacity_error = _check_generation_capacity()
    if capacity_error:
        return capacity_error

    task_id = str(uuid.uuid4())
    active, queued = _mark_generation_queued()
    queue_position = active + queued
    _publish_task_state(task_id, {
        "status": "pending",
        "queue_position": queue_position,
        "started_at": None,
    })
    _GENERATION_EXECUTOR.submit(
        _run_generation_task_v2,
        task_id,
        child_name,
        age,
        level,
        gender,
        interests,
        topic,
        rank_points,
        level_progress_percent,
    )

    return jsonify({
        "ok": True,
        "task_id": task_id,
        "status": "pending",
        "queue_position": queue_position,
    }), 202


def _generate_one_audio_mp3(text: str, tmp_dir: Path, prefix: str, idx_or_kind: str, speed: float) -> tuple[str, str | None]:
    """Generate one MP3 from text + upload to R2."""
    try:
        mp3_path = tmp_dir / f"{prefix}_{idx_or_kind}.mp3"
        generate_story_audio(text.strip(), mp3_path, model=TTS_MODEL, voice=TTS_VOICE, speed=speed)
        r2_url = upload_file(str(mp3_path), f"packs/{prefix}_{idx_or_kind}.mp3", "audio/mpeg")
        return text, r2_url
    except Exception as e:
        print(f"[v2-audio] Failed for {idx_or_kind} text='{text[:40]}': {e}")
        return text, None


def _topic_display(topic: str) -> str:
    clean = (topic or "").strip()
    if not clean:
        return "Read2Lead story"
    return clean.replace("_", " ").strip().title()


def _slugify(value: str, fallback: str = "v2pack") -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", (value or "").lower()).strip("_")
    return slug[:80] or fallback


def _pascal_filename(slug: str) -> str:
    parts = [part for part in re.split(r"[_\s]+", slug or "") if part]
    stem = "_".join(part[:1].upper() + part[1:] for part in parts) or "Read2Lead_Pack"
    return f"{stem}.mp3"


def _story_canonical_sentence_texts(pack: dict) -> list[str]:
    story = pack.get("story") or {}
    texts: list[str] = []
    for sentence in story.get("sentences") or []:
        if isinstance(sentence, dict):
            text = (sentence.get("text_en") or "").strip()
            if text:
                texts.append(text)
    if texts:
        return texts
    for paragraph in story.get("paragraphs_en") or []:
        texts.extend(_split_paragraph_sentences(str(paragraph)))
    return texts


def _pick_activity_b_replacement_sentence(
    canonical_sentences: list[str],
    used_keys: set[str],
    *,
    max_tokens: int = ACTIVITY_B_SCHEMA_MAX_TOKENS,
) -> str | None:
    """Pick an unused story sentence that fits Activity B token limits."""
    candidates: list[tuple[int, str]] = []
    for sentence in canonical_sentences:
        key = _normalize_sentence_key(sentence)
        if not key or key in used_keys:
            continue
        token_count = len(sentence.split())
        if ACTIVITY_B_MIN_TOKENS <= token_count <= max_tokens:
            candidates.append((token_count, sentence))
    if not candidates:
        return None
    target = min(max_tokens, 8)
    candidates.sort(key=lambda pair: (abs(pair[0] - target), pair[0]))
    return candidates[0][1]


def _repair_activity_b_tokens(pack: dict) -> dict:
    """Re-derive scrambled_tokens and correct_order_indices from original_sentence.

    LLMs with reasoning_effort=low frequently drop words when building
    scrambled_tokens (e.g. "The takes a little water" instead of "The boat
    takes on a little water"). Since scrambling is a deterministic whitespace-
    split + shuffle, the server can always fix it.

    LLMs also pick sentences longer than schema maxItems (16 tokens) or glue
    two story sentences together. Swap those for shorter unused story sentences
    before scrambling so jsonschema validation passes.

    Runs BEFORE validation so the validator sees correct data.
    """
    import random

    canonical_sentences = _story_canonical_sentence_texts(pack)
    used_sentence_keys: set[str] = set()

    for activity in pack.get("activities") or []:
        if not isinstance(activity, dict) or activity.get("type") != "listen_and_order":
            continue
        for item in activity.get("items") or []:
            if not isinstance(item, dict):
                continue
            original = (item.get("original_sentence") or "").strip()
            if not original:
                continue

            token_count = len(original.split())
            if token_count > ACTIVITY_B_SCHEMA_MAX_TOKENS:
                replacement = _pick_activity_b_replacement_sentence(
                    canonical_sentences,
                    used_sentence_keys,
                )
                if replacement:
                    print(
                        "[v2-generate] Activity B sentence swapped "
                        f"({token_count} tokens -> {len(replacement.split())} tokens)"
                    )
                    original = replacement
                    item["original_sentence"] = replacement
                    if not (item.get("translation_vi") or "").strip():
                        item["translation_vi"] = "Nghe va sap xep lai cau trong truyen."
                else:
                    print(
                        "[v2-generate] Activity B sentence overlong "
                        f"({token_count} tokens) but no replacement in story pool "
                        f"(pool={len(canonical_sentences)} used={len(used_sentence_keys)})"
                    )

            sentence_key = _normalize_sentence_key(original)
            if sentence_key:
                used_sentence_keys.add(sentence_key)

            correct_tokens = original.split()
            if len(correct_tokens) < ACTIVITY_B_MIN_TOKENS:
                continue
            indices = list(range(len(correct_tokens)))
            shuffled_indices = indices[:]
            for _safety in range(20):
                random.shuffle(shuffled_indices)
                if shuffled_indices != indices:
                    break
            scrambled = [correct_tokens[i] for i in shuffled_indices]
            inverse = [0] * len(shuffled_indices)
            for pos, orig_idx in enumerate(shuffled_indices):
                inverse[orig_idx] = pos
            item["scrambled_tokens"] = scrambled
            item["correct_order_indices"] = inverse
    return pack


def _rotate_v2_mcq_answers(pack: dict) -> dict:
    """Deterministically redistribute correct_index across 0/1/2.

    LLMs almost always put the correct answer at index 0. This helper
    moves it to a position derived from a stable hash so the web lesson
    receives varied answer positions without relying on prompt compliance.

    Activity A (listening_fill_blank): rotates options_en + correct_index.
    Activity C (reading_comprehension): rotates options_en, options_vi
    (keeping pairs aligned) + correct_index.
    """
    import hashlib

    slug = pack.get("slug") or ""
    for activity in pack.get("activities") or []:
        if not isinstance(activity, dict):
            continue
        atype = activity.get("type")

        if atype == "listening_fill_blank":
            for idx, item in enumerate(activity.get("items") or []):
                if not isinstance(item, dict):
                    continue
                options = item.get("options_en")
                ci = item.get("correct_index")
                if not isinstance(options, list) or len(options) != 3:
                    continue
                if not isinstance(ci, int) or ci not in (0, 1, 2):
                    continue
                seed = f"{slug}:lfb:{item.get('id', idx)}:{idx}"
                target = int(hashlib.md5(seed.encode()).hexdigest(), 16) % 3
                if target == ci:
                    continue
                correct_text = options[ci]
                options[ci] = options[target]
                options[target] = correct_text
                item["correct_index"] = target

        elif atype == "reading_comprehension":
            for idx, question in enumerate(activity.get("questions") or []):
                if not isinstance(question, dict):
                    continue
                opts_en = question.get("options_en")
                opts_vi = question.get("options_vi")
                ci = question.get("correct_index")
                if not isinstance(opts_en, list) or len(opts_en) != 3:
                    continue
                if not isinstance(ci, int) or ci not in (0, 1, 2):
                    continue
                seed = f"{slug}:rc:{question.get('id', idx)}:{idx}"
                target = int(hashlib.md5(seed.encode()).hexdigest(), 16) % 3
                if target == ci:
                    continue
                opts_en[ci], opts_en[target] = opts_en[target], opts_en[ci]
                if isinstance(opts_vi, list) and len(opts_vi) == 3:
                    opts_vi[ci], opts_vi[target] = opts_vi[target], opts_vi[ci]
                question["correct_index"] = target

    return pack


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


def _normalize_sentence_key(text: str) -> str:
    """Stable key for exact story-sentence matching (ignores trailing punctuation)."""
    norm = _normalize_for_match(text)
    if norm and norm[-1] in ".!?":
        norm = norm[:-1].rstrip()
    return norm


def _best_story_sentence_match(candidate: str, canonical_texts: list[str]) -> str | None:
    """Match candidate to a canonical sentence — exact first, then word-overlap fallback."""
    key = _normalize_sentence_key(candidate)
    if not key or len(key) < 8:
        return None
    for sent in canonical_texts:
        if _normalize_sentence_key(sent) == key:
            return sent
    candidate_words = set(key.split())
    if len(candidate_words) < 3:
        return None
    best_sent: str | None = None
    best_overlap = 0.0
    for sent in canonical_texts:
        sent_words = set(_normalize_sentence_key(sent).split())
        if not sent_words:
            continue
        intersection = candidate_words & sent_words
        union = candidate_words | sent_words
        jaccard = len(intersection) / len(union)
        if jaccard > best_overlap:
            best_overlap = jaccard
            best_sent = sent
    if best_overlap >= 0.6:
        return best_sent
    return None


def _canonical_sentence_map(canonical_texts: list[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for sent in canonical_texts:
        key = _normalize_sentence_key(sent)
        if key and key not in mapping:
            mapping[key] = sent
    return mapping


def _sentence_ref_is_canonical(ref: str, canonical_by_key: dict[str, str]) -> bool:
    if not isinstance(ref, str) or len(ref.strip()) < 8:
        return False
    return _normalize_sentence_key(ref) in canonical_by_key


def _pick_unused_canonical_sentence(
    canonical_texts: list[str],
    used_keys: set[str],
    *,
    min_tokens: int = ACTIVITY_B_MIN_TOKENS,
    max_tokens: int = ACTIVITY_B_SCHEMA_MAX_TOKENS,
) -> str | None:
    """Pick an unused story sentence, preferring mid-length lines for listen_and_order."""
    candidates: list[tuple[int, str]] = []
    for sent in canonical_texts:
        key = _normalize_sentence_key(sent)
        if not key or key in used_keys:
            continue
        token_count = len(sent.split())
        if token_count < min_tokens or token_count > max_tokens:
            continue
        candidates.append((token_count, sent))
    if not candidates:
        return None
    target = min(max_tokens, 8)
    candidates.sort(key=lambda pair: (abs(pair[0] - target), pair[0]))
    chosen = candidates[0][1]
    used_keys.add(_normalize_sentence_key(chosen))
    return chosen


def _repair_activity_sentence_assignments(pack: dict) -> dict:
    """Assign canonical story sentences when doing so preserves item semantics.

    Runs after story.sentences is rebuilt from paragraphs_en. Fixes the class of failures
    that caused L3 packs to burn all 3 attempts (verbatim drift, B duplicates, Sonnet placeholders).
    Activity A is intentionally left for validation retry because its Vietnamese translation
    cannot be safely regenerated when source_sentence changes.
    """
    canonical_texts = _story_canonical_sentence_texts(pack)
    if not canonical_texts:
        return pack

    canonical_by_key = _canonical_sentence_map(canonical_texts)
    repairs = 0

    for activity in pack.get("activities") or []:
        if not isinstance(activity, dict):
            continue
        activity_type = activity.get("type")

        if activity_type == "listen_and_order":
            used_keys: set[str] = set()
            for item in activity.get("items") or []:
                if not isinstance(item, dict):
                    continue
                original = (item.get("original_sentence") or "").strip()
                key = _normalize_sentence_key(original)
                needs_new = (
                    not _sentence_ref_is_canonical(original, canonical_by_key)
                    or key in used_keys
                    or len(original.split()) > ACTIVITY_B_SCHEMA_MAX_TOKENS
                )
                if needs_new:
                    replacement = _pick_unused_canonical_sentence(
                        canonical_texts,
                        used_keys,
                        max_tokens=ACTIVITY_B_SCHEMA_MAX_TOKENS,
                    )
                    if replacement:
                        item["original_sentence"] = replacement
                        if not (item.get("translation_vi") or "").strip():
                            item["translation_vi"] = "Nghe va sap xep lai cau trong truyen."
                        repairs += 1
                        key = _normalize_sentence_key(replacement)
                if key:
                    used_keys.add(key)

        elif activity_type == "listen_and_speak":
            used_keys = set()
            for item in activity.get("items") or []:
                if not isinstance(item, dict):
                    continue
                text_en = (item.get("text_en") or "").strip()
                key = _normalize_sentence_key(text_en)
                needs_new = (
                    not _sentence_ref_is_canonical(text_en, canonical_by_key)
                    or key in used_keys
                )
                if needs_new:
                    replacement = _pick_unused_canonical_sentence(
                        canonical_texts,
                        used_keys,
                        max_tokens=999,
                    )
                    if replacement:
                        item["text_en"] = replacement
                        if not (item.get("text_vi") or "").strip():
                            item["text_vi"] = "Noi lai cau trong truyen."
                        if not (item.get("tip_vi") or "").strip():
                            item["tip_vi"] = "Noi cham va ro tung tu."
                        repairs += 1
                        key = _normalize_sentence_key(replacement)
                if key:
                    used_keys.add(key)

        elif activity_type == "listening_fill_blank":
            for item in activity.get("items") or []:
                if not isinstance(item, dict):
                    continue
                source = (item.get("source_sentence") or "").strip()
                if not _sentence_ref_is_canonical(source, canonical_by_key):
                    matched = _best_story_sentence_match(source, canonical_texts)
                    if matched:
                        item["source_sentence"] = matched
                        item["explanation_vi"] = "Dap an nam trong cau chuyen."
                        repairs += 1

    if repairs:
        print(
            f"[v2-generate] Activity sentence assignment repair "
            f"count={repairs} pool={len(canonical_texts)}"
        )
    return pack


def _repair_story_sentences(pack: dict) -> dict:
    """Rebuild story.sentences from paragraphs_en and snap activity refs to canonical text.

    LLMs often drift on sentence tokenization (punctuation/spacing), which triggers
    verbatim validation failures. Re-splitting on the server is deterministic.
    """
    story = pack.get("story") or {}
    paragraphs = story.get("paragraphs_en") or []
    if not paragraphs:
        return pack

    rebuilt: list[dict] = []
    canonical_texts: list[str] = []
    for paragraph_index, paragraph in enumerate(paragraphs):
        for sentence_text in _split_paragraph_sentences(paragraph):
            rebuilt.append({"text_en": sentence_text, "paragraph_index": paragraph_index})
            canonical_texts.append(sentence_text)

    if not rebuilt:
        return pack

    story["sentences"] = rebuilt

    def snap(value: str) -> str:
        if not isinstance(value, str) or not value.strip():
            return value
        matched = _best_story_sentence_match(value, canonical_texts)
        return matched if matched else value

    for activity in pack.get("activities") or []:
        if not isinstance(activity, dict):
            continue
        activity_type = activity.get("type")
        if activity_type == "listening_fill_blank":
            for item in activity.get("items") or []:
                if isinstance(item, dict) and item.get("source_sentence"):
                    item["source_sentence"] = snap(item["source_sentence"])
        elif activity_type == "listen_and_order":
            for item in activity.get("items") or []:
                if isinstance(item, dict) and item.get("original_sentence"):
                    item["original_sentence"] = snap(item["original_sentence"])
        elif activity_type == "listen_and_speak":
            for item in activity.get("items") or []:
                if isinstance(item, dict) and item.get("text_en"):
                    item["text_en"] = snap(item["text_en"])
    return pack


_ACTIVITY_DEFAULT_INSTRUCTIONS = {
    "listening_fill_blank": "Nghe cau trong truyen, roi chon dung cum con thieu.",
    "listen_and_order": "Nghe cau roi bam cac tu theo dung thu tu con vua nghe.",
    "reading_comprehension": "Doc lai cau chuyen va chon dap an dung.",
    "written_response": "Doc cau hoi, roi viet cau tra loi ngan bang tieng Anh.",
    "listen_and_speak": "Nghe cau roi noi lai to va ro. Nghe lai bao nhieu lan cung duoc.",
}

_ACTIVITY_ID_PREFIXES = {
    "listening_fill_blank": "lfb_",
    "listen_and_order": "lo_",
    "reading_comprehension": "rc_q",
    "written_response": "wr_q",
    "listen_and_speak": "ls_",
}

def _normalize_activity_schema_shape(pack: dict, *, level: str) -> dict:
    """Normalize common LLM schema drift before jsonschema validation."""
    level_code = (level or "L2").upper()
    section_mix = LEVEL_RULES_V2.get(level_code, LEVEL_RULES_V2["L2"])["activity_c_section_mix"]
    repairs: list[str] = []

    for activity in pack.get("activities") or []:
        if not isinstance(activity, dict):
            continue
        activity_type = activity.get("type")

        def _coerce_item_ids(container_key: str) -> None:
            id_prefix = _ACTIVITY_ID_PREFIXES.get(activity_type, "q")
            for entry_idx, entry in enumerate(activity.get(container_key) or []):
                if not isinstance(entry, dict):
                    continue
                entry_id = entry.get("id")
                if entry_id is None or (isinstance(entry_id, str) and not entry_id.strip()):
                    entry["id"] = f"{id_prefix}{entry_idx + 1}"
                    repairs.append(f"{activity_type}:id_backfill->{container_key}")
                elif not isinstance(entry_id, str):
                    entry["id"] = str(entry_id)
                    repairs.append(f"{activity_type}:id->{container_key}")

        if activity_type in ("listening_fill_blank", "listen_and_order", "listen_and_speak"):
            _coerce_item_ids("items")
        elif activity_type in ("reading_comprehension", "written_response"):
            _coerce_item_ids("questions")

        if not (activity.get("instructions_vi") or "").strip():
            default_instructions = _ACTIVITY_DEFAULT_INSTRUCTIONS.get(
                activity_type, "Lam theo huong dan tren man hinh."
            )
            activity["instructions_vi"] = default_instructions
            repairs.append(f"{activity_type}:instructions_vi")

        if activity_type in ("reading_comprehension", "written_response"):
            if "questions" not in activity and isinstance(activity.get("items"), list):
                activity["questions"] = activity.pop("items")
                repairs.append(f"{activity_type}:items->questions")

        if activity_type in ("reading_comprehension", "written_response"):
            for q_idx, question in enumerate(activity.get("questions") or []):
                if not isinstance(question, dict):
                    continue
                if activity_type == "reading_comprehension":
                    expected_section = (
                        section_mix[q_idx] if q_idx < len(section_mix) else "Find It"
                    )
                    if question.get("section") != expected_section:
                        question["section"] = expected_section
                        repairs.append(f"rc_q{q_idx}:section")
                    if not (question.get("explanation_vi") or "").strip():
                        question["explanation_vi"] = "Dap an nam trong cau chuyen."
                        repairs.append(f"rc_q{q_idx}:explanation_vi")
                if not (question.get("question_vi") or "").strip():
                    question["question_vi"] = question.get("question_en") or "Cau hoi ve cau chuyen."
                    repairs.append(f"{activity_type}_q{q_idx}:question_vi")

        if activity_type == "listen_and_order":
            for item in activity.get("items") or []:
                if isinstance(item, dict) and not (item.get("translation_vi") or "").strip():
                    item["translation_vi"] = "Nghe va sap xep lai cau trong truyen."
                    repairs.append("order:translation_vi")

        if activity_type == "listen_and_speak":
            if not activity.get("scoring_mode"):
                first_item = (activity.get("items") or [{}])[0]
                activity["scoring_mode"] = (
                    first_item.get("scoring_mode") if isinstance(first_item, dict) else None
                ) or "self_rate"
                repairs.append("speak:scoring_mode_activity")
            for item in activity.get("items") or []:
                if isinstance(item, dict) and "scoring_mode" in item:
                    item.pop("scoring_mode", None)
                    repairs.append("speak:drop_item_scoring_mode")

    if repairs:
        print(
            f"[v2-generate] Schema shape repair applied "
            f"count={len(repairs)} level={level_code}"
        )
    return pack


def _hydrate_v2_pack_defaults(pack: dict, *, child_name: str, level: str, topic: str) -> dict:
    """Fill server-derived V2 fields and normalize activity JSON shape."""
    if not isinstance(pack, dict):
        return pack

    level_code = (level or "L1").upper()
    label = LEVEL_RULES_V2.get(level_code, LEVEL_RULES_V2["L1"])["label"]
    topic_name = pack.get("topic") or _topic_display(topic)
    story = pack.setdefault("story", {})
    story.setdefault("full_audio_url", "")
    for sent in story.get("sentences") or []:
        if isinstance(sent, dict):
            sent.setdefault("audio_url", "")

    slug = pack.get("slug") or _slugify(f"{child_name}_{topic_name}_{story.get('title', '')}")
    pack["schema_version"] = 2
    pack["student_name"] = pack.get("student_name") or child_name
    pack["level"] = level_code
    pack["level_label"] = pack.get("level_label") or label
    pack["topic"] = topic_name
    pack["slug"] = slug
    pack["audio_filename"] = pack.get("audio_filename") or _pascal_filename(slug)
    pack["rewards"] = pack.get("rewards") or {
        "coins_on_complete": 15,
        "xp_on_complete": 20,
        "bonus_coins_per_activity_attempted": 2,
    }
    pack["parent_note_vi"] = pack.get("parent_note_vi") or "Bai hoc nay luyen nghe, doc va viet cau tra loi ngan tren web."
    pack["next_suggestion_vi"] = pack.get("next_suggestion_vi") or "Bai tiep theo tiep tuc theo so thich cua con."

    for activity in pack.get("activities") or []:
        if not isinstance(activity, dict):
            continue
        if activity.get("type") in ("listening_fill_blank", "listen_and_order", "listen_and_speak"):
            for item in activity.get("items") or []:
                if isinstance(item, dict):
                    item.setdefault("audio_url", "")

    return _normalize_activity_schema_shape(pack, level=level_code)


def _audio_job_key(text: str, speed: float) -> tuple[str, float]:
    return (text.strip(), float(speed))


def _audio_kind_suffix(text: str) -> str:
    import hashlib

    return hashlib.md5(text.encode()).hexdigest()[:10]


def _required_activity_sentence_texts(pack: dict) -> set[str]:
    required: set[str] = set()
    for activity in pack.get("activities") or []:
        if not isinstance(activity, dict):
            continue
        activity_type = activity.get("type")
        if activity_type not in ("listening_fill_blank", "listen_and_order", "listen_and_speak"):
            continue
        for item in activity.get("items") or []:
            if not isinstance(item, dict):
                continue
            lookup = (
                item.get("source_sentence")
                or item.get("original_sentence")
                or item.get("text_en")
                or ""
            ).strip()
            if lookup:
                required.add(lookup)
    return required


def _wire_activity_audio_urls(pack: dict, sentence_url_by_text: dict[str, str]) -> None:
    for activity in pack.get("activities") or []:
        if not isinstance(activity, dict):
            continue
        if activity.get("type") not in ("listening_fill_blank", "listen_and_order", "listen_and_speak"):
            continue
        for item in activity.get("items") or []:
            if not isinstance(item, dict):
                continue
            lookup = (
                item.get("source_sentence")
                or item.get("original_sentence")
                or item.get("text_en")
                or ""
            ).strip()
            if lookup and lookup in sentence_url_by_text:
                item["audio_url"] = sentence_url_by_text[lookup]


def _run_parallel_audio_jobs(
    jobs: list[tuple[tuple[str, float], str, str]],
    tmp_dir: Path,
    prefix: str,
    speed: float,
) -> dict[tuple[str, float], str | None]:
    """Run deduped TTS jobs in parallel. Each job is (dedupe_key, kind_suffix, text)."""
    url_by_key: dict[tuple[str, float], str | None] = {}
    futures: dict[tuple[str, float], object] = {}
    for key, kind, text in jobs:
        if key in futures:
            continue
        futures[key] = _AUDIO_EXECUTOR.submit(
            _generate_one_audio_mp3, text, tmp_dir, prefix, kind, speed
        )

    for key, future in futures.items():
        try:
            _text, url = future.result(timeout=_AUDIO_JOB_TIMEOUT_S)
            url_by_key[key] = url
        except Exception as exc:
            print(f"[v2-audio] parallel job failed text='{key[0][:40]}': {exc}")
            url_by_key[key] = None
    return url_by_key


def _generate_v2_sentence_audio(pack: dict, level: str) -> dict:
    """Generate deduped per-sentence MP3s in parallel and wire activity audio URLs."""
    story = pack.get("story") or {}
    sentences = story.get("sentences") or []
    if not sentences:
        raise RuntimeError("pack.story.sentences empty - cannot generate activity audio")

    speed = TTS_SPEED_BY_LEVEL.get(level.upper(), 1.0)
    slug = pack.get("slug") or "v2pack"
    request_id = uuid_module.uuid4().hex[:8]
    prefix = f"{slug}_{request_id}"
    tmp_dir = Path(tempfile.mkdtemp(prefix="r2l_v2_"))

    try:
        unique_texts: dict[tuple[str, float], str] = {}
        for sentence in sentences:
            if not isinstance(sentence, dict):
                continue
            text = (sentence.get("text_en") or "").strip()
            if text:
                unique_texts[_audio_job_key(text, speed)] = text
        for text in _required_activity_sentence_texts(pack):
            unique_texts[_audio_job_key(text, speed)] = text

        jobs = [
            (key, f"sent_{_audio_kind_suffix(text)}", text)
            for key, text in unique_texts.items()
        ]
        url_by_key = _run_parallel_audio_jobs(jobs, tmp_dir, prefix, speed)

        sentence_url_by_text: dict[str, str] = {}
        for key, text in unique_texts.items():
            url = url_by_key.get(key)
            if url:
                sentence_url_by_text[text] = url

        for sentence in sentences:
            if not isinstance(sentence, dict):
                continue
            text = (sentence.get("text_en") or "").strip()
            if text in sentence_url_by_text:
                sentence["audio_url"] = sentence_url_by_text[text]

        _wire_activity_audio_urls(pack, sentence_url_by_text)

        missing = sorted(
            text for text in _required_activity_sentence_texts(pack) if text not in sentence_url_by_text
        )
        if missing:
            raise RuntimeError(
                f"Sentence TTS missing for {len(missing)} required activity lines "
                f"(first: {missing[0][:60]!r})"
            )
        return pack
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


def _generate_v2_full_story_audio(pack: dict, level: str) -> str | None:
    """Generate one full-story MP3. Non-blocking relative to sentence audio when deferred."""
    story = pack.get("story") or {}
    paragraphs_en = story.get("paragraphs_en") or []
    if not paragraphs_en:
        return None

    speed = TTS_SPEED_BY_LEVEL.get(level.upper(), 1.0)
    slug = pack.get("slug") or "v2pack"
    request_id = uuid_module.uuid4().hex[:8]
    prefix = f"{slug}_{request_id}"
    tmp_dir = Path(tempfile.mkdtemp(prefix="r2l_v2_story_"))
    try:
        full_story_text = "\n\n".join(str(paragraph) for paragraph in paragraphs_en)
        _text, story_url = _generate_one_audio_mp3(
            full_story_text, tmp_dir, prefix, "story", speed
        )
        return story_url
    finally:
        try:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


def _generate_v2_pack_audio(pack: dict, level: str, *, defer_full_story: bool = True) -> dict:
    """Generate V2 pack audio. Sentence clips are required; full story may be deferred."""
    pack = _generate_v2_sentence_audio(pack, level)
    if defer_full_story:
        return pack

    story_url = _generate_v2_full_story_audio(pack, level)
    if not story_url:
        raise RuntimeError("Full story TTS failed - pack unusable without primary audio")
    story = pack.setdefault("story", {})
    story["full_audio_url"] = story_url
    return pack


def _build_v2_result_payload(pack: dict, *, topic: str, usage: dict, attempts: int) -> dict:
    return {
        "topic": pack.get("topic") or topic,
        "story_title": (pack.get("story") or {}).get("title") or "",
        "pdf_url": "",
        "mp3_url": (pack.get("story") or {}).get("full_audio_url") or "",
        "pack": pack,
        "review_context": pack,
        "attempts": attempts,
        "usage": usage,
    }


def _run_generation_task_v2(
    task_id,
    child_name,
    age,
    level,
    gender,
    interests,
    topic,
    rank_points=None,
    level_progress_percent=None,
):
    started = time.time()
    _mark_generation_started()
    _publish_task_state(task_id, {
        "status": "pending",
        "queue_position": 0,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })

    pack = None
    previous_pack = None
    validation_errors: list[str] | None = None
    max_attempts = 3
    last_usage: dict = {}

    try:
        for attempt in range(max_attempts):
            try:
                pack, usage = generate_pack_v2(
                    child_name=child_name,
                    age=age,
                    level=level,
                    gender=gender,
                    interests=interests,
                    topic=topic,
                    rank_points=rank_points,
                    level_progress_percent=level_progress_percent,
                    validation_errors=validation_errors,
                    previous_pack=previous_pack,
                    attempt_index=attempt,
                )
                last_usage = usage
                pack = _hydrate_v2_pack_defaults(
                    pack,
                    child_name=child_name,
                    level=level,
                    topic=topic,
                )
                pack = _repair_story_sentences(pack)
                pack = _repair_activity_sentence_assignments(pack)
                pack = _repair_activity_b_tokens(pack)
                pack = _rotate_v2_mcq_answers(pack)
                is_valid, errors = validate_pack_v2(pack, expected_level=level)
                if not is_valid:
                    schema_errors = [e for e in errors if e.startswith("schema:")]
                    if schema_errors:
                        print(
                            f"[v2-generate] Schema validation still failing after hydrate "
                            f"attempt={attempt + 1} count={len(schema_errors)} "
                            f"first={schema_errors[0]}"
                        )
                if is_valid:
                    print(
                        f"[v2-generate] LLM OK attempt={attempt + 1}/{max_attempts} "
                        f"provider={usage.get('provider')} model={usage.get('model')}"
                    )
                    audio_started = time.time()
                    try:
                        pack = _generate_v2_pack_audio(pack, level, defer_full_story=True)
                        sentence_audio_s = time.time() - audio_started
                        print(
                            f"[v2-generate] Sentence audio OK in {sentence_audio_s:.1f}s "
                            f"(full story deferred)"
                        )
                    except Exception as audio_err:
                        print(f"[v2-generate] Audio pipeline FAILED: {audio_err}")
                        _publish_task_state(task_id, {
                            "status": "error",
                            "error": f"Audio pipeline failed: {audio_err}",
                        })
                        _log_v2_pack(
                            task_id=task_id,
                            status="failed_audio",
                            attempts=attempt + 1,
                            usage=usage,
                            latency_s=time.time() - started,
                            level=level,
                            pack=pack,
                            rank_points=rank_points,
                            level_progress_percent=level_progress_percent,
                        )
                        return

                    result = _build_v2_result_payload(
                        pack,
                        topic=topic,
                        usage=usage,
                        attempts=attempt + 1,
                    )
                    _publish_task_state(task_id, {"status": "done", "result": result})
                    print(
                        f"[v2-generate] Pack published after sentence audio "
                        f"({time.time() - started:.1f}s total so far)"
                    )

                    full_started = time.time()
                    try:
                        story_url = _generate_v2_full_story_audio(pack, level)
                        if story_url:
                            pack.setdefault("story", {})["full_audio_url"] = story_url
                            result = _build_v2_result_payload(
                                pack,
                                topic=topic,
                                usage=usage,
                                attempts=attempt + 1,
                            )
                            _publish_task_state(task_id, {"status": "done", "result": result})
                            print(
                                f"[v2-generate] Deferred full story OK in "
                                f"{time.time() - full_started:.1f}s"
                            )
                        else:
                            print("[v2-generate] Deferred full story returned no URL (non-fatal)")
                    except Exception as full_err:
                        print(f"[v2-generate] Deferred full story failed (non-fatal): {full_err}")

                    _log_v2_pack(
                        task_id=task_id,
                        status="success",
                        attempts=attempt + 1,
                        usage=usage,
                        latency_s=time.time() - started,
                        level=level,
                        pack=pack,
                        rank_points=rank_points,
                        level_progress_percent=level_progress_percent,
                    )
                    return
                validation_errors = errors
                previous_pack = pack
                print(f"[v2-generate] Validation failed attempt {attempt + 1}/{max_attempts}: {errors[:5]}")
            except Exception as e:
                print(f"[v2-generate] Error attempt {attempt + 1}/{max_attempts}: {e}")
                if attempt == max_attempts - 1:
                    _publish_task_state(task_id, {"status": "error", "error": f"Generation error: {e}"})
                    _log_v2_pack(
                        task_id=task_id,
                        status="failed_exception",
                        attempts=attempt + 1,
                        usage=last_usage,
                        latency_s=time.time() - started,
                        level=level,
                        pack=pack or {},
                        rank_points=rank_points,
                        level_progress_percent=level_progress_percent,
                    )
                    return

        _publish_task_state(task_id, {
            "status": "error",
            "error": f"Validation failed after {max_attempts} attempts",
            "errors": (validation_errors or [])[:10],
        })
        _log_v2_pack(
            task_id=task_id,
            status="failed_validation",
            attempts=max_attempts,
            usage=last_usage,
            latency_s=time.time() - started,
            level=level,
            pack=pack or {},
            rank_points=rank_points,
            level_progress_percent=level_progress_percent,
        )
    finally:
        _mark_generation_finished()


def _check_generation_capacity():
    """Reject new tasks when active + queued backlog exceeds Hobby-safe limits."""
    with _QUEUE_COUNTERS_LOCK:
        active = _active_generations
        queued = _queued_generations
        if active >= MAX_CONCURRENT_GENERATIONS and queued >= MAX_QUEUED_GENERATIONS:
            retry_after = 45
            print(
                f"[v2-pack] at_capacity active={active} queued={queued} "
                f"max_active={MAX_CONCURRENT_GENERATIONS} max_queued={MAX_QUEUED_GENERATIONS}"
            )
            return (
                jsonify({
                    "ok": False,
                    "error": "at_capacity",
                    "message": "He thong dang ban. Vui long thu lai sau vai phut.",
                    "retry_after": retry_after,
                    "queue_position": active + queued + 1,
                }),
                429,
            )
    return None


def _mark_generation_started():
    global _active_generations, _queued_generations
    with _QUEUE_COUNTERS_LOCK:
        if _queued_generations > 0:
            _queued_generations -= 1
        _active_generations += 1


def _mark_generation_queued():
    global _queued_generations
    with _QUEUE_COUNTERS_LOCK:
        _queued_generations += 1
        return _active_generations, _queued_generations


def _mark_generation_finished():
    global _active_generations
    with _QUEUE_COUNTERS_LOCK:
        _active_generations = max(0, _active_generations - 1)


def _log_v2_pack(
    task_id,
    status,
    attempts,
    usage,
    latency_s,
    level,
    pack,
    rank_points=None,
    level_progress_percent=None,
):
    usage = usage or {}
    llm_in = int(usage.get("input_tokens") or 0)
    llm_out = int(usage.get("output_tokens") or 0)
    provider = usage.get("provider") or ""
    model = usage.get("model") or ""
    cost = _estimate_llm_cost(usage)
    activities = pack.get("activities") if isinstance(pack, dict) else []
    activity_types = [a.get("type", "?") for a in activities if isinstance(a, dict)]
    ramp_stage = inlevel_ramp_stage(level_progress_percent)
    challenge_band = challenge_dial_band(rank_points)
    print(
        f"[v2-pack] task={task_id} status={status} attempts={attempts} "
        f"provider={provider} model={model} latency_s={latency_s:.1f} llm_in={llm_in} "
        f"llm_out={llm_out} llm_cost=${cost:.4f} level={level} "
        f"ramp_stage={ramp_stage} challenge_band={challenge_band} "
        f"activities={','.join(activity_types)}"
    )
    for activity in activities or []:
        if not isinstance(activity, dict):
            continue
        items = activity.get("items") or activity.get("questions") or []
        print(
            f"[v2-activity] task={task_id} type={activity.get('type', '?')} "
            f"items={len(items) if isinstance(items, list) else 0}"
        )


def _estimate_llm_cost(usage):
    # Conservative telemetry estimate only; billing source remains provider dashboard.
    llm_in = int(usage.get("input_tokens") or 0)
    llm_out = int(usage.get("output_tokens") or 0)
    return (llm_in * 0.000003) + (llm_out * 0.000015)


# Voice A/B sample endpoint. Uses the same model/voice/instructions as pack TTS.
# Auth model:
#   - Default: requires X-Read2Lead-Secret header (same as other routes)
#   - If env R2L_VOICE_TEST_OPEN=1, the secret check is bypassed (so
#     Phuong can just paste the URL into a phone browser during pilot
#     testing). Remember to unset that env after picking the voice.

_VOICE_SAMPLE_ALLOWED = ALLOWED_TTS_VOICES

_VOICE_SAMPLE_STORY = (
    "Bin is six years old. He loves his puppy Mochi. Today after school, "
    "Bin and Mochi go to the small park near home. Bin holds the leash gently. "
    "Mochi sees a butterfly and runs fast. Bin calls the puppy back softly. "
    "Mochi comes running and wags his tail. Bin laughs and gives the puppy a treat. "
    "On the way home, Bin teaches Mochi to sit at the corner before they cross. "
    "Mochi sits like a star. Bin feels proud. He thinks, today was a good walk."
)


@app.route("/voice-sample", methods=["GET"])
def voice_sample():
    # Allow secret bypass when explicitly enabled for A/B testing.
    if os.environ.get("R2L_VOICE_TEST_OPEN") != "1":
        auth_error = require_backend_secret()
        if auth_error:
            return auth_error

    voice = (request.args.get("voice") or TTS_VOICE).strip().lower()
    if voice not in _VOICE_SAMPLE_ALLOWED:
        return jsonify({"ok": False, "error": f"voice must be one of {sorted(_VOICE_SAMPLE_ALLOWED)}"}), 400

    from flask import Response

    api_key = os.environ.get("READ2LEAD_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return jsonify({"ok": False, "error": "OPENAI_API_KEY not configured"}), 500

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        speech_kwargs, extra_body = build_speech_create_kwargs(
            model=TTS_MODEL,
            voice=voice,
            text=_VOICE_SAMPLE_STORY,
            speed=TTS_SPEED_BY_LEVEL.get("L2", 0.95),
            instructions=TTS_INSTRUCTIONS,
        )
        with open_speech_stream(client, speech_kwargs, extra_body) as response:
            audio_bytes = response.read()
    except Exception as exc:
        print(f"[voice-sample] error voice={voice}: {exc}")
        return jsonify({"ok": False, "error": f"tts_failed: {exc}"}), 500

    print(f"[voice-sample] voice={voice} bytes={len(audio_bytes)}")
    return Response(
        audio_bytes,
        mimetype="audio/mpeg",
        headers={
            "Content-Disposition": f'inline; filename="voice_sample_{voice}.mp3"',
            "Cache-Control": "no-store",
        },
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=False)
