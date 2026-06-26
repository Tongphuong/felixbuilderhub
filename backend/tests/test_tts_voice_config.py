"""TTS voice/model defaults for Vietnamese kid-friendly narration."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

AUDIO_DIR = Path(__file__).resolve().parents[1] / "audio"
sys.path.insert(0, str(AUDIO_DIR))

from generate_story_audio_openai import (  # noqa: E402
    DEFAULT_INSTRUCTIONS,
    DEFAULT_MODEL,
    DEFAULT_VOICE,
    build_speech_create_kwargs,
    open_speech_stream,
    resolve_tts_model,
    resolve_tts_voice,
)


def test_production_tts_defaults():
    assert DEFAULT_MODEL == "gpt-4o-mini-tts"
    assert DEFAULT_VOICE == "nova"
    assert "Vietnamese children" in DEFAULT_INSTRUCTIONS
    assert "higher-pitched" in DEFAULT_INSTRUCTIONS


def test_resolve_tts_env_overrides():
    assert resolve_tts_model(env={"TTS_MODEL": "tts-1-hd"}) == "tts-1-hd"
    assert resolve_tts_voice(env={"TTS_VOICE": "coral"}) == "coral"


def test_resolve_tts_env_invalid_falls_back_to_defaults():
    assert resolve_tts_model(env={"TTS_MODEL": "bad-model"}) == DEFAULT_MODEL
    assert resolve_tts_voice(env={"TTS_VOICE": "not-a-voice"}) == DEFAULT_VOICE


def test_resolve_tts_env_empty_uses_defaults():
    assert resolve_tts_model(env={}) == DEFAULT_MODEL
    assert resolve_tts_voice(env={}) == DEFAULT_VOICE


def test_gpt4o_speech_kwargs_include_instructions_and_speed():
    kwargs, extra_body = build_speech_create_kwargs(
        model="gpt-4o-mini-tts",
        voice="nova",
        text="Pilot is in the kitchen.",
        speed=0.85,
    )
    assert kwargs["model"] == "gpt-4o-mini-tts"
    assert kwargs["voice"] == "nova"
    assert kwargs["speed"] == 0.85
    assert "instructions" not in kwargs
    assert extra_body == {"instructions": DEFAULT_INSTRUCTIONS}


def test_legacy_tts_model_omits_instructions():
    kwargs, extra_body = build_speech_create_kwargs(
        model="tts-1-hd",
        voice="shimmer",
        text="Hello.",
        speed=1.0,
    )
    assert "instructions" not in kwargs
    assert extra_body is None


def test_open_speech_stream_passes_instructions_via_extra_body():
    """Legacy openai SDK rejects instructions kwarg; extra_body must carry it."""
    client = MagicMock()
    stream_ctx = MagicMock()
    client.audio.speech.with_streaming_response.create.return_value = stream_ctx

    kwargs, extra_body = build_speech_create_kwargs(
        model="gpt-4o-mini-tts",
        voice="nova",
        text="Kimmy has a small cat.",
        speed=0.85,
    )

    with open_speech_stream(client, kwargs, extra_body):
        pass

    client.audio.speech.with_streaming_response.create.assert_called_once_with(
        **kwargs,
        extra_body={"instructions": DEFAULT_INSTRUCTIONS},
    )
    call_kwargs = client.audio.speech.with_streaming_response.create.call_args.kwargs
    assert "instructions" not in call_kwargs


def test_open_speech_stream_legacy_sdk_typeerror_retry_without_instructions_kwarg():
    """Simulate openai 1.54: instructions only via extra_body, never as direct kwarg."""
    kwargs, extra_body = build_speech_create_kwargs(
        model="gpt-4o-mini-tts",
        voice="nova",
        text="Pilot is in the kitchen.",
        speed=0.85,
    )

    def legacy_create(**call_kwargs):
        if "instructions" in call_kwargs:
            raise TypeError("Speech.create() got an unexpected keyword argument 'instructions'")
        return MagicMock()

    client = MagicMock()
    client.audio.speech.with_streaming_response.create.side_effect = legacy_create

    with open_speech_stream(client, kwargs, extra_body):
        pass

    assert "instructions" not in client.audio.speech.with_streaming_response.create.call_args.kwargs
    assert client.audio.speech.with_streaming_response.create.call_args.kwargs["extra_body"] == {
        "instructions": DEFAULT_INSTRUCTIONS,
    }
