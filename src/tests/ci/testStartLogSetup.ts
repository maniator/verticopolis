import { writeSync } from "node:fs";
import { beforeEach } from "vitest";
import { testStartLine } from "./testStartLine";

/**
 * With `VC_LOG_TEST_STARTS=1` (set on the CI steps that run the engine
 * through the WASM binding) every test writes one line to stderr as it begins.
 * `writeSync` goes out before the test body runs, so a step cut off at its
 * time limit, with the worker stuck in a synchronous call, still shows the
 * last test it started (#1152).
 */
if (process.env.VC_LOG_TEST_STARTS === "1") {
  beforeEach(({ task }) => {
    const names: string[] = [];
    for (let t: { name: string; suite?: unknown } | undefined = task; t; t = t.suite as typeof t) {
      if (t.name) names.unshift(t.name);
    }
    writeSync(2, testStartLine(task.file?.name ?? "?", names, new Date()));
  });
}
