import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { repoRoot } from "../guardFiles";
import { testStartLine } from "./testStartLine";

/** The test-start log identifies stalled tests; verify actual output. */

describe("testStartLine", () => {
  it("names the file and the suites and test, with the time and the worker's pid", () => {
    expect(testStartLine("a.test.ts", ["group", "case"], new Date("2026-10-20T17:03:09Z"), 4242)).toBe(
      "[17:03:09 pid 4242] test start a.test.ts > group > case\n",
    );
  });
});

describe("the log in a real run", () => {
  it("writes a test's line before its body runs, so a run killed mid-stall still names it", async () => {
    const dir = mkdtempSync(resolve(tmpdir(), "start-log-"));
    try {
      const setup = resolve(repoRoot, "src/tests/ci/testStartLogSetup.ts");
      writeFileSync(resolve(dir, "vitest.config.mjs"), `export default { test: { include: ['*.test.mjs'], setupFiles: [${JSON.stringify(setup)}] } };\n`);
      writeFileSync(
        resolve(dir, "spin.test.mjs"),
        `import { describe, it } from "vitest";
describe("group", () => {
  it("quick one", () => {});
  it("spins in one call", () => { const end = Date.now() + 14000; while (Date.now() < end); });
});
`,
      );
      // The run is killed as soon as the spinning test's line appears (its own group dies with it), which is the stall the log exists for; the spin only bounds a failure.
      const child = spawn(process.execPath, [resolve(repoRoot, "node_modules/vitest/vitest.mjs"), "run", "--root", dir, "--config", resolve(dir, "vitest.config.mjs")], {
        env: { ...process.env, VC_LOG_TEST_STARTS: "1" },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      const seen = new Promise<void>((done) => {
        const take = (chunk: Buffer) => {
          out += chunk.toString("utf8");
          if (out.includes("spins in one call")) done();
        };
        child.stdout.on("data", take);
        child.stderr.on("data", take);
        child.on("exit", () => done());
      });
      const timer = setTimeout(() => process.kill(-child.pid!, "SIGKILL"), 20_000);
      await seen;
      clearTimeout(timer);
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        // already gone
      }
      const starts = out.split("\n").filter((l) => l.includes("test start"));
      expect(starts.map((l) => l.replace(/^\[[\d:]+ pid \d+\] /, ""))).toEqual([
        "test start spin.test.mjs > group > quick one",
        "test start spin.test.mjs > group > spins in one call",
      ]);
      expect(starts.every((l) => /^\[\d\d:\d\d:\d\d pid [1-9]\d*\] /.test(l))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
