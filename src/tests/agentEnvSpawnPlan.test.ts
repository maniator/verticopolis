import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type SpawnPlan = (command: string, args: string[], platform?: string) => { command: string; args: string[]; shell: boolean };

// The MCP launchers in tools/agent-env share this helper; a Windows path with a
// space (the default Node install) must stay one argument (PR #1910 review).
const { spawnPlan } = (await import(pathToFileURL(resolve(__dirname, "../../tools/agent-env/spawn-plan.mjs")).href)) as { spawnPlan: SpawnPlan };

describe("agent-env spawnPlan", () => {
  it("runs a command given as a path without a shell, on Windows too", () => {
    const node = "C:\\Program Files\\nodejs\\node.exe";
    const args = ["C:\\Users\\a b\\cli.js", "--headless"];
    expect(spawnPlan(node, args, "win32")).toEqual({ command: node, args, shell: false });
  });

  it("quotes arguments with spaces when Windows needs a shell for npx", () => {
    const plan = spawnPlan("npx", ["-y", "pkg@1.0.0", "--executablePath", "C:\\Program Files\\Chrome\\chrome.exe"], "win32");
    expect(plan.shell).toBe(true);
    expect(plan.args).toEqual(["-y", "pkg@1.0.0", "--executablePath", '"C:\\Program Files\\Chrome\\chrome.exe"']);
  });

  it("quotes cmd metacharacters for the Windows shell", () => {
    expect(spawnPlan("npx", ["C:\\R&D\\chrome.exe", "a|b", "plain"], "win32").args).toEqual(['"C:\\R&D\\chrome.exe"', '"a|b"', "plain"]);
  });

  it("never uses a shell off Windows", () => {
    expect(spawnPlan("npx", ["a b"], "linux")).toEqual({ command: "npx", args: ["a b"], shell: false });
  });
});
