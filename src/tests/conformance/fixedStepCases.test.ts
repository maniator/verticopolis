import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_ROOT } from "./scenario";

/**
 * The frame sequences the Rust step driver replays: `engine-rs/tests/data/fixed-step-cases.json`
 * pins the ticks and carried debt for each one, and `engine-rs/tests/fixed_step.rs`
 * holds the driver to them bit for bit. The file was written by the retired
 * TypeScript host loop (#1875) and is now a fixed record. This checks that it
 * still exercises the paths that matter.
 */

type Frame = [dtMs: number, minutesPerSecond: number, steadyClock: 0 | 1, step: 0 | 1];
interface FixedStepCase {
  id: string;
  startMinute: number;
  frames: Frame[];
  /** `[owedMinutesAfter, ...tickSizes]` per frame. */
  out: number[][];
}

const FILE = resolve(REPO_ROOT, "engine-rs/tests/data/fixed-step-cases.json");
/** The catch-up cap, `MAX_CATCHUP_MINUTES` in `engine-rs/src/fixed_step.rs`. */
const CATCHUP_CAP_MINUTES = 30;
/** The pause in `speed-changes-and-pause`: frames 300 to 359 at zero speed. */
const PAUSE_FRAMES = { from: 300, to: 360 };
const MIN_QUANTUM_SIZES = 4;

describe("fixed step cases", () => {
  it("cover the paths that matter: several quantum sizes, a pause, a mode change, a capped carry", () => {
    const { cases } = JSON.parse(readFileSync(FILE, "utf8")) as { cases: FixedStepCase[] };
    for (const c of cases) expect(c.out.length, c.id).toBe(c.frames.length);
    const all = cases.flatMap((c) => c.out);
    const sizes = new Set(all.flatMap((o) => o.slice(1)));
    expect(sizes.size).toBeGreaterThanOrEqual(MIN_QUANTUM_SIZES);
    expect(Math.max(...all.map((o) => o[0]))).toBeCloseTo(CATCHUP_CAP_MINUTES, 6);
    const pause = cases.find((c) => c.id === "speed-changes-and-pause")!;
    expect(pause.out.slice(PAUSE_FRAMES.from, PAUSE_FRAMES.to).every((o) => o.length === 1 && o[0] === 0)).toBe(true);
  });
});
