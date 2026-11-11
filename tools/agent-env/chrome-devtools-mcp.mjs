#!/usr/bin/env node
// Starts the Chrome DevTools MCP server for .mcp.json (stdio). It records
// performance traces, CPU and memory profiles and Lighthouse audits, which the
// hot-path checklist and frame-time work need and the Playwright MCP cannot
// produce. Point it at `npm run dev` (port 5173) or `npm run preview` (4173).
//
// Everything that would leave the machine is off: Google usage statistics,
// CrUX field-data lookups for trace URLs, and the npm update check. Change
// those only with an owner decision (party round 2026-11-11).
//
// The browser: VC_CHROME_PATH, else PW_CHROMIUM_PATH, else the preinstalled
// Chromium of a cloud sandbox, else the server's own choice (the stable Chrome
// installed on a person's machine). Headless where there is no display. Extra
// arguments pass through to the server (`--help` lists them).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnPlan } from "./spawn-plan.mjs";

const MCP_PACKAGE = "chrome-devtools-mcp@1.12.0";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const extra = process.argv.slice(2);

// tools/agent-env/setup.sh installs the package here (the same name rule).
const installDir = join(homedir(), ".cache", "vc-agent", MCP_PACKAGE.replace(/[@/]/g, "_"));
const installedCli = join(installDir, "node_modules", "chrome-devtools-mcp", "build", "src", "bin", "chrome-devtools-mcp.js");

const env = { ...process.env, CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1", CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1" };
// One client per server (stdio), so page tools need no pageId.
const args = ["--no-usage-statistics", "--no-performance-crux", "--isolated", "--no-page-id-routing"];

const chrome =
  process.env.VC_CHROME_PATH ||
  process.env.PW_CHROMIUM_PATH ||
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : "");
if (chrome) args.push("--executablePath", chrome);
if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) args.push("--headless");
// Chromium refuses its sandbox as root (cloud sandboxes run as root).
if (process.getuid?.() === 0) args.push("--chrome-arg=--no-sandbox");

const [command, commandArgs] = existsSync(installedCli)
  ? [process.execPath, [installedCli, ...args, ...extra]]
  : ["npx", ["-y", MCP_PACKAGE, ...args, ...extra]];
const plan = spawnPlan(command, commandArgs);
const child = spawn(plan.command, plan.args, { stdio: "inherit", env, cwd: root, shell: plan.shell });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
