"""Tests for R2/S3 upload client reuse."""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

API_DIR = Path(__file__).resolve().parents[1] / "api"
sys.path.insert(0, str(API_DIR))

from r2_uploader import upload_file, get_r2_client  # noqa: E402


def _set_r2_env(monkeypatch):
    """Set required R2 env vars for tests."""
    monkeypatch.setenv("R2_ENDPOINT", "https://test.r2.cloudflarestorage.com")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "test-key-id")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "test-secret")
    monkeypatch.setenv("R2_BUCKET_NAME", "test-bucket")
    monkeypatch.setenv("R2_PUBLIC_URL", "https://cdn.example.com")


def test_upload_file_accepts_optional_client_and_reuses_it(monkeypatch):
    """When client is provided, upload_file should NOT call get_r2_client."""
    _set_r2_env(monkeypatch)

    fake_client = MagicMock()
    fake_client.put_object.return_value = {"ETag": "test-etag"}

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(b"test audio data")
        local_path = f.name

    try:
        with patch("r2_uploader.get_r2_client") as mock_get_client:
            url = upload_file(
                local_path=local_path,
                key="books/book_123/test.mp3",
                content_type="audio/mpeg",
                client=fake_client,
            )

        # get_r2_client should NOT have been called
        mock_get_client.assert_not_called()
        # The provided client should have been used
        fake_client.put_object.assert_called_once()
        # URL should be correct
        assert url == "https://cdn.example.com/books/book_123/test.mp3"
    finally:
        os.unlink(local_path)


def test_upload_file_creates_client_when_none_provided(monkeypatch):
    """When client is None, upload_file should call get_r2_client (backward compat)."""
    _set_r2_env(monkeypatch)

    fake_client = MagicMock()
    fake_client.put_object.return_value = {"ETag": "test-etag"}

    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as f:
        f.write(b"test audio data")
        local_path = f.name

    try:
        with patch("r2_uploader.get_r2_client", return_value=fake_client) as mock_get_client:
            url = upload_file(
                local_path=local_path,
                key="books/book_123/test.mp3",
                content_type="audio/mpeg",
                client=None,
            )

        # get_r2_client should have been called once
        mock_get_client.assert_called_once()
        # The client should have been used
        fake_client.put_object.assert_called_once()
        assert url == "https://cdn.example.com/books/book_123/test.mp3"
    finally:
        os.unlink(local_path)


def test_upload_file_passes_correct_bucket_and_key(monkeypatch):
    """upload_file should pass the correct bucket and key to put_object."""
    _set_r2_env(monkeypatch)

    fake_client = MagicMock()
    fake_client.put_object.return_value = {"ETag": "test-etag"}

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f:
        f.write(b"test image data")
        local_path = f.name

    try:
        upload_file(
            local_path=local_path,
            key="books/book_456/page_01.jpg",
            content_type="image/jpeg",
            client=fake_client,
        )

        call_kwargs = fake_client.put_object.call_args.kwargs
        assert call_kwargs["Bucket"] == "test-bucket"
        assert call_kwargs["Key"] == "books/book_456/page_01.jpg"
        assert call_kwargs["ContentType"] == "image/jpeg"
    finally:
        os.unlink(local_path)