"""CLI wrapper — delegates to audio/generate_story_audio_openai.py."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_AUDIO_DIR = Path(__file__).resolve().parents[1] / "audio"
if str(_AUDIO_DIR) not in sys.path:
    sys.path.insert(0, str(_AUDIO_DIR))

from generate_story_audio_openai import (  # noqa: E402
    DEFAULT_MODEL,
    DEFAULT_SPEED,
    DEFAULT_TARGET_LUFS,
    DEFAULT_VOICE,
    generate_story_audio,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate story-only MP3 narration with OpenAI TTS.")
    parser.add_argument("--input", required=True, help="Path to story-only text file.")
    parser.add_argument("--output", required=True, help="Path to output MP3.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help=f"OpenAI TTS model. Default: {DEFAULT_MODEL}")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help=f"OpenAI TTS voice. Default: {DEFAULT_VOICE}")
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


def main() -> int:
    args = parse_args()
    try:
        story_text = Path(args.input).read_text(encoding="utf-8").strip()
        if not story_text:
            raise ValueError("Story text file is empty.")
        generate_story_audio(
            story_text,
            Path(args.output),
            model=args.model,
            voice=args.voice,
            speed=args.speed,
            normalize_audio=not args.skip_normalize,
            target_lufs=args.target_lufs,
        )
        print(f"Created MP3: {args.output}")
        return 0
    except Exception as exc:
        print(f"Error: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
