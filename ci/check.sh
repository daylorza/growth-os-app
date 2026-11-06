#!/usr/bin/env bash
# The one CI pipeline, shared by GitHub Actions (.github/workflows/ci.yml) and GitLab CI (.gitlab-ci.yml).
# Runs from a clean clone: no private/ folder, so the public sample creator is what gets built and tested.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm install --frozen-lockfile
bash ci/no-platform-writes.sh
pnpm -r lint
pnpm -r test
pnpm -r build
