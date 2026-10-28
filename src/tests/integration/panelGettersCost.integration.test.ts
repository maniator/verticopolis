import { describe, it, expect } from "vitest";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { buildScenarios } from "../perfCompare/scenarios";
import { HEATMAP_MODES } from "../conformance/panelProbe";

/**
 * What each Rust panel getter costs on the three perf fixtures, in the engine
 * as Node runs it (facade slice 6b, #1214; the plan's HP-2 wall-clock budget
 * for a UI tick). The medians print so the PR can quote them; the assertion is
 * a loose tripwire for a getter that turns pathological, not a benchmark: the
 * acceptance numbers come from the PC protocol.
 */

const RUNS = 30;
const TRIPWIRE_MS = 50;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function time(fn: () => unknown): number {
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

describe.skipIf(!hasWasmPackage())("panel getter cost", () => {
  for (const scenario of buildScenarios()) {
    it(`${scenario.name}: every getter answers inside the tripwire`, () => {
      const h = wasm().Engine.fromSave(scenario.save);
      try {
        for (let i = 0; i < 36; i++) h.tick(60);
        const unitId = (JSON.parse(h.serialize()) as { units: { id: number; kind: string }[] }).units.find((u) => u.kind === "office")?.id ?? 1;
        const rows: Record<string, number> = {
          towerStats: time(() => h.towerStats()),
          statsReport: time(() => h.statsReport()),
          housekeepingCoverage: time(() => h.housekeepingCoverage()),
          unitDetail: time(() => h.unitDetail(unitId)),
          peakCongestionHotspot: time(() => h.peakCongestionHotspot()),
          onboardingFacts: time(() => h.onboardingFacts()),
          ...Object.fromEntries(HEATMAP_MODES.map((m) => [`floorHeatmap(${m})`, time(() => h.floorHeatmap(m))])),
        };
        console.info(`panel getter medians (ms), ${scenario.name}, ${scenario.units} units: ${JSON.stringify(Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, Number(v.toFixed(3))])))}`);
        for (const [name, ms] of Object.entries(rows)) expect(ms, name).toBeLessThan(TRIPWIRE_MS);
      } finally {
        h.free();
      }
    }, 120_000);
  }
});
