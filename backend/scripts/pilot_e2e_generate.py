"""Generate pilot validation packs via live hub API and verify lesson audio.

Usage:
    python scripts/pilot_e2e_generate.py

Requires network. Uses known pilot access codes (no secrets).
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field

HUB = "https://felixbuilderhub.com"
POLL_INTERVAL_S = 8
POLL_TIMEOUT_S = 360
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

PACKS = [
    {"label": "L1", "code": "R2L-HOANG-A89Z", "topic": "school"},
    {"label": "L2", "code": "R2L-PILOT-CYJS", "topic": "sports"},
    {"label": "L1-alt", "code": "R2L-KIMMY-5XK8", "topic": "nature"},
]


@dataclass
class PackResult:
    label: str
    code: str
    task_id: str = ""
    status: str = "pending"
    error: str = ""
    lesson_link: str = ""
    pack_id: str = ""
    audio_checks: dict = field(default_factory=dict)
    elapsed_s: float = 0.0


def _request(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
    data = None
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw) if raw else {"error": raw}
        except json.JSONDecodeError:
            payload = {"error": raw or str(exc)}
        return exc.code, payload


def generate_pack(label: str, code: str, topic: str) -> PackResult:
    result = PackResult(label=label, code=code)
    started = time.time()
    status, payload = _request(
        "POST",
        f"{HUB}/api/generate-read2lead-pack",
        {"access_code": code, "topic": topic, "interests": "", "website": ""},
    )
    result.elapsed_s = time.time() - started
    if status != 200 or not payload.get("ok"):
        result.status = "fail"
        result.error = payload.get("message") or payload.get("error") or str(payload)
        return result

    if payload.get("status") == "done":
        result.status = "done"
        result.pack_id = payload.get("pack_id") or ""
        result.lesson_link = payload.get("lesson_link") or ""
        return result

    task_id = payload.get("task_id") or ""
    if not task_id:
        result.status = "fail"
        result.error = "no task_id"
        return result

    result.task_id = task_id
    deadline = time.time() + POLL_TIMEOUT_S
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL_S)
        status, poll = _request(
            "GET",
            f"{HUB}/api/check-generation-status?access_code={code}&task_id={task_id}",
        )
        if status == 200 and poll.get("status") == "done":
            result.status = "done"
            result.pack_id = poll.get("pack_id") or ""
            result.lesson_link = poll.get("lesson_link") or ""
            result.elapsed_s = time.time() - started
            return result
        if status >= 400 or poll.get("ok") is False:
            result.status = "fail"
            result.error = poll.get("message") or poll.get("error") or str(poll)
            result.elapsed_s = time.time() - started
            return result

    result.status = "timeout"
    result.error = f"poll exceeded {POLL_TIMEOUT_S}s"
    result.elapsed_s = time.time() - started
    return result


def verify_lesson_audio(code: str, pack_id: str) -> dict:
    status, payload = _request(
        "GET",
        f"{HUB}/api/read2lead-lesson?code={code}&pack_id={pack_id}",
    )
    if status != 200 or not payload.get("ok"):
        return {"ok": False, "error": payload.get("message") or payload.get("error")}

    lesson = payload.get("lesson") or {}
    activities = lesson.get("activities") or {}
    checks = {"ok": True, "activity_a": 0, "activity_b": 0, "activity_e": 0, "full_audio": bool(lesson.get("full_audio_url"))}
    for key, field in [("A", "activity_a"), ("B", "activity_b"), ("E", "activity_e")]:
        act = activities.get(key) or {}
        items = act.get("items") or act.get("questions") or []
        urls = [i.get("audio_url") for i in items if i.get("audio_url")]
        checks[field] = len(urls)
        if not urls:
            checks["ok"] = False
    return checks


def main() -> int:
    results: list[PackResult] = []
    for spec in PACKS:
        print(f"\n--- {spec['label']} via {spec['code']} ---")
        result = generate_pack(spec["label"], spec["code"], spec["topic"])
        print(f"  status={result.status} elapsed={result.elapsed_s:.0f}s task={result.task_id[:8] if result.task_id else '-'}")
        if result.error:
            print(f"  error: {result.error}")
        if result.status == "done" and result.pack_id:
            result.audio_checks = verify_lesson_audio(result.code, result.pack_id)
            print(f"  audio: {json.dumps(result.audio_checks)}")
            if result.lesson_link:
                print(f"  lesson: {HUB}{result.lesson_link}")
        results.append(result)

    done = sum(1 for r in results if r.status == "done")
    print(f"\n=== SUMMARY {done}/{len(results)} success ===")
    print(json.dumps([r.__dict__ for r in results], indent=2))
    return 0 if done == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
