#!/bin/bash
# Run a command inside the pinned Playwright image, the same image CI renders
# the screenshot gallery and the visual baselines in, so the pixels match CI.
#
#   bash tools/agent-env/pinned.sh screenshots [ONLY=scene,ids]
#       VC_TOOLING=1 build, then render docs/screenshots/** with the image's
#       full Chromium (PW_CHROME), as screenshot-capture.yml does.
#   bash tools/agent-env/pinned.sh baselines
#       VC_TOOLING=1 build, then re-mint e2e/visual.spec.ts-snapshots with the
#       image's default browser, as update-visual-baselines.yml does.
#   bash tools/agent-env/pinned.sh run '<command>'
#       Any other command, with PW_CHROME exported.
#   bash tools/agent-env/pinned.sh --image
#       Print the image name and exit.
#
# The image tag comes from the lockfile's Playwright version. The checkout is
# mounted at its own path (the build's source-map checks resolve paths
# relative to it, and a short path such as /work breaks them), with the host's
# node_modules and engine package, and the .nvmrc Node.js from the host when
# tools/agent-env/setup.sh installed it. Build the engine on the host first:
# the image has no Rust toolchain. Nothing else may listen on port 4173.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$PWD"
version="$(node -p 'require("./package-lock.json").packages["node_modules/playwright"].version')"
IMAGE="mcr.microsoft.com/playwright:v${version}-jammy"

mode="${1:-}"
[ $# -gt 0 ] && shift
case "$mode" in
  --image) echo "$IMAGE"; exit 0 ;;
  screenshots)
    cmd='export PW_CHROME; VC_TOOLING=1 npm run build && RUN_SERVER=1 node scripts/screenshots.ts' ;;
  baselines)
    cmd='unset PW_CHROME; VC_TOOLING=1 npm run build && npx playwright test e2e/visual.spec.ts --update-snapshots' ;;
  run)
    [ $# -gt 0 ] || { echo "pinned.sh run: give the command to run" >&2; exit 2; }
    cmd="export PW_CHROME; $1"; shift ;;
  *)
    sed -n '2,16p' "$0" >&2; exit 2 ;;
esac

[ -f src/public/engine/BUILD.json ] || { echo "pinned.sh: no engine package; run bash tools/agent-env/setup.sh or npm run wasm:build first" >&2; exit 1; }
[ -d node_modules ] || { echo "pinned.sh: no node_modules; run npm ci on the host first" >&2; exit 1; }
if (exec 3<>/dev/tcp/127.0.0.1/4173) 2>/dev/null; then
  echo "pinned.sh: something on the host already listens on port 4173; stop it, or the render would shoot the host's build" >&2
  exit 1
fi
docker image inspect "$IMAGE" > /dev/null 2>&1 || docker pull "$IMAGE"

node_dir="/opt/node-v$(tr -d ' \r\n' < .nvmrc)"
node_mount=()
[ -x "$node_dir/bin/node" ] && node_mount=(-v "$node_dir:/opt/vc-node:ro")

# Extra NAME=value arguments pass through as environment (e.g. ONLY=milestones).
env_args=(-e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 -e CI=1)
for kv in "$@"; do env_args+=(-e "$kv"); done

exec docker run --rm --name "vc-pinned-$$" --network host --ipc host \
  -v "$ROOT:$ROOT" -w "$ROOT" "${node_mount[@]}" "${env_args[@]}" "$IMAGE" \
  bash -c 'set -e
    [ -x /opt/vc-node/bin/node ] && export PATH="/opt/vc-node/bin:$PATH"
    git config --global --add safe.directory "$PWD"
    PW_CHROME="$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)"
    [ -x "$PW_CHROME" ] || { echo "pinned.sh: no Chromium under /ms-playwright in the image" >&2; exit 1; }
    echo "pinned.sh: node $(node -v), $PW_CHROME" >&2
    '"$cmd"
