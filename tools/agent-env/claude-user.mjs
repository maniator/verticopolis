#!/usr/bin/env node
// Registers this checkout's agent setup with Claude Code at user scope, for
// cloud sessions that start above the checkout (a project thread with several
// repositories starts in the folder that holds them). Such a session never
// loads the checkout's .claude/settings.json or .mcp.json, so this writes the
// same two pieces where every session on the machine reads them:
//
//   ~/.claude/settings.json  a SessionStart hook that runs
//                            .claude/hooks/session-start.sh --user (Node on
//                            PATH, dockerd, the Playwright variables)
//   ~/.claude.json           the Playwright and Chrome DevTools MCP servers
//                            (user-scope servers need no approval)
//
// tools/agent-env/setup.sh --claude-user runs it. Rerunning changes nothing;
// other settings and servers in both files are kept.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hookScript = join(root, ".claude", "hooks", "session-start.sh");
const mcpScripts = {
  playwright: join(root, "tools", "agent-env", "playwright-mcp.mjs"),
  "chrome-devtools": join(root, "tools", "agent-env", "chrome-devtools-mcp.mjs"),
};

function readJson(file) {
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.vc-agent-${process.pid}`;
  // Keep the file's mode (~/.claude.json is private to its owner); a new file
  // gets owner-only access too.
  const mode = existsSync(file) ? statSync(file).mode & 0o777 : 0o600;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(tmp, file);
}

// The SessionStart hook. A hook that already names this checkout's hook
// script is replaced, so a changed timeout is picked up; other hooks in its
// group, and the group's other settings, stay.
const settingsFile = join(homedir(), ".claude", "settings.json");
const settings = readJson(settingsFile);
const command = `bash "${hookScript}" --user`;
settings.hooks ??= {};
const others = (settings.hooks.SessionStart ?? []).flatMap((group) => {
  const hooks = (group.hooks ?? []).filter((hook) => !String(hook.command ?? "").includes(hookScript));
  return hooks.length > 0 ? [{ ...group, hooks }] : [];
});
settings.hooks.SessionStart = [...others, { hooks: [{ type: "command", command, timeout: 900 }] }];
writeJson(settingsFile, settings);

// The MCP servers, named like the checkout's .mcp.json entries, so a session
// that starts inside the checkout still sees one server of each. The
// launchers run on the Node that ran this script (setup.sh's .nvmrc Node).
const configFile = join(homedir(), ".claude.json");
const config = readJson(configFile);
config.mcpServers ??= {};
for (const [name, script] of Object.entries(mcpScripts)) {
  config.mcpServers[name] = { type: "stdio", command: process.execPath, args: [script], env: {} };
}
writeJson(configFile, config);

console.error(`agent-setup: registered the session hook in ${settingsFile} and the MCP servers in ${configFile}`);
