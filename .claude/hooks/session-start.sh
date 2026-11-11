#!/bin/bash
# Claude Code cloud sessions (claude.ai/code and project threads): set up the
# toolchain CI uses with the shared agent setup, then hand its PATH and
# Playwright variables to the session's shells. Local sessions keep their own
# setup, so this does nothing outside the cloud. See tools/agent-env/README.md.
#
# The checkout's .claude/settings.json runs it plain. --user is the copy that
# tools/agent-env/claude-user.mjs registers in ~/.claude/settings.json for
# sessions that start above the checkout; it steps aside when the session
# started inside the checkout, where the plain hook already runs.
set -uo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
root="$(cd "$(dirname "$0")/../.." && pwd)" || exit 0
if [ "${1:-}" = "--user" ] && [ -n "${CLAUDE_PROJECT_DIR:-}" ]; then
  project="$(cd "$CLAUDE_PROJECT_DIR" 2>/dev/null && pwd)"
  case "$project/" in "$root/"*) exit 0 ;; esac
fi
AGENT_ENV_FILE="${CLAUDE_ENV_FILE:-}" bash "$root/tools/agent-env/setup.sh"
exit 0
