import { describe, expect, it } from "vitest";
import type { RunnerTask } from "vitest";
import { testsNotPassed } from "./updateGate";

type State = "pass" | "fail" | "skip" | "todo";

/** A test as the runner reports it: `ran` is the state its result carries,
 *  and a test the run left out (a `-t` filter, a skip, a todo) has no result. */
const test = (name: string, mode: "run" | "skip" | "todo", ran?: State) => ({ type: "test", name, mode, ...(ran ? { result: { state: ran } } : {}) });
const suite = (name: string, tasks: unknown[]) => ({ type: "suite", name, mode: "run", tasks });

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
