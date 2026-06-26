"""Generate one Read2Lead story narration MP3 from a plain-text story file.

Usage:
    python audio/generate_story_audio_openai.py --input audio/sample_story_text.txt --output generated/audio/Coolkid_Bike_Challenge_Audio.mp3
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from openai import OpenAI


DEFAULT_MODEL = "gpt-4o-mini-tts"
DEFAULT_VOICE = "nova"
ALLOWED_TTS_VOICES = frozenset(
    {"shimmer", "coral", "verse", "ballad", "sage", "alloy", "nova", "echo", "fable", "onyx"}
)
ALLOWED_TTS_MODELS = frozenset({"gpt-4o-mini-tts", "tts-1", "tts-1-hd"})
DEFAULT_SPEED = 0.85
DEFAULT_INSTRUCTIONS = (
    "Read in a bright, warm, slightly higher-pitched voice like a cheerful "
    "young English teacher reading aloud to Vietnamese children learning English. "
    "Use playful varied intonation with gentle emphasis on key vocabulary. "
    "Pause briefly between sentences. Sound encouraging, curious, and friendly—"
    "never monotone, flat, or too deep."
)
DEFAULT_TARGET_LUFS = -16.0
TTS_1_COST_PER_1M_CHARS_USD = 30.0
MAX_TTS_INPUT_CHARS = 4096
PROJECT_API_KEY_ENV = "READ2LEAD_OPENAI_API_KEY"
FALLBACK_API_KEY_ENV = "OPENAI_API_KEY"
MIN_TTS_SPEED = 0.25
MAX_TTS_SPEED = 4.0


def resolve_tts_model(*, env: dict | None = None) -> str:
    """Resolve production TTS model from TTS_MODEL env (Render dashboard)."""
    source = env if env is not None else os.environ
    raw = (source.get("TTS_MODEL") or "").strip()
    if not raw:
        return DEFAULT_MODEL
    if raw not in ALLOWED_TTS_MODELS:
        print(
            f"[tts-config] Invalid TTS_MODEL={raw!r}; "
            f"allowed={sorted(ALLOWED_TTS_MODELS)}; using {DEFAULT_MODEL}"
        )
        return DEFAULT_MODEL
    return raw


def resolve_tts_voice(*, env: dict | None = None) -> str:
    """Resolve production TTS voice from TTS_VOICE env (Render dashboard)."""
    source = env if env is not None else os.environ
    raw = (source.get("TTS_VOICE") or "").strip().lower()
    if not raw:
        return DEFAULT_VOICE
    if raw not in ALLOWED_TTS_VOICES:
        print(
            f"[tts-config] Invalid TTS_VOICE={raw!r}; "
            f"allowed={sorted(ALLOWED_TTS_VOICES)}; using {DEFAULT_VOICE}"
        )
        return DEFAULT_VOICE
    return raw


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert one plain-text Read2Lead story into one MP3 narration file using OpenAI TTS."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to the input .txt story file. Include only the story title and story text.",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path where the generated .mp3 file should be saved.",
    )
    parser.add_argument(
        "--voice",
        default=DEFAULT_VOICE,
        help=f"OpenAI TTS voice to use. Default: {DEFAULT_VOICE}",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=f"OpenAI TTS model to use. Default: {DEFAULT_MODEL}",
    )
    parser.add_argument(
        "--speed",
        type=float,
        default=DEFAULT_SPEED,
        help=f"TTS speech speed. Default: {DEFAULT_SPEED} for child-friendly narration.",
    )
    parser.add_argument(
        "--target-lufs",
        type=float,
        default=DEFAULT_TARGET_LUFS,
        help=f"Target MP3 loudness after normalization. Default: {DEFAULT_TARGET_LUFS:g} LUFS.",
    )
    parser.add_argument(
        "--skip-normalize",
        action="store_true",
        help="Skip FFmpeg loudness normalization and keep the raw OpenAI MP3.",
    )
    return parser.parse_args()


def read_story(input_path: Path) -> str:
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    if not input_path.is_file():
        raise ValueError(f"Input path is not a file: {input_path}")
    if input_path.suffix.lower() != ".txt":
        raise ValueError("Input must be a .txt file.")

    text = input_path.read_text(encoding="utf-8").strip()
    if not text:
        raise ValueError("Input story file is empty.")
    if len(text) > MAX_TTS_INPUT_CHARS:
        raise ValueError(
            f"Input story is {len(text):,} characters. "
            f"The OpenAI speech endpoint supports up to {MAX_TTS_INPUT_CHARS:,} characters per request. "
            "Shorten the story before generating audio."
        )
    return text


def estimate_tts_1_cost(character_count: int) -> float:
    return (character_count / 1_000_000) * TTS_1_COST_PER_1M_CHARS_USD


def get_api_key() -> tuple[str, str]:
    project_key = os.getenv(PROJECT_API_KEY_ENV)
    if project_key:
        return project_key, PROJECT_API_KEY_ENV

    fallback_key = os.getenv(FALLBACK_API_KEY_ENV)
    if fallback_key:
        return fallback_key, FALLBACK_API_KEY_ENV

    raise EnvironmentError(
        f"{PROJECT_API_KEY_ENV} is not set, and {FALLBACK_API_KEY_ENV} is not set. "
        f"Set {PROJECT_API_KEY_ENV} before running this script."
    )


def validate_speed(speed: float) -> None:
    if not MIN_TTS_SPEED <= speed <= MAX_TTS_SPEED:
        raise ValueError(f"TTS speed must be between {MIN_TTS_SPEED} and {MAX_TTS_SPEED}.")


def normalize_mp3_loudness(output_path: Path, target_lufs: float = DEFAULT_TARGET_LUFS) -> bool:
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        print("Warning: ffmpeg not found. Skipping MP3 loudness normalization.")
        return False

    with tempfile.NamedTemporaryFile(
        suffix=output_path.suffix,
        prefix=f"{output_path.stem}_normalized_",
        dir=output_path.parent,
        delete=False,
    ) as temp_file:
        temp_path = Path(temp_file.name)

    command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(output_path),
        "-af",
        f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "192k",
        str(temp_path),
    ]

    try:
        subprocess.run(command, check=True)
        temp_path.replace(output_path)
        print(f"Normalized MP3 loudness to {target_lufs:g} LUFS.")
        return True
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise


def build_speech_create_kwargs(
    *,
    model: str,
    voice: str,
    text: str,
    speed: float,
    instructions: str | None = None,
) -> tuple[dict, dict | None]:
    """Build OpenAI speech.create kwargs for gpt-4o-mini-tts.

    Steerable instructions are sent via extra_body so older openai SDK builds
    on Render (1.54.x) still reach the API without TypeError.
    """
    kwargs = {
        "model": model,
        "voice": voice,
        "input": text,
        "response_format": "mp3",
        "speed": speed,
    }
    steer = instructions if instructions is not None else DEFAULT_INSTRUCTIONS
    extra_body = {"instructions": steer} if model.startswith("gpt-4o") and steer else None
    return kwargs, extra_body


def open_speech_stream(client: OpenAI, speech_kwargs: dict, extra_body: dict | None = None):
    """Open a streaming TTS response, passing instructions through extra_body."""
    return client.audio.speech.with_streaming_response.create(
        **speech_kwargs,
        extra_body=extra_body,
    )


def generate_mp3(
    story_text: str,
    output_path: Path,
    model: str,
    voice: str,
    speed: float,
    normalize_audio: bool = True,
    target_lufs: float = DEFAULT_TARGET_LUFS,
    instructions: str | None = None,
) -> None:
    validate_speed(speed)
    api_key, key_source = get_api_key()
    print(f"Using API key from: {key_source}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    client = OpenAI(api_key=api_key)
    speech_kwargs, extra_body = build_speech_create_kwargs(
        model=model,
        voice=voice,
        text=story_text,
        speed=speed,
        instructions=instructions,
    )
    with open_speech_stream(client, speech_kwargs, extra_body) as response:
        response.stream_to_file(output_path)

    if normalize_audio:
        normalize_mp3_loudness(output_path, target_lufs=target_lufs)


def generate_story_audio(
    text: str,
    out_path: Path,
    model: str = DEFAULT_MODEL,
    voice: str = DEFAULT_VOICE,
    speed: float | None = None,
    instructions: str | None = None,
    normalize_audio: bool = True,
    target_lufs: float = DEFAULT_TARGET_LUFS,
) -> None:
    """Generate one story/audio snippet MP3 from raw text."""
    generate_mp3(
        text,
        out_path,
        model=model,
        voice=voice,
        speed=speed if speed is not None else DEFAULT_SPEED,
        instructions=instructions,
        normalize_audio=normalize_audio,
        target_lufs=target_lufs,
    )


def main() -> int:
    args = parse_args()
    input_path = Path(args.input)
    output_path = Path(args.output)

    try:
        story_text = read_story(input_path)
        character_count = len(story_text)
        estimated_cost = estimate_tts_1_cost(character_count)

        print("Read2Lead story-only OpenAI TTS generation")
        print(f"Input: {input_path}")
        print(f"Output: {output_path}")
        print(f"Model: {args.model}")
        print(f"Voice: {args.voice}")
        print(f"Speed: {args.speed}")
        print(f"Loudness normalization: {'off' if args.skip_normalize else f'{args.target_lufs:g} LUFS'}")
        print(f"Character count: {character_count:,}")
        print(f"Approximate tts-1 cost: ${estimated_cost:.4f}")
        print("Reminder: input should contain only the story title and story text.")

        if args.model != DEFAULT_MODEL:
            print("Note: cost estimate is based on tts-1 pricing only.")

        print("Generating story narration MP3...")
        generate_mp3(
            story_text,
            output_path,
            args.model,
            args.voice,
            args.speed,
            normalize_audio=not args.skip_normalize,
            target_lufs=args.target_lufs,
        )
        print(f"Success: story narration MP3 saved to {output_path}")
        return 0
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
