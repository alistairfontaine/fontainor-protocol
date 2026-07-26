#!/bin/sh
# loop.sh — reference fresh-context loop (Ralph pattern) with guards.
# Usage: ./loop.sh [max_iterations]   (default 20)
#
# Requires in the working repo:
#   PROMPT.md      — standing instructions, re-fed every iteration. Must tell
#                    the agent to: read state files, do ONE task, verify,
#                    commit, update progress.md, and print DONE_ALL when
#                    features.json is fully green.
#   AGENT_CMD env  — the agent invocation, e.g. 'claude -p' or 'codex exec'.
#
# Stops on: completion marker, max iterations, or two consecutive
# iterations with no new commit (stall).

set -u
MAX_ITER="${1:-20}"
AGENT_CMD="${AGENT_CMD:?set AGENT_CMD, e.g. AGENT_CMD='claude -p'}"
MARKER="DONE_ALL"
stall=0
i=0

while [ "$i" -lt "$MAX_ITER" ]; do
  i=$((i + 1))
  before=$(git rev-parse HEAD 2>/dev/null || echo none)
  echo "=== iteration $i/$MAX_ITER ==="

  out=$($AGENT_CMD <PROMPT.md 2>&1) || echo "agent exited non-zero (continuing)"
  printf '%s\n' "$out" | tail -20

  case "$out" in
    *"$MARKER"*) echo "completion marker seen — verifying"; break ;;
  esac

  after=$(git rev-parse HEAD 2>/dev/null || echo none)
  if [ "$before" = "$after" ]; then
    stall=$((stall + 1))
    echo "no new commit (stall $stall/2)"
    [ "$stall" -ge 2 ] && { echo "STALLED — stopping for human review"; exit 2; }
  else
    stall=0
  fi
done

# Trust the checks, not the marker: final verification gate.
if [ -x ./verify.sh ]; then
  if ./verify.sh; then
    echo "VERIFIED green"
  else
    echo "marker/iterations hit but checks FAIL"
    exit 1
  fi
fi
