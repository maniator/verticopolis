import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayCompare } from "./fuzzReplay";
import { loadScenario, runScenario, type Checkpoint } from "./scenario";
import type { CheckpointDetail } from "./checkpointDetail";

const dir = mkdtempSync(join(tmpdir(), "vc-fuzz-replay-"));

const commands = (extra: unknown[] = []) => [
  { op: "setMoney", amount: 500000000 },
  { op: "buildRow", kind: "lobby", floor: 1, from: 160, to: 200 },
  { op: "checkpoint", label: "built" },
  { op: "tick", dt: 30, times: 2 },
  ...extra,
];

/** Write a scenario and, beside it, the records a Rust run would leave: the
 *  TypeScript run's own, edited by `tweak`, so the compare has agreement to
 *  start from. */
function setup(
  name: string,
  cmds: unknown[],
  tweak?: (c: Checkpoint[], d: CheckpointDetail[]) => void,
  seed = 1,
  mode: "classic" | "modern" = "classic",
  star?: 1 | 2 | 3 | 4 | 5,
): string {
  const file = join(dir, `${name}.json`);
  const newGame = star ? { seed, mode, star } : { seed, mode };
  writeFileSync(file, JSON.stringify({ id: name, description: "d", start: { newGame }, commands: cmds }));
  if (tweak) {
    const details: CheckpointDetail[] = [];
    const checkpoints = runScenario(loadScenario(file), undefined, details);
    tweak(checkpoints, details);
    writeFileSync(join(dir, `${name}.rs.json`), JSON.stringify(checkpoints));
    writeFileSync(join(dir, `${name}.rs.detail.json`), JSON.stringify(details));
  }
  return file;
}

describe("replayCompare", () => {
  it("reads agreement as ok", () => {
    const file = setup("agree", commands(), () => {});
    expect(replayCompare(file)).toEqual({ status: "ok", checkpoints: 3 });
  });

  it("names a hash divergence by kind and field, without its position", () => {
    const file = setup("hash", commands(), (c, d) => {
      c[1].state = "x";
      d[1].save.clock = "other";
    });
    const r = replayCompare(file);
    expect(r).toMatchObject({ status: "diverged", signature: "state:clock" });
    expect(r.status === "diverged" && r.message).toMatch(/checkpoint 1 \(built\)/);
  });

  it("names a money divergence", () => {
    const file = setup("money", commands(), (_c, d) => {
      d[2].money += 1;
    });
    expect(replayCompare(file)).toMatchObject({ status: "diverged", signature: "money" });
  });

  it("reads records in another folder", () => {
    const file = setup("elsewhere", commands());
    const other = mkdtempSync(join(tmpdir(), "vc-fuzz-replay-rust-"));
    const details: CheckpointDetail[] = [];
    const checkpoints = runScenario(loadScenario(file), undefined, details);
    writeFileSync(join(other, "elsewhere.rs.json"), JSON.stringify(checkpoints));
    writeFileSync(join(other, "elsewhere.rs.detail.json"), JSON.stringify(details));
    expect(replayCompare(file, other).status).toBe("ok");
    expect(replayCompare(file).status).toBe("harness");
  });

  it("reads a TypeScript throw as a divergence, not a harness failure", () => {
    const agreed = setup("threw-ok", commands());
    const details: CheckpointDetail[] = [];
    const checkpoints = runScenario(loadScenario(agreed), undefined, details);
    // The Rust records say the build was accepted; the scenario below asks the
    // TypeScript engine to refuse a build it accepts.
    const file = setup("threw", commands([{ op: "build", kind: "floor", floor: 2, x: 170, expectFail: true }]));
    writeFileSync(join(dir, "threw.rs.json"), JSON.stringify(checkpoints));
    writeFileSync(join(dir, "threw.rs.detail.json"), JSON.stringify(details));
    const r = replayCompare(file);
    expect(r).toMatchObject({ status: "diverged", signature: "threw" });
  });

  it("reads missing, malformed and mismatched records as harness failures", () => {
    expect(replayCompare(setup("missing", commands()))).toMatchObject({ status: "harness" });
    const file = setup("malformed", commands(), () => {});
    writeFileSync(join(dir, "malformed.rs.json"), "{not json");
    expect(replayCompare(file)).toMatchObject({ status: "harness", message: expect.stringContaining("HARNESS:") });
    const short = setup("short", commands(), (c) => {
      c.pop();
    });
    expect(replayCompare(short)).toMatchObject({ status: "harness" });
    writeFileSync(join(dir, "notarray.rs.json"), "{}");
    writeFileSync(join(dir, "notarray.rs.detail.json"), "[]");
    expect(replayCompare(setup("notarray", commands()))).toMatchObject({ status: "harness" });
  });

  it("reads an unreadable scenario as a harness failure", () => {
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ id: "bad", description: "d", start: { newGame: { seed: 1, mode: "classic" } }, commands: [{ op: "nope" }] }));
    writeFileSync(join(dir, "bad.rs.json"), "[]");
    writeFileSync(join(dir, "bad.rs.detail.json"), "[]");
    expect(replayCompare(file)).toMatchObject({ status: "harness" });
  });

  it("replays a minimized known failing seed deterministically", () => {
    const file = setup(
      "seed-9315-min",
      [
        { op: "buildRow", kind: "lobby", floor: 1, from: 160, to: 220 },
        { op: "buildRow", kind: "floor", floor: 2, from: 161, to: 219 },
        { op: "build", kind: "clinic", floor: 2, x: 170 },
      ],
      (_c, d) => {
        expect(d.length).toBeGreaterThan(0);
        d[d.length - 1].money += 1;
      },
      9315,
      "modern",
      5,
    );
    const a = replayCompare(file);
    const checkpointsAfterFirst = readFileSync(join(dir, "seed-9315-min.rs.json"), "utf8");
    const detailsAfterFirst = readFileSync(join(dir, "seed-9315-min.rs.detail.json"), "utf8");
    const b = replayCompare(file);
    expect(readFileSync(join(dir, "seed-9315-min.rs.json"), "utf8")).toBe(checkpointsAfterFirst);
    expect(readFileSync(join(dir, "seed-9315-min.rs.detail.json"), "utf8")).toBe(detailsAfterFirst);
    expect(a).toMatchObject({ status: "diverged", signature: "money" });
    expect(b).toEqual(a);
  });
});
