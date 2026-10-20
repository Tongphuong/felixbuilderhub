#!/usr/bin/env bash
# Opt-in bite test (i): TODAY's navy home must FAIL the real home-first-visit contract.
# Needs: npm run build (dist/), the v105 Worker candidate, Elon's contracts folder.
# IMPORTANT: dist/ must be a genuinely NAVY (pre-redesign) build. Run it against a dist built from a redesigned tree and the "today's
# navy home must FAIL" bite is meaningless (it would test the new look against itself).
# Composites land in $DESIGN_OUT (default: ./design-bite-out).
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${DESIGN_OUT:-$PWD/design-bite-out}"
DESIGN_BITE_NAVY=1 DESIGN_OUT="$OUT" node --test --test-name-pattern="REAL navy" tests/design-fidelity.test.mjs
echo "composites: $OUT"
