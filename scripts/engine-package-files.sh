#!/usr/bin/env sh
# Finishes the engine's npm package in DIR, which already holds the built
# node/ and web/ trees: adds the package's own README, the browser build's
# declarations, the license and the engine changelog, and writes package.json.
# release-tag.yml runs it for each new crate release; the packed tarball goes
# on the engine-v<version> GitHub release, and engine-publish.yml publishes
# that same tarball to npm as @verticopolis/engine.
#
#   scripts/engine-package-files.sh DIR VERSION REPO [CHANGELOG]
#
# CHANGELOG defaults to engine-rs/CHANGELOG.md. Run from the repository root.
set -eu
dir="$1"
version="$2"
repo="$3"
changelog="${4:-engine-rs/CHANGELOG.md}"

if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "::error::Engine version $version is not a plain x.y.z." >&2
  exit 1
fi
if [ ! -d "$dir/node" ] || [ ! -d "$dir/web" ]; then
  echo "::error::$dir needs the built node/ and web/ trees first." >&2
  exit 1
fi

cp packages/verticopolis-engine/web.d.ts "$dir/web/verticopolis_engine.d.ts"
cp packages/verticopolis-engine/README.md "$dir/README.md"
cp "$changelog" "$dir/CHANGELOG.md"
cp LICENSE "$dir/LICENSE"

VERSION="$version" GH_REPO="$repo" DIR="$dir" node -e '
  const e = process.env;
  const pkg = {
    name: "@verticopolis/engine",
    version: e.VERSION,
    description: "The Verticopolis simulation engine as WebAssembly: node/ for Node, web/ for the browser.",
    license: "MIT",
    repository: { type: "git", url: `git+https://github.com/${e.GH_REPO}.git`, directory: "engine-rs" },
    homepage: "https://docs.verticopolis.com/javascript/",
    bugs: { url: `https://github.com/${e.GH_REPO}/issues` },
    keywords: ["verticopolis", "simulation", "game-engine", "webassembly", "wasm", "tower"],
    main: "node/verticopolis_engine.js",
    types: "node/verticopolis_engine.d.ts",
    files: ["node", "web", "CHANGELOG.md"],
    publishConfig: { registry: "https://registry.npmjs.org/", access: "public", provenance: true },
  };
  require("fs").writeFileSync(`${e.DIR}/package.json`, JSON.stringify(pkg, null, 2) + "\n");'
echo "@verticopolis/engine"
