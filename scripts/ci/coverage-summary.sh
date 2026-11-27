#!/bin/sh
# Writes one test kind's coverage to the CI job summary: its totals, then the changed lines it leaves uncovered.
#   scripts/ci/coverage-summary.sh <unit|server|browser> <heading>
# with CHANGE_RANGE set to base..head. A run that wrote no coverage (it failed early) writes nothing.
set -eu
kind=$1
heading=$2
dir=coverage/$kind
if [ -f "$dir/summary.txt" ]; then
  { echo "### $heading"; echo '```'; cat "$dir/summary.txt"; echo '```'; } >> "$GITHUB_STEP_SUMMARY"
fi
if [ -f "$dir/lcov.info" ]; then
  node scripts/coverage/changed-lines.ts "$dir/lcov.info" "$CHANGE_RANGE" "$kind" | tee -a "$GITHUB_STEP_SUMMARY"
fi
