"""Pytest configuration for Read2Lead backend tests."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API_DIR = ROOT / "api"

# Make api/ importable for tests
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))
