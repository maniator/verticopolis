import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { lay, mustBuild, placeUnit } from "../fixtures/towerFixtures";

/**
 * Opt-in hour-boundary cost bench (spec-onhour-boundary-cost): reproduces the
 * diagnosis that motivated the noise memo without the owner's save (personal
 * data stays out of the repo). Construction helpers assert their own success
 * (../fixtures/towerFixtures). Run with:
 *
 *   RUN_HOUR_BENCH=1 npx vitest run src/tests/integration/hourCost.bench.integration.test.ts --disable-console-intercept
 *
 * Never a CI gate: timings are venue-noisy by nature, so the numbers are
 * evidence for PR bodies, never assertions. The one assertion below is a
 * structural sanity check (the walk crossed all 24 hour boundaries), not a
 * timing bound.
 */

/** A ~20k-unit tower shaped to price the noise scan: a dense office grid (the
 *  scan-cost driver, since every sensitive unit walks its full band each hour
 *  whether or not a source is near), a sparse clean row of fastFood sources so
 *  the afflicted branch fires, parking basements, and shafts in the column
 *  gaps. Office stride 14 (9-wide room + a 5-tile gap) leaves room for the
 *  4-wide shafts; every placement asserts, so a silent under-build can't skew
 *  the timings. Not the owner's exact save, but the same cost shape. */
function bigTower(): Simulation {
  const sim = Simulation.newGame(42);
  sim.money = 1e12;
  sim.star = 5;
  lay(sim, "lobby", 1);
  for (let f = 2; f <= 45; f++) lay(sim, "floor", f);
  // Basements are floor 0 (B1) down; each connects to the one above, so they
  // must build top-down starting from B1, not from B2.
  for (let f = 0; f >= -3; f--) lay(sim, "floor", f);
  // Office columns at stride 14; every fourth gap carries a shaft instead.
  const shaftGaps = new Set<number>();
  for (let col = 0, x = 10; x + 9 <= GRID.width - 10; col++, x += 14) {
    for (let f = 3; f <= 44; f++) placeUnit(sim, "office", f, x);
    for (let f = 0; f >= -3; f--) placeUnit(sim, "parking", f, x);
    if (col % 4 === 3) shaftGaps.add(x - 5); // a clear tile in the prior gap
  }
  // A sparse fastFood row on floor 2 (16-wide, so a wide clean stride).
  for (let x = 12; x + 16 <= GRID.width - 12; x += 56) placeUnit(sim, "fastFood", 2, x);
  // Standard shafts cap at a 30-floor span (canon), and one 4-wide shaft fills
  // the gap; serving floors 1..30 is plenty to exercise the sweep's served-set
  // read (the noise scan itself does not depend on service).
  for (const x of shaftGaps) mustBuild(sim, "elevatorStandard", x, 1, 30);
  for (const u of sim.tower.units) {
    if (u.state === "empty" && u.kind !== "parking") {
      u.state = "occupied";
      u.occupants = 2;
      u.satisfaction = 0.9;
    }
  }
  return sim;
}

describe.skipIf(process.env.RUN_HOUR_BENCH !== "1")("hour-boundary cost bench (opt-in)", () => {
  it("walks 24 hours and reports boundary vs regular tick cost", () => {
    const sim = bigTower();
    for (let i = 0; i < 30; i++) sim.tick(1); // warm JIT and the rev caches
    let regularMs = 0;
    let regularN = 0;
    const boundaries: { hour: number; ms: number }[] = [];
    for (let i = 0; i < 24 * 60; i++) {
      const before = sim.onHourRuns;
      const t0 = performance.now();
      sim.tick(1);
      const ms = performance.now() - t0;
      if (sim.onHourRuns !== before) boundaries.push({ hour: sim.clock.hour, ms });
      else {
        regularMs += ms;
        regularN++;
      }
    }
    // Sanity-assert the tick accounting BEFORE indexing/dividing, so an engine
    // regression (onHourRuns never or always incrementing) fails with an
    // actionable message instead of an index-out-of-bounds throw or a NaN/Infinity
    // print from an empty boundaries array or a zero regular-tick count.
    expect(boundaries.length).toBe(24);
    expect(regularN).toBeGreaterThan(0);
    const sorted = boundaries.map((b) => b.ms).sort((a, b) => a - b);
    const line = boundaries.map((b) => `${b.hour}:${b.ms.toFixed(0)}`).join(" ");
    console.log(`bench units=${sim.tower.units.length} transports=${sim.tower.transports.length}`);
    console.log(`regular ticks: n=${regularN} avg=${(regularMs / regularN).toFixed(2)}ms`);
    console.log(`boundary ticks: median=${sorted[Math.floor(sorted.length / 2)].toFixed(1)}ms max=${sorted[sorted.length - 1].toFixed(1)}ms`);
    console.log(`per hour: ${line}`);
  }, 300_000);
});
