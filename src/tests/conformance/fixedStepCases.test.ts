import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "./scenario";
import { buildCases, runSequence, FRAME_SEQUENCES, type FixedStepCase } from "./fixedStepCases";

/**
 * The step math the Rust driver must match: `engine-rs/tests/data/fixed-step-cases.json`
 * is what the TypeScript host loop does with each frame sequence. The Rust test
 * `engine-rs/tests/fixed_step.rs` replays it. Regenerate after an intended
 * change to the step math: `VC_CONFORMANCE_UPDATE=1 npx vitest run
 * src/tests/conformance/fixedStepCases.test.ts`.
 */

const UPDATE = process.env.VC_CONFORMANCE_UPDATE === "1";
if (UPDATE && process.env.CI) throw new Error("VC_CONFORMANCE_UPDATE is a local regeneration switch and never runs in CI");

const FILE = resolve(REPO_ROOT, "engine-rs/tests/data/fixed-step-cases.json");

describe("fixed step cases", () => {
  it("match what the TypeScript host loop does", () => {
    const cases = buildCases();
    if (UPDATE) writeFileSync(FILE, `${JSON.stringify({ cases })}\n`);
    const pinned = JSON.parse(readFileSync(FILE, "utf8")) as { cases: FixedStepCase[] };
    expect(pinned.cases.map((c) => c.id)).toEqual(FRAME_SEQUENCES.map((c) => c.id));
    for (const c of pinned.cases) expect(runSequence(c.startMinute, c.frames), c.id).toEqual(c.out);
  });

  it("cover the paths that matter: several quantum sizes, a pause, a mode change, a capped carry", () => {
    const { cases } = JSON.parse(readFileSync(FILE, "utf8")) as { cases: FixedStepCase[] };
    const all = cases.flatMap((c) => c.out);
    const sizes = new Set(all.flatMap((o) => o.slice(1)));
    expect(sizes.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...all.map((o) => o[0]))).toBeCloseTo(30, 6); // the catch-up cap was reached
    const pause = cases.find((c) => c.id === "speed-changes-and-pause")!;
    expect(pause.out.slice(300, 360).every((o) => o.length === 1 && o[0] === 0)).toBe(true);
  });
});
