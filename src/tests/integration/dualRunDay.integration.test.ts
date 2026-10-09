import { describe, it, expect } from "vitest";
import type { Simulation } from "../../engine/Simulation";
import { hasWasmPackage, wasmRequired } from "../conformance/wasmEngine";
import { DualRun, FIXTURES, FrameDriver, loadFixture } from "../dualrun/dualRunHarness";

/**
 * The day gate of story-engine-dual-run: a full day on every fixture save
 * and on a new game of each mode, at each of the game's speeds, driven by the
 * web frame loop's own math, with the WASM shadow fed by the mirror and
 * compared at every hour. No divergence, one comparison per hour crossed
 * (24 or 25).
 */

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

const DAY = 24 * 60;

/** The hour boundaries a run from `from` to `to` minutes crosses. */
const hoursCrossed = (from: number, to: number) => Math.floor(to / 60) - Math.floor(from / 60);

function day(sim: Simulation, speed: number, steadyClock = false, run = new DualRun().follow(sim), founded = false): void {
  const from = sim.clock.minutes;
  new FrameDriver(sim, speed, steadyClock).run(DAY);
  const report = run.stop();
  expect(report.divergences).toEqual([]);
  // A frame at the catch-up cap can carry the clock past the day by up to
  // half an hour, so the count follows the hours the run crossed (24 or 25); a
  // founded game's first step also runs its founding hour's pass.
  const crossed = hoursCrossed(from, sim.clock.minutes) + (founded ? 1 : 0);
  expect(crossed).toBeGreaterThanOrEqual(founded ? 25 : 24);
  expect(report.checkpoints).toBe(crossed);
}

function foundedDay(seed: number, mode: "classic" | "modern", speed: number, calendar: "realWorld" | "canon" = "realWorld", unbridged = false): void {
  const { sim, run } = DualRun.found(seed, mode, calendar, unbridged);
  day(sim, speed, false, run, true);
}

describe.skipIf(!hasWasmPackage())("dual run: a day at the game's own cadence", () => {
  for (const fixture of FIXTURES) {
    for (const speed of [1, 2, 3]) {
      it(`${fixture.replace(/^.*\//, "")} at speed ${speed}`, () => day(loadFixture(fixture), speed), 120_000);
    }
  }
  it("a new Classic game at the fastest speed", () => foundedDay(4242, "classic", 3), 60_000);
  it("a new Modern game at the fastest speed", () => foundedDay(4242, "modern", 3), 60_000);
  it("a new Modern game on the canon calendar, founded unbridged", () => foundedDay(99, "modern", 2, "canon", true), 60_000);
  it("a day driven at one steady reference frame rate", () => {
    const sim = loadFixture("src/tests/fixtures/split-tower.vctower");
    const run = new DualRun().follow(sim);
    const from = sim.clock.minutes;
    new FrameDriver(sim, 3, false, [1000 / 60]).run(DAY);
    const report = run.stop();
    expect(report.divergences).toEqual([]);
    expect(report.checkpoints).toBe(hoursCrossed(from, sim.clock.minutes));
    expect(report.checkpoints).toBe(24);
  }, 60_000);
  it("the steady clock pacing on tower-one", () => day(loadFixture("src/tests/fixtures/towerone_6.vctower"), 3, true), 120_000);
});
