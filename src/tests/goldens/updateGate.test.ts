import { describe, expect, it, vi } from "vitest";
import type { RunnerTask } from "vitest";
import { finishWritingRun, testsNotPassed } from "./updateGate";

type State = "pass" | "fail" | "skip" | "todo";

/** A test as the runner reports it: `ran` is the state its result carries,
 *  and a test the run left out (a `-t` filter, a skip, a todo) has no result. */
const test = (name: string, mode: "run" | "skip" | "todo", ran?: State) => ({ type: "test", name, mode, ...(ran ? { result: { state: ran } } : {}) });
const suite = (name: string, tasks: unknown[], ran?: State) => ({ type: "suite", name, mode: "run", tasks, ...(ran ? { result: { state: ran } } : {}) });

describe("the refresh gate's list of tests that did not pass", () => {
  it("names every test but the ones that passed, with its suites and state", () => {
    // The runner names the file suite by the file's path, so each entry
    // starts with it.
    const file = {
      ...suite("src/some.test.ts", [
        test("passes", "run", "pass"),
        test("fails", "run", "fail"),
        test("filtered out", "skip"),
        test("not written yet", "todo"),
        suite("a group", [test("passes too", "run", "pass"), suite("inner", [test("skipped inside", "skip")])]),
      ]),
      filepath: "/repo/src/some.test.ts",
    } as unknown as RunnerTask;
    expect(testsNotPassed(file)).toEqual([
      "src/some.test.ts > fails (fail)",
      "src/some.test.ts > filtered out (skip)",
      "src/some.test.ts > not written yet (todo)",
      "src/some.test.ts > a group > inner > skipped inside (skip)",
    ]);
  });

  it("is empty when every test ran and passed", () => {
    const file = { ...suite("src/x.test.ts", [test("one", "run", "pass"), suite("group", [test("two", "run", "pass")])]), filepath: "/repo/src/x.test.ts" } as unknown as RunnerTask;
    expect(testsNotPassed(file)).toEqual([]);
  });
});

describe("the refresh gate's list, for a suite whose own hook failed", () => {
  it("names a nested suite that failed even when its tests passed", () => {
    const file = { ...suite("src/y.test.ts", [suite("group", [test("one", "run", "pass")], "fail")], "pass"), filepath: "/repo/src/y.test.ts" } as unknown as RunnerTask;
    expect(testsNotPassed(file)).toEqual(["src/y.test.ts > group (suite fail)"]);
  });
});

describe("the end of a writing run", () => {
  const passing = { ...suite("src/w.test.ts", [test("one", "run", "pass")]), filepath: "/repo/src/w.test.ts" } as unknown as RunnerTask;
  const failing = { ...suite("src/w.test.ts", [test("one", "run", "fail")]), filepath: "/repo/src/w.test.ts" } as unknown as RunnerTask;
  const nested = suite("group", [test("one", "run", "pass")]) as unknown as RunnerTask;
  const run = (writing: boolean, task: RunnerTask, missing: string[] = []) => {
    const write = vi.fn();
    const unfinished = vi.fn(() => missing);
    let error: unknown;
    try {
      finishWritingRun("frame-day golden", writing, unfinished, write, task);
    } catch (e) {
      error = e;
    }
    return { write, unfinished, error: error instanceof Error ? error.message : undefined };
  };

  it("writes once when writing is on, every test passed and every case finished", () => {
    const r = run(true, passing);
    expect(r.error).toBeUndefined();
    expect(r.unfinished).toHaveBeenCalledOnce();
    expect(r.write).toHaveBeenCalledOnce();
  });

  it("writes nothing and checks nothing when writing is off", () => {
    const r = run(false, failing, ["a"]);
    expect(r.error).toBeUndefined();
    expect(r.unfinished).not.toHaveBeenCalled();
    expect(r.write).not.toHaveBeenCalled();
  });

  it("refuses a call below the file before it reads the switch", () => {
    for (const writing of [false, true]) {
      const r = run(writing, nested);
      expect(r.error).toBe("writeAfterPassingRun for the frame-day golden belongs at the top level of the test file");
      expect(r.write).not.toHaveBeenCalled();
    }
  });

  it("refuses to write when a test did not pass, naming it", () => {
    const r = run(true, failing);
    expect(r.error).toBe("frame-day golden NOT written; every test in the file has to run and pass, and these did not: src/w.test.ts > one (fail)");
    expect(r.unfinished).not.toHaveBeenCalled();
    expect(r.write).not.toHaveBeenCalled();
  });

  it("refuses to write when a case did not finish, naming it", () => {
    const r = run(true, passing, ["case-a", "case-b"]);
    expect(r.error).toBe("frame-day golden NOT written; these cases did not finish: case-a, case-b");
    expect(r.write).not.toHaveBeenCalled();
  });
});
