"""Capacity gate for /generate-async-v2 on Render Hobby."""
from __future__ import annotations

import os
from unittest.mock import patch

import pytest

for key in [
    "ANTHROPIC_API_KEY",
    "READ2LEAD_BACKEND_SECRET",
    "R2_ENDPOINT",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_URL",
    "OPENAI_API_KEY",
]:
    os.environ.setdefault(key, "test")


@pytest.fixture()
def client():
    from server import app

    app.config["TESTING"] = True
    with app.test_client() as test_client:
        yield test_client


def _auth_headers():
    return {
        "Content-Type": "application/json",
        "X-Read2Lead-Secret": os.environ["READ2LEAD_BACKEND_SECRET"],
    }


def _valid_payload():
    return {
        "child_name": "Bin",
        "age": 8,
        "level": "L2",
        "child_gender": "boy",
        "interests": "dogs",
        "topic": "park",
    }


@patch("server._GENERATION_EXECUTOR")
@patch("server._publish_task_state")
@patch("server.MAX_CONCURRENT_GENERATIONS", 2)
@patch("server.MAX_QUEUED_GENERATIONS", 2)
@patch("server._active_generations", 2)
@patch("server._queued_generations", 2)
def test_generate_rejects_when_at_capacity(mock_publish, mock_executor, client):
    response = client.post(
        "/generate-async-v2",
        json=_valid_payload(),
        headers=_auth_headers(),
    )
    assert response.status_code == 429
    body = response.get_json()
    assert body["ok"] is False
    assert body["error"] == "at_capacity"
    assert body["retry_after"] == 45
    mock_executor.submit.assert_not_called()
    mock_publish.assert_not_called()


@patch("server._GENERATION_EXECUTOR")
@patch("server._publish_task_state")
@patch("server.MAX_CONCURRENT_GENERATIONS", 2)
@patch("server.MAX_QUEUED_GENERATIONS", 4)
@patch("server._active_generations", 1)
@patch("server._queued_generations", 1)
def test_generate_accepts_when_under_capacity(mock_publish, mock_executor, client):
    mock_executor.submit.return_value = None
    response = client.post(
        "/generate-async-v2",
        json=_valid_payload(),
        headers=_auth_headers(),
    )
    assert response.status_code == 202
    body = response.get_json()
    assert body["ok"] is True
    assert body["task_id"]
    mock_executor.submit.assert_called_once()
    mock_publish.assert_called_once()


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("abc", None),
        (-5, None),
        (250, None),
        (10, 10),
    ],
)
@patch("server._GENERATION_EXECUTOR")
@patch("server._publish_task_state")
@patch("server.MAX_CONCURRENT_GENERATIONS", 2)
@patch("server.MAX_QUEUED_GENERATIONS", 4)
@patch("server._active_generations", 0)
@patch("server._queued_generations", 0)
def test_level_progress_percent_is_backward_compatible_and_coerced(
    mock_publish,
    mock_executor,
    client,
    value,
    expected,
):
    payload = _valid_payload()
    if value is not None:
        payload["level_progress_percent"] = value

    response = client.post(
        "/generate-async-v2",
        json=payload,
        headers=_auth_headers(),
    )

    assert response.status_code == 202
    submit_args = mock_executor.submit.call_args.args
    assert submit_args[-1] == expected


def test_v2_pack_log_includes_ramp_stage_and_challenge_band(capsys):
    from server import _log_v2_pack

    _log_v2_pack(
        task_id="task-1",
        status="success",
        attempts=1,
        usage={},
        latency_s=1.0,
        level="L2",
        pack={"activities": []},
        rank_points=42,
        level_progress_percent=80,
    )

    output = capsys.readouterr().out
    assert "ramp_stage=late" in output
    assert "challenge_band=C3" in output
