# Agent environment

One setup for every coding agent's Linux sandbox, so an agent can run the four
quality gates, the Rust gates, the engine build, e2e, and the screenshot
gallery in the pinned Playwright image without waiting on CI.

| File | What it does |
| --- | --- |
| `setup.sh` | Installs Node at the `.nvmrc` version, runs `npm ci`, installs Rust at the engine's `rust-version` (rustfmt, clippy, wasm32) as the default, builds the engine WASM package through `scripts/build-engine-wasm.sh` (pinned, checksummed wasm-bindgen), installs the Playwright and Chrome DevTools MCP servers (pinned), starts `dockerd` and pulls the pinned Playwright image in the background. Each step skips work already done. |
| `pinned.sh` | Runs the screenshot gallery (`screenshots`), the visual baselines (`baselines`) or any command (`run '<cmd>'`) inside the pinned image, the way CI does. |
| `playwright-mcp.mjs` | Starts the Playwright MCP server for `.mcp.json`: inside the pinned image with its Chromium when Docker has the image (starting `dockerd` first when it is down), otherwise on the host. |
| `chrome-devtools-mcp.mjs` | Starts the Chrome DevTools MCP server for `.mcp.json` on the host, with every outbound report turned off. |
| `claude-user.mjs` | Registers the session hook and both MCP servers with Claude Code at user scope (`~/.claude/settings.json`, `~/.claude.json`), for sessions that start above the checkout. `setup.sh --claude-user` runs it. |

`setup.sh` writes `export` lines to `$AGENT_ENV_FILE` when that is set:
`PATH` (the Node it installed), `PW_CHROMIUM_PATH` (a preinstalled Chromium
for host e2e, which `playwright.config.ts` reads) and `VC_PLAYWRIGHT_IMAGE`.
Logs go to `$TMPDIR/vc-agent-setup/`.

## Each agent

- **Claude Code cloud sessions** (claude.ai/code and project threads):
  `.claude/settings.json` runs `.claude/hooks/session-start.sh` at every
  session start, which runs `setup.sh` and passes its exports to the session.
  It does nothing in a local session. `.mcp.json` adds the Playwright and
  Chrome DevTools MCP servers, and `enabledMcpjsonServers` in the same
  settings file approves them.
  The first start in a fresh container takes two to four minutes (most of it
  the engine build); a resume takes about a second.
- **Claude Code project threads** start in the folder above the checkouts, so
  they never read this repository's `.claude/` or `.mcp.json`. Set the
  environment's setup script (Project settings, Cloud environment) to

  ```sh
  if [ -d verticopolis ]; then bash verticopolis/tools/agent-env/setup.sh --claude-user; fi
  ```

  It does everything above while the container is built, waits for the pinned
  image, and registers the same hook (as `.claude/hooks/session-start.sh
  --user`) and both MCP servers at user scope, so every session in that
  container gets Node 26 on `PATH`, `dockerd` and the servers. Its
  exports also go to `/etc/profile.d/vc-agent-env.sh`, which the first line of
  `~/.bashrc` sources: Debian's `~/.bashrc` returns early outside an
  interactive shell, so a line appended there misses scripts. An agent's tool
  shell reads no profile at all and finds the container's own Node first
  (`/opt/node22/bin`), so `--claude-user` also points the `node`, `npm` and
  `npx` in a `/opt/<name>/bin` folder on `PATH` at the `.nvmrc` Node, keeping
  each original as `<name>.vc-agent-orig`. Claude Code itself is a native
  binary and does not use them. The user
  hook steps aside when a session starts inside the checkout, where the
  repository's own hook runs. `setup.sh` takes a lock, so two hooks never
  race.
- **Codex** (and any other Linux sandbox with a setup-script field): set the
  environment's setup script to
  `AGENT_ENV_FILE=$HOME/.bashrc bash tools/agent-env/setup.sh`, so later
  shells pick up the Node it installed. Codex reads `AGENTS.md`, which points
  here. Its MCP servers are set in Codex's own configuration, not from
  `.mcp.json`. A sandbox without Docker uses the fallbacks under Screenshots.
- **Copilot coding agent**: `.github/workflows/copilot-setup-steps.yml` builds
  the same pieces with the Actions cache and pulls the pinned image. Copilot
  ships its own Playwright and GitHub MCP servers; other MCP servers are set in
  the repository's Settings, under Copilot, coding agent.
- **A person's Linux machine**: `bash tools/agent-env/setup.sh` works there too
  (Node goes to `/opt`, so run it as a user who can write there, or install the
  `.nvmrc` Node yourself first and the step is skipped).

