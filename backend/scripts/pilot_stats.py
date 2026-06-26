"""Aggregate pilot stats from Render log.

Usage:
    python scripts/pilot_stats.py path/to/render_log.txt
    cat render_log.txt | python scripts/pilot_stats.py -

Parses [v2-pack] lines emitted by api/server.py:_log_v2_pack and legacy
[pilot] lines, then prints a one-screen summary for weekly pilot review.
"""
from __future__ import annotations

import re
import sys
from collections import Counter
from pathlib import Path

# Windows default console codec (cp1252) can't encode warning glyphs
# like U+26A0. Force UTF-8 so the script runs identically on Windows,
# macOS, Linux. No-op if stdout has no .reconfigure (older Pythons).
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PACK_LINE_RE = re.compile(
    r"\[(?P<tag>pilot|v2-pack)\] "
    r"task=(?P<task>\S+) "
    r"status=(?P<status>\S+) "
    r"attempts=(?P<attempts>\d+) "
    r"provider=(?P<provider>\S*) "
    r"(?:model=(?P<model>\S*) )?"
    r"latency_s=(?P<latency>[\d.]+) "
    r"llm_in=(?P<lin>\d+) "
    r"llm_out=(?P<lout>\d+) "
    r"llm_cost=\$(?P<cost>[\d.]+)"
)


def parse(lines):
    rows = []
    for line in lines:
        match = PACK_LINE_RE.search(line)
        if match:
            data = match.groupdict()
            rows.append({
                "tag": data["tag"],
                "task": data["task"],
                "status": data["status"],
                "attempts": int(data["attempts"]),
                "provider": data["provider"],
                "model": data.get("model") or "",
                "latency": float(data["latency"]),
                "llm_in": int(data["lin"]),
                "llm_out": int(data["lout"]),
                "cost": float(data["cost"]),
            })
    return rows


def summarize(rows):
    if not rows:
        print("No [v2-pack] or [pilot] lines found.")
        return

    count = len(rows)
    success = [row for row in rows if row["status"] == "success"]
    fail_val = [row for row in rows if row["status"] == "failed_validation"]
    fail_exc = [row for row in rows if row["status"] == "failed_exception"]

    success_rate = 100.0 * len(success) / count if count else 0
    avg_attempts = sum(row["attempts"] for row in success) / max(len(success), 1)
    avg_latency = sum(row["latency"] for row in success) / max(len(success), 1)
    total_cost = sum(row["cost"] for row in rows)
    avg_cost_per_success = total_cost / max(len(success), 1)

    provider_counter = Counter(row["provider"] for row in success)
    tag_counter = Counter(row["tag"] for row in rows)
    fallback_count = sum(
        1 for row in success if row["attempts"] == 3 and row["provider"] == "anthropic"
    )
    fallback_rate = 100.0 * fallback_count / max(len(success), 1)

    print(f"\n=== Read2Lead Pilot Stats — {count} task(s) ===\n")
    print(f"  Log tags:           {dict(tag_counter)}")
    print(f"  Success:            {len(success)} / {count} ({success_rate:.0f}%)")
    print(f"  Failed validation:  {len(fail_val)}")
    print(f"  Failed exception:   {len(fail_exc)}")
    print()
    print(f"  Avg attempts to success:  {avg_attempts:.2f}")
    print(f"  Avg latency (success):    {avg_latency:.1f}s")
    print(f"  Anthropic fallback rate:  {fallback_count} / {len(success)} ({fallback_rate:.0f}%)")
    print(f"  Provider distribution:    {dict(provider_counter)}")
    print()
    print(f"  Total LLM cost:           ${total_cost:.4f}")
    print(f"  Avg cost per success:     ${avg_cost_per_success:.4f}")
    print()

    # Quality flags Phuong should investigate.
    if fallback_rate > 20:
        print(f"  ⚠ Fallback rate {fallback_rate:.0f}% > 20% — primary model may not be viable")
    if (len(fail_val) + len(fail_exc)) > 0:
        print(f"  ⚠ {len(fail_val) + len(fail_exc)} pack(s) failed — investigate task IDs:")
        for row in fail_val + fail_exc:
            print(f"      {row['task']}  status={row['status']}")


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/pilot_stats.py {path|-}", file=sys.stderr)
        sys.exit(1)

    arg = sys.argv[1]
    if arg == "-":
        lines = sys.stdin
    else:
        path = Path(arg)
        if not path.exists():
            print(f"File not found: {path}", file=sys.stderr)
            sys.exit(1)
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()

    rows = parse(lines)
    summarize(rows)


if __name__ == "__main__":
    main()
