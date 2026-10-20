import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { repoRoot } from "../guardFiles";
import { testStartLine } from "./testStartLine";

/**
 * The test-start log that names a stalled test (#1152): the line format, the
 * CI wiring that turns it on and bounds the step, and a real vitest run in a
 * scratch project whose test spins in one synchronous call.
 */
const read = (rel: string) => readFileSync(resolve(repoRoot, rel), "utf8");

describe("testStartLine", () => {
  it("names the file and the suites and test, with the time and the worker's pid", () => {
    expect(testStartLine("a.test.ts", ["group", "case"], new Date("2026-10-20T17:03:09Z"), 4242)).toBe(
      "[17:03:09 pid 4242] test start a.test.ts > group > case\n",
    );
  });
});

describe("CI wiring for the stall log", () => {
  const workflows: Array<[string, string]> = [
    [".github/workflows/test.yml", "Host suites on the WASM engine"],
    [".github/workflows/engine-rs.yml", "Conformance through the binding"],
  ];

  for (const [file, name] of workflows) {
    it(`${file}: the "${name}" step has a time limit under the job's and the start log on`, () => {
      const text = read(file);
      const at = text.indexOf(`- name: ${name}`);
      expect(at).toBeGreaterThan(0);
      const rest = text.slice(at + 1);
      const next = rest.search(/\n {6}- /);
      const step = rest.slice(0, next < 0 ? undefined : next);
      const limit = Number(/^ {8}timeout-minutes: (\d+)$/m.exec(step)?.[1]);
      expect(limit).toBeGreaterThan(0);
      expect(limit).toBeLessThanOrEqual(15);
      expect(step).toMatch(/VC_LOG_TEST_STARTS: "1"/);
      expect(step).toMatch(/run: npm run test:wasm$/m);
    });
  }

  it(".github/workflows/test.yml: the WASM parity step turns the start log on, so its worker setup file is not inert", () => {
    const text = read(".github/workflows/test.yml");
    const at = text.indexOf("- name: Run ${{ matrix.project }} on the WASM engine");
    expect(at).toBeGreaterThan(0);
    const rest = text.slice(at + 1);
    const next = rest.search(/\n {6}- /);
    const step = rest.slice(0, next < 0 ? undefined : next);
    expect(step).toMatch(/VC_REQUIRE_WASM: "1"/);
    expect(step).toMatch(/VC_LOG_TEST_STARTS: "1"/);
  });

  it("the vitest projects that run the engine tests load the setup file", () => {
    const config = read("vite.config.ts");
    expect(config).toContain('const setupFiles = ["src/tests/viewWorldSetup.ts", "src/tests/parity/wasmHostSetup.ts", "src/tests/ci/testStartLogSetup.ts"]');
    expect(config).toMatch(/name: "integration",\s+include: \["src\/\*\*\/\*\.integration\.test\.ts"\],\s+setupFiles: \["src\/tests\/viewWorldSetup\.ts", "src\/tests\/ci\/testStartLogSetup\.ts"\]/);
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
