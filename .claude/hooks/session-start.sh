#!/bin/bash
# Claude Code cloud sessions (claude.ai/code and project threads): set up the
# toolchain CI uses with the shared agent setup, then hand its PATH and
# Playwright variables to the session's shells. Local sessions keep their own
# setup, so this does nothing outside the cloud. See tools/agent-env/README.md.
set -uo pipefail
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
AGENT_ENV_FILE="${CLAUDE_ENV_FILE:-}" bash tools/agent-env/setup.sh
exit 0
