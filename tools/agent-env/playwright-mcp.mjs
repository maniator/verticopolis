#!/usr/bin/env node
// Starts the Playwright MCP server for .mcp.json (stdio), using the pinned
// browser when it can:
//
//   1. Docker is running and the pinned Playwright image is present (a cloud
//      session after tools/agent-env/setup.sh): the server runs inside that
//      image with the image's own Chromium, the same browser build CI uses for
//      the screenshot gallery. Host networking lets it open the dev server
//      (`npm run dev`, port 5173) or `npm run preview` (port 4173) on the host.
//      It starts dockerd first when it is installed and down (as root).
//   2. Otherwise it runs on the host: with PW_CHROMIUM_PATH when that is set
//      (a cloud session before Docker is up), else Playwright's own browser
//      (a person's machine, where `npx playwright install chromium` fetched it).
//
// VC_PLAYWRIGHT_MCP_HOST=1 forces the host. Extra arguments pass through to
// the server (`--help` lists them).
//
// Note on versions: no @playwright/mcp release ships the repository's exact
// Playwright version, so the server drives the pinned Chromium binary with
// its own, newer Playwright. Browsing and snapshots work; pixels for commits
// still come from tools/agent-env/pinned.sh.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPlan } from "./spawn-plan.mjs";

const MCP_PACKAGE = "@playwright/mcp@0.0.85";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const extra = process.argv.slice(2);

function pinnedImage() {
  try {
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    const version = lock.packages?.["node_modules/playwright"]?.version;
    return version ? `mcr.microsoft.com/playwright:v${version}-jammy` : null;
  } catch {
    return null;
  }
}

function dockerUp() {
  return spawnSync("docker", ["info"], { stdio: "ignore", timeout: 10_000 }).status === 0;
}

// A cloud container keeps no processes between sessions, so dockerd may be
// down when the server starts before (or without) the session hook. As root,
// start it the way setup.sh does and give it a few seconds; otherwise the
// server runs on the host.
function ensureDocker() {
  if (dockerUp()) return true;
  if (process.getuid?.() !== 0 || spawnSync("sh", ["-c", "command -v dockerd"], { stdio: "ignore" }).status !== 0) return false;
  const logDir = join(process.env.TMPDIR || tmpdir(), "vc-agent-setup");
  mkdirSync(logDir, { recursive: true });
  const log = openSync(join(logDir, "dockerd.log"), "a");
  spawn("dockerd", [], { detached: true, stdio: ["ignore", log, log] }).unref();
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < 15; i += 1) {
    Atomics.wait(pause, 0, 0, 1000);
    if (dockerUp()) return true;
  }
  return false;
}

function dockerHasImage(image) {
  // Linux only: Docker Desktop (macOS, Windows) has no host networking by
  // default, so the container could not open the host's dev server.
  if (process.platform !== "linux" || process.env.VC_PLAYWRIGHT_MCP_HOST) return false;
  if (!ensureDocker()) return false;
  const probe = spawnSync("docker", ["image", "inspect", image], { stdio: "ignore", timeout: 10_000 });
  return probe.status === 0;
}

function run(command, args) {
  const plan = spawnPlan(command, args);
  const child = spawn(plan.command, plan.args, { stdio: "inherit", shell: plan.shell });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
}

// tools/agent-env/setup.sh installs the package here (the same name rule).
const installDir = join(homedir(), ".cache", "vc-agent", MCP_PACKAGE.replace(/[@/]/g, "_"));
const installedCli = join(installDir, "node_modules", "@playwright", "mcp", "cli.js");
const installed = existsSync(installedCli);

const image = pinnedImage();
if (installed && image && dockerHasImage(image)) {
  // The image needs no network: the server comes from the host's install.
  const nodeDir = `/opt/node-v${readFileSync(join(root, ".nvmrc"), "utf8").trim()}`;
  // The checkout is mounted at its own path and is the working directory, so
  // uploads can read its files and saved screenshots and snapshots land in
  // .playwright-mcp/ there (gitignored) instead of vanishing with the container.
  const mounts = ["-v", `${root}:${root}`, "-w", root, "-v", `${installDir}:${installDir}:ro`];
  if (existsSync(join(nodeDir, "bin", "node"))) mounts.push("-v", `${nodeDir}:/opt/vc-node:ro`);
  const script = [
    '[ -x /opt/vc-node/bin/node ] && export PATH="/opt/vc-node/bin:$PATH"',
    'chrome="$(ls -d /ms-playwright/chromium-*/chrome-linux*/chrome | head -1)"',
    `exec node "${installedCli}" --headless --no-sandbox --isolated --output-dir "${join(root, ".playwright-mcp")}" --executable-path "$chrome" "$@"`,
  ].join("; ");
  // Run as the calling user, so files it writes into the checkout are theirs.
  const uid = process.getuid?.();
  const user = uid && uid !== 0 ? ["-u", `${uid}:${process.getgid?.()}`, "-e", "HOME=/tmp"] : [];
  run("docker", [
    "run", "--rm", "-i", "--network", "host", "--ipc", "host", ...user, ...mounts,
    image, "bash", "-c", script, "playwright-mcp", ...extra,
  ]);
} else {
  // A preinstalled Chromium (a cloud sandbox), else the repository's own
  // Playwright browser (`npx playwright install chromium`), else the server's.
  let chromium = process.env.PW_CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "");
  if (!chromium) {
    try {
      const repoPlaywright = createRequire(join(root, "package.json"))("playwright");
      const executable = repoPlaywright.chromium.executablePath();
      if (existsSync(executable)) chromium = executable;
    } catch {
      // No repository dependencies: keep the server's own browser.
    }
  }
  const browserArgs = ["--output-dir", join(root, ".playwright-mcp"), "--isolated"];
  // Headed only where there is a display to show it on (a person's desktop).
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) browserArgs.push("--headless");
  // Chromium refuses its sandbox as root (cloud sandboxes run as root).
  if (process.getuid?.() === 0) browserArgs.push("--no-sandbox");
  if (chromium) browserArgs.push("--executable-path", chromium);
  if (installed) run(process.execPath, [installedCli, ...browserArgs, ...extra]);
  else run("npx", ["-y", MCP_PACKAGE, ...browserArgs, ...extra]);
}
