/**
 * The seeded differential's WASM leg (`scripts/fuzz-compare.ts --wasm`): the
 * shipped build, driven through the binding in Node, must produce the same
 * checkpoints and the same detail record (money, log, every save field) as
 * the TypeScript engine on the same scenario. The Rust fuzzer writes the
 * native record the nightly compares against, so this pins the third runner's
 * adapter: a wrong detail field here would read as a wasm32 divergence on a
 * night where there is none, or hide a real one.
 *
 * Runs in `npm run test:wasm` (the required wasm-parity checks), where a missing package fails it
 * under `VC_REQUIRE_WASM=1`; a plain `npm test` skips it without the package and runs it with one.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { CheckpointDetail } from "../conformance/checkpointDetail";
import { corpusFiles } from "../conformance/fuzzCorpus";
import { compareRuns } from "../conformance/fuzzCompare";
import { replayCompare } from "../conformance/fuzzReplay";
import { loadScenario, runScenario } from "../conformance/scenario";
import { hasWasmPackage, startWasmEngine, wasmRequired } from "../conformance/wasmEngine";

const run = hasWasmPackage() || wasmRequired();
const dir = mkdtempSync(join(tmpdir(), "vc-fuzz-wasm-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Write the TypeScript run's records beside a copy of the scenario, as the
 *  Rust fuzzer would, edited by `tweak`; returns the scenario's path. */
function withRecords(file: string, tweak?: (d: CheckpointDetail[]) => void): string {
  const scenario = loadScenario(file);
  const details: CheckpointDetail[] = [];
  const checkpoints = runScenario(scenario, undefined, details);
  tweak?.(details);
  const copy = join(dir, basename(file));
  writeFileSync(copy, JSON.stringify(scenario));
  const stem = basename(file).replace(/\.json$/, "");
  writeFileSync(join(dir, `${stem}.rs.json`), JSON.stringify(checkpoints));
  writeFileSync(join(dir, `${stem}.rs.detail.json`), JSON.stringify(details));
  return copy;
}

describe.runIf(run)("the WASM leg of the seeded differential", () => {
  it("has the package it needs (a required run fails here rather than skipping)", () => {
    expect(hasWasmPackage()).toBe(true);
  });

  for (const file of corpusFiles()) {
    it(`${basename(file)}: the WASM build and the TypeScript engine write the same checkpoints and detail`, () => {
      const scenario = loadScenario(file);
      const tsDetails: CheckpointDetail[] = [];
      const wasmDetails: CheckpointDetail[] = [];
      const ts = runScenario(scenario, undefined, tsDetails);
      const wasm = runScenario(scenario, startWasmEngine, wasmDetails);
      expect(ts.length).toBeGreaterThanOrEqual(2);
      expect(compareRuns({ checkpoints: wasm, details: wasmDetails }, { checkpoints: ts, details: tsDetails }, "WASM")).toBeNull();
      // The record is not empty: the log carries entries and the save its fields.
      const last = wasmDetails[wasmDetails.length - 1];
      expect(last.log.count).toBeGreaterThan(0);
      expect(Object.keys(last.save).length).toBeGreaterThan(5);
    });
  }

  it("replayCompare on the WASM leg reads agreement as ok", () => {
    const file = withRecords(corpusFiles()[0]);
    expect(replayCompare(file, dir, "WASM")).toMatchObject({ status: "ok" });
  });

  it("names a money, a log and a save-field difference with the WASM label", () => {
    const first = corpusFiles()[0];
    const money = replayCompare(withRecords(first, (d) => { d[d.length - 1].money += 1; }), dir, "WASM");
    expect(money).toMatchObject({ status: "diverged", signature: "money" });
    const log = replayCompare(withRecords(first, (d) => { d[d.length - 1].log.digest = "x"; }), dir, "WASM");
    expect(log).toMatchObject({ status: "diverged", signature: "log:digest" });
    const save = replayCompare(withRecords(first, (d) => { d[d.length - 1].save.clock = "x"; }), dir, "WASM");
    expect(save).toMatchObject({ status: "diverged", signature: "save:clock" });
    expect(save.status === "diverged" && save.message).toContain("WASM");
  });
});
