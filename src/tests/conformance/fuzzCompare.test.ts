import { describe, expect, it } from "vitest";
import { compareRuns, describeDivergence, type RunRecord } from "./fuzzCompare";

const run = (): RunRecord => ({
  checkpoints: [
    { label: "start", state: "s0", crowd: "c0", events: "e0" },
    { label: "h1", state: "s1", crowd: "c1", events: "e1" },
  ],
  details: [
    { label: "start", money: 2000000, log: { seq: 0, count: 0, digest: "l0" }, save: { clock: "k0", units: "u0" } },
    { label: "h1", money: 2000100, log: { seq: 2, count: 2, digest: "l1" }, save: { clock: "k1", units: "u1" } },
  ],
});

describe("seeded differential compare", () => {
  it("agrees on identical runs", () => {
    expect(compareRuns(run(), run())).toBeNull();
  });

  it("names a hash difference at its checkpoint", () => {
    for (const hash of ["state", "crowd", "events"] as const) {
      const rust = run();
      rust.checkpoints[1][hash] = "x";
      expect(compareRuns(run(), rust)).toMatchObject({ index: 1, label: "h1", kind: hash, ts: run().checkpoints[1][hash], rust: "x" });
    }
  });

  it("points a state difference at the first differing save field", () => {
    const rust = run();
    rust.checkpoints[1].state = "x";
    rust.details[1].save.units = "other";
    expect(compareRuns(run(), rust)).toMatchObject({ kind: "state", field: "units" });
  });

  it("names a money difference", () => {
    const rust = run();
    rust.details[1].money += 1;
    expect(compareRuns(run(), rust)).toMatchObject({ index: 1, kind: "money", ts: "2000100", rust: "2000101" });
  });

  it("names which part of the log differs", () => {
    for (const [part, value] of [["seq", 9], ["count", 9], ["digest", "z"]] as const) {
      const rust = run();
      (rust.details[1].log as Record<string, unknown>)[part] = value;
      expect(compareRuns(run(), rust)).toMatchObject({ kind: "log", field: part });
    }
  });

  it("names a save field that differs when the hashes agree, and one present on one side only", () => {
    const rust = run();
    rust.details[0].save.clock = "other";
    expect(compareRuns(run(), rust)).toMatchObject({ index: 0, kind: "save", field: "clock" });
    const extra = run();
    extra.details[1].save.founder = "f";
    expect(compareRuns(run(), extra)).toMatchObject({ kind: "save", field: "founder", ts: "(absent)", rust: "f" });
  });

  it("names a label or a count difference", () => {
    const relabeled = run();
    relabeled.checkpoints[1].label = "h2";
    expect(compareRuns(run(), relabeled)).toMatchObject({ kind: "label" });
    const short = run();
    short.checkpoints.pop();
    expect(compareRuns(run(), short)).toMatchObject({ kind: "count", ts: "2", rust: "1" });
  });

  it("describes a divergence on one line", () => {
    const rust = run();
    rust.details[1].save.units = "other";
    const d = compareRuns(run(), rust)!;
    expect(describeDivergence(d)).toBe("DIVERGED at checkpoint 1 (h1): save field units, TypeScript u1 vs Rust other");
  });
});
