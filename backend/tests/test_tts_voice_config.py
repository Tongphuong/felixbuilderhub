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
    generate_mp3,
    generate_story_audio,
    normalize_mp3_loudness,
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


# ── Client reuse tests ─────────────────────────────────────────────────────────


def test_generate_mp3_accepts_optional_client_and_reuses_it():
    """When client is provided, generate_mp3 should NOT create a new OpenAI() instance."""
    from unittest.mock import patch, MagicMock

    fake_client = MagicMock()
    stream_ctx = MagicMock()
    fake_client.audio.speech.with_streaming_response.create.return_value = stream_ctx

    with patch("generate_story_audio_openai.OpenAI") as mock_openai:
        generate_mp3(
            story_text="Hello world.",
            output_path=Path("/tmp/test_reuse.mp3"),
            model="gpt-4o-mini-tts",
            voice="nova",
            speed=0.85,
            normalize_audio=False,
            client=fake_client,
        )

    # OpenAI constructor should NOT have been called
    mock_openai.assert_not_called()
    # The provided client should have been used
    fake_client.audio.speech.with_streaming_response.create.assert_called_once()


def test_generate_mp3_creates_client_when_none_provided():
    """When client is None, generate_mp3 should create a new OpenAI() (backward compat)."""
    from unittest.mock import patch, MagicMock

    fake_client = MagicMock()
    stream_ctx = MagicMock()
    fake_client.audio.speech.with_streaming_response.create.return_value = stream_ctx

    with (
        patch("generate_story_audio_openai.OpenAI", return_value=fake_client) as mock_openai,
        patch("generate_story_audio_openai.get_api_key", return_value=("test-key", "OPENAI_API_KEY")),
    ):
        generate_mp3(
            story_text="Hello world.",
            output_path=Path("/tmp/test_no_reuse.mp3"),
            model="gpt-4o-mini-tts",
            voice="nova",
            speed=0.85,
            normalize_audio=False,
            client=None,
        )

    # OpenAI constructor should have been called once
    mock_openai.assert_called_once_with(api_key="test-key")


def test_generate_story_audio_passes_client_through():
    """generate_story_audio should pass the client parameter to generate_mp3."""
    from unittest.mock import patch, MagicMock

    fake_client = MagicMock()
    stream_ctx = MagicMock()
    fake_client.audio.speech.with_streaming_response.create.return_value = stream_ctx

    with patch("generate_story_audio_openai.OpenAI") as mock_openai:
        generate_story_audio(
            text="Hello world.",
            out_path=Path("/tmp/test_passthrough.mp3"),
            model="gpt-4o-mini-tts",
            voice="nova",
            speed=0.85,
            normalize_audio=False,
            client=fake_client,
        )

    mock_openai.assert_not_called()
    fake_client.audio.speech.with_streaming_response.create.assert_called_once()


def test_normalize_mp3_forces_mp3_muxer_for_partial_suffix(tmp_path):
    """FFmpeg must not infer its output format from a .part suffix."""
    from unittest.mock import patch

    partial_path = tmp_path / "clip.mp3.part"
    partial_path.write_bytes(b"raw mp3")

    with (
        patch("generate_story_audio_openai.shutil.which", return_value="/usr/bin/ffmpeg"),
        patch("generate_story_audio_openai.subprocess.run") as run,
    ):
        normalize_mp3_loudness(partial_path)

    command = run.call_args.args[0]
    format_index = command.index("-f")
    assert command[format_index + 1] == "mp3"
