/**
 * The seeded differential's WASM leg (`scripts/fuzz-compare.ts`): the shipped
 * build, driven through the binding in Node, must reproduce every fuzz corpus
 * entry's golden, the native Rust run's checkpoints and detail record (money,
 * log, every save field, fx slots) pinned under
 * `conformance/fuzz-corpus/goldens/`. This pins the WASM runner's adapter: a
 * wrong detail field here would read as a wasm32 divergence on a night where
 * there is none, or hide a real one. The native half of the same check is the
 * corpus job (`scripts/fuzz-corpus.ts`), which needs the fuzzer binary.
 *
 * Runs in `npm run test:wasm` (the required wasm-parity checks), where a missing package fails it
 * under `VC_REQUIRE_WASM=1`; a plain `npm test` skips it without the package and runs it with one.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CheckpointDetail } from "../conformance/checkpointDetail";
import { corpusFiles, goldenDir, goldenFiles } from "../conformance/fuzzCorpus";
import { replayCompare } from "../conformance/fuzzReplay";
import { hasWasmPackage, wasmRequired } from "../conformance/wasmEngine";

const run = hasWasmPackage() || wasmRequired();
const dir = mkdtempSync(join(tmpdir(), "vc-fuzz-wasm-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Copy an entry and its golden into the scratch folder, with the golden's
 *  detail edited by `tweak`; returns the copied scenario's path. */
function withEditedGolden(file: string, tweak: (d: CheckpointDetail[]) => void): string {
  const stem = basename(file).replace(/\.json$/, "");
  const [checkpoints, detail] = goldenFiles(stem);
  const copy = join(dir, basename(file));
  copyFileSync(file, copy);
  copyFileSync(join(goldenDir(), checkpoints), join(dir, checkpoints));
  const details = JSON.parse(readFileSync(join(goldenDir(), detail), "utf8")) as CheckpointDetail[];
  tweak(details);
  writeFileSync(join(dir, detail), JSON.stringify(details));
  return copy;
}

describe.runIf(run)("the WASM leg of the seeded differential", () => {
  it("has the package it needs (a required run fails here rather than skipping)", () => {
    expect(hasWasmPackage()).toBe(true);
  });

  for (const file of corpusFiles()) {
    it(`${basename(file)}: the WASM build reproduces the native golden`, () => {
      const r = replayCompare(file, goldenDir());
      expect(r, r.status === "ok" ? "" : r.message).toMatchObject({ status: "ok" });
      expect(r.status === "ok" && r.checkpoints).toBeGreaterThanOrEqual(2);
      // The golden is not empty: the log carries entries and the save its fields.
      const [, detail] = goldenFiles(basename(file).replace(/\.json$/, ""));
      const details = JSON.parse(readFileSync(join(goldenDir(), detail), "utf8")) as CheckpointDetail[];
      const last = details[details.length - 1];
      expect(last.log.count).toBeGreaterThan(0);
      expect(Object.keys(last.save).length).toBeGreaterThan(5);
    });
  }

  it("names a money, a log and a save-field difference with the WASM label", () => {
    const first = corpusFiles()[0];
    const money = replayCompare(withEditedGolden(first, (d) => { d[d.length - 1].money += 1; }), dir);
    expect(money).toMatchObject({ status: "diverged", signature: "money" });
    const log = replayCompare(withEditedGolden(first, (d) => { d[d.length - 1].log.digest = "x"; }), dir);
    expect(log).toMatchObject({ status: "diverged", signature: "log:digest" });
    const save = replayCompare(withEditedGolden(first, (d) => { d[d.length - 1].save.clock = "x"; }), dir);
    expect(save).toMatchObject({ status: "diverged", signature: "save:clock" });
    expect(save.status === "diverged" && save.message).toContain("WASM");
  });
});