## Screenshots and visual baselines

```sh
bash tools/agent-env/pinned.sh screenshots              # the whole gallery
bash tools/agent-env/pinned.sh screenshots ONLY=milestones
bash tools/agent-env/pinned.sh baselines                # e2e/visual.spec.ts-snapshots
```

The image is `mcr.microsoft.com/playwright:v<lockfile version>-jammy`, the one
`screenshot-capture.yml` and `update-visual-baselines.yml` resolve. The
checkout is mounted at its own path: the build's source-map check resolves
paths against it, and a short mount such as `/work` fails the build. The
engine package and `node_modules` come from the host, since the image has no
Rust toolchain, and the host's `.nvmrc` Node is mounted in. Output from this
image is equivalent to CI's and may be committed (CLAUDE.md, Screenshots).
Nothing on the host may listen on port 4173 during a render.

Checked on 2026-11-11 in a Claude Code cloud session on `main` at `ec3c098`:
the full gallery rendered in 3 minutes 17 seconds and every PNG matched the
committed set byte for byte.

When the sandbox has no Docker, the fallbacks are CI's: approve the
`commit-on-approval` job on the PR's `pr-drift-check` run for the gallery, and
push an `[update-baselines]` commit for the visual baselines. A host browser
run (`npm run screenshots`) is a preview only and is never committed.

## Playwright MCP server

`playwright-mcp.mjs` pins `@playwright/mcp` (`MCP_PACKAGE`). No release of it
ships the repository's exact Playwright version, so inside the pinned image it
drives the image's Chromium binary with its own, newer Playwright. Browsing,
snapshots and screenshots work; pixels that get committed still come from
`pinned.sh`. With host networking the server reaches `npm run dev` (port 5173)
and `npm run preview` (port 4173) on the host. Set `VC_PLAYWRIGHT_MCP_HOST=1` to
run it on the host instead. On Windows or macOS it always runs on the host,
with Playwright's own browser (`npx playwright install chromium` once).

In the image only the checkout is mounted. A screenshot `filename` that is
relative resolves against the session's folder, which a project thread puts
above the checkout, so the file stays inside the container. Leave `filename`
out (it lands in `.playwright-mcp/`, gitignored) or give a path inside the
checkout.

## Chrome DevTools MCP server

`chrome-devtools-mcp.mjs` pins `chrome-devtools-mcp` (`MCP_PACKAGE`). It adds
what the Playwright server cannot do: performance traces with Core Web Vitals
and insights, heap snapshots, network and console inspection, and Lighthouse
audits. Use it for the hot-path checklist and frame-time work on `npm run dev`
or `npm run preview`, and for Lighthouse runs on other sites. It runs on the
host, with `VC_CHROME_PATH`, then `PW_CHROMIUM_PATH`, then the cloud sandbox's
preinstalled Chromium, else the stable Chrome installed on the machine. Each
start gets a fresh, throwaway profile (`--isolated`). Files it saves (traces,
heap snapshots) go to the system temp folder unless the client shares its
workspace roots with the server.

The launcher turns off everything that would leave the machine: Google usage
statistics, CrUX field-data lookups for trace URLs, and the npm update check.
Turning one back on needs an owner decision. A party round on 2026-11-11 chose
this server and declined Context7, a docs.rs server (both send queries to a
third party and are blocked by the environment network; `node_modules` types
and `cargo doc` give docs for the pinned versions offline) and a Godot server
(native work only, and headless Godot from the shell covers it today).

## Cloud environment settings that cannot live in the repository

These are set in the Claude Code environment (Project settings, Cloud
environment, the gear beside the environment). The repository needs none of
them changed today:

- **Network.** The default "trusted" access with package managers allowed is
  enough. `setup.sh` reaches `nodejs.org`, `registry.npmjs.org`,
  `static.rust-lang.org`, `index.crates.io`, `github.com` (the wasm-bindgen
  release) and `mcr.microsoft.com` (the image). The Playwright browser CDN
  (`cdn.playwright.dev`, `playwright.download.prss.microsoft.com`) is blocked,
  so `npx playwright install` fails; nothing here needs it. Allow those two
  hosts only if you want host e2e on Playwright's own browser build.
- **Secrets and variables.** None needed. The setup script cannot read the
  environment's secrets anyway.
- **MCP servers that need an account** (GitHub, PostHog, Vercel and the like)
  come from the connectors on your claude.ai account, not from this
  repository, so no token is ever committed.
