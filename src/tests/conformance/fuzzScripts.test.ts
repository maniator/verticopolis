import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "./scenario";

/**
 * The exit codes of the two fuzz scripts. The corpus job is a required check,
 * so a script that stops loading or turns a harness failure into exit 0 would
 * pass the gate green without replaying anything.
 */

const dir = mkdtempSync(join(tmpdir(), "vc-fuzz-scripts-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(script: string, args: string[], fuzzBin: string): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", resolve(REPO_ROOT, "scripts", script), ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, VC_FUZZ_BIN: fuzzBin },
    timeout: 60_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Any existing file stands in for the fuzzer when the script stops before it would be run. */
const present = process.execPath;
const missing = join(dir, "no-such-fuzzer");

describe("scripts/fuzz-corpus.ts", () => {
  it("exits 2 with the usage line on a bad budget", () => {
    const r = run("fuzz-corpus.ts", ["--budget", "0"], present);
    expect(r.code).toBe(2);
    expect(r.out).toContain("usage: fuzz-corpus");
  });

  it("exits 3 when there is no fuzzer, rather than passing on nothing", () => {
    const r = run("fuzz-corpus.ts", [], missing);
    expect(r.code).toBe(3);
    expect(r.out).toContain("HARNESS:");
  });

  // A stand-in fuzzer that fails with a chosen code, to see the code the job exits with.
  const failing = (code: number, message: string): string => {
    const path = join(dir, `fuzz-exit-${code}`);
    writeFileSync(path, `#!/bin/sh\necho "${message}" >&2\nexit ${code}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  const posix = process.platform !== "win32";

  it.skipIf(!posix)("exits 1 when the Rust engine panics on every entry", () => {
    const r = run("fuzz-corpus.ts", [], failing(101, "thread 'main' panicked at x.rs:1:1:\nboom"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("panicked");
  });

  it.skipIf(!posix)("exits 1 when the Rust engine refuses every entry", () => {
    expect(run("fuzz-corpus.ts", [], failing(1, "refused")).code).toBe(1);
  });

  it.skipIf(!posix)("exits 3 when the fuzzer fails in a way that is not the engine's", () => {
    expect(run("fuzz-corpus.ts", [], failing(7, "bad input")).code).toBe(3);
  });
});

describe("scripts/fuzz-shrink.ts", () => {
  it("exits 2 with the usage line and no arguments", () => {
    const r = run("fuzz-shrink.ts", [], present);
    expect(r.code).toBe(2);
    expect(r.out).toContain("usage: fuzz-shrink");
  });

  it("exits 2 on a name that is not a corpus name", () => {
    expect(run("fuzz-shrink.ts", ["in.json", "../escape"], present).code).toBe(2);
    expect(run("fuzz-shrink.ts", ["in.json", "ok-name", "--max-tests", "0"], present).code).toBe(2);
  });

  it("exits 3 when there is no fuzzer", () => {
    expect(run("fuzz-shrink.ts", ["in.json", "ok-name"], missing).code).toBe(3);
  });

  it("exits 2 on a name that is taken", () => {
    expect(run("fuzz-shrink.ts", ["in.json", "sell-ground-lobby"], present).code).toBe(2);
  });

  it("exits 2 on an input that is missing or is not a scenario", () => {
    expect(run("fuzz-shrink.ts", [join(dir, "absent.json"), "ok-name"], present).code).toBe(2);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    expect(run("fuzz-shrink.ts", [bad, "ok-name"], present).code).toBe(2);
    writeFileSync(bad, '{"id":"x"}');
    expect(run("fuzz-shrink.ts", [bad, "ok-name"], present).code).toBe(2);
  });
});
