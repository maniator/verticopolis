// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BASELINE_LOCK, acquireBaselineLock, pidAlive } from "./baselineLock";

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});
const repo = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "vc-baseline-lock-"));
  made.push(dir);
  return dir;
};
const lockOf = (r: string): string => join(r, BASELINE_LOCK);

describe("the baseline build lock", () => {
  it("takes the lock, names its holder, and releases it", () => {
    const r = repo();
    const release = acquireBaselineLock(r, { pid: 4242 });
    expect(readFileSync(join(lockOf(r), "pid"), "utf8").trim()).toBe("4242");
    release();
    expect(existsSync(lockOf(r))).toBe(false);
  });

  it("refuses while a live process holds it, naming that process and how to clear a dead lock", () => {
    const r = repo();
    acquireBaselineLock(r, { pid: 4242 });
    const err = () => acquireBaselineLock(r, { pid: 7, alive: (p) => p === 4242 });
    expect(err).toThrow("(process 4242)");
    expect(err).toThrow(`delete ${BASELINE_LOCK} if it died`);
    expect(readFileSync(join(lockOf(r), "pid"), "utf8").trim()).toBe("4242"); // still the holder's
  });

  it("takes over a lock whose holder has died", () => {
    const r = repo();
    acquireBaselineLock(r, { pid: 4242 });
    acquireBaselineLock(r, { pid: 7, alive: () => false });
    expect(readFileSync(join(lockOf(r), "pid"), "utf8").trim()).toBe("7");
  });

  it("waits out a lock that has no holder yet, then takes it over once it is old", () => {
    const r = repo();
    mkdirSync(lockOf(r)); // a crash (or a start) between creating the folder and naming the holder
    const justNow = Date.now();
    expect(() => acquireBaselineLock(r, { now: () => justNow })).toThrow(/another perf run/);
    const longAgo = new Date(justNow - 120_000);
    utimesSync(lockOf(r), longAgo, longAgo);
    acquireBaselineLock(r, { pid: 9, now: () => justNow });
    expect(readFileSync(join(lockOf(r), "pid"), "utf8").trim()).toBe("9");
  });

  it("treats an unreadable holder as no holder", () => {
    const r = repo();
    mkdirSync(lockOf(r));
    writeFileSync(join(lockOf(r), "pid"), "not a pid\n");
    const longAgo = new Date(Date.now() - 120_000);
    utimesSync(lockOf(r), longAgo, longAgo);
    acquireBaselineLock(r, { pid: 11 });
    expect(readFileSync(join(lockOf(r), "pid"), "utf8").trim()).toBe("11");
  });

  it("knows this process is alive and a made-up one is not", () => {
    expect(pidAlive(process.pid)).toBe(true);
    expect(pidAlive(2_147_483_646)).toBe(false);
  });
});
