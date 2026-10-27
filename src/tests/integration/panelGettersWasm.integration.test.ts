import { describe, it, expect } from "vitest";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONFORMANCE_DIR, loadScenario, runScenario } from "../conformance/scenario";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import {
  firstDifference,
  pickIds,
  probeTs,
  probeWasm,
  probedTsStart,
  probedWasmStart,
  type PanelAnswers,
  type ProbeIds,
} from "../conformance/panelProbe";

/**
 * The Rust panel getters against the TypeScript functions they replace (facade
 * slice 6b, #1214), on the conformance corpus. Every scenario runs on each
 * engine; at every checkpoint the probe reads the stats screen, the HUD
 * counters, a spread of unit and shaft cards, every overlay, the traffic
 * hotspot and the onboarding facts from both, and the answers must be equal.
 * Without the built package the suite skips, unless `VC_REQUIRE_WASM=1`.
 */

const SCENARIO_DIR = resolve(CONFORMANCE_DIR, "scenarios");
const files = readdirSync(SCENARIO_DIR).filter((f) => f.endsWith(".json")).sort();

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

/** How much each getter was compared, summed over the corpus. */
const compared = { checkpoints: 0, units: 0, transports: 0, heatCells: 0, strandedFloors: 0, infested: 0, twoCars: 0 };

describe.skipIf(!hasWasmPackage())("panel getters through the WASM binding", () => {
  for (const file of files) {
    const scenario = loadScenario(resolve(SCENARIO_DIR, file));
    it(`${scenario.id}: every getter matches its TypeScript reference at every checkpoint`, () => {
      const ids: ProbeIds[] = [];
      const ts: PanelAnswers[] = [];
      runScenario(
        scenario,
        probedTsStart((sim) => {
          const picked = pickIds(sim);
          ids.push(picked);
          ts.push(probeTs(sim, picked));
        }),
        [],
      );
      const rust: PanelAnswers[] = [];
      runScenario(
        scenario,
        probedWasmStart((h) => {
          rust.push(probeWasm(h, ids[rust.length]));
        }),
        [],
      );
      expect(rust.length).toBe(ts.length);
      for (let i = 0; i < ts.length; i++) {
        const diff = firstDifference(ts[i], rust[i]);
        if (diff) throw new Error(`${scenario.id} checkpoint ${i}: ${diff}`);
        compared.checkpoints++;
        compared.units += Object.values(ts[i].units).filter((u) => u !== null).length;
        compared.transports += Object.values(ts[i].transports).filter((t) => t !== null).length;
        compared.heatCells += Object.values(ts[i].heatmaps).reduce((n: number, cells) => n + (cells as unknown[]).length, 0);
        const report = ts[i].statsReport as { strandedFloors: number[]; housekeeping: { infested: number }; elevators: { cars: number }[] };
        compared.strandedFloors += report.strandedFloors.length;
        compared.infested += report.housekeeping.infested > 0 ? 1 : 0;
        compared.twoCars += report.elevators.some((e) => e.cars >= 2) ? 1 : 0;
      }
    }, 240_000);
  }

  it("compared enough to mean something", () => {
    // The corpus must put real towers through every getter, not empty ones.
    expect(compared.checkpoints).toBeGreaterThan(100);
    expect(compared.units).toBeGreaterThan(500);
    expect(compared.transports).toBeGreaterThan(100);
    expect(compared.heatCells).toBeGreaterThan(5000);
    // Set to a path to keep the per-getter counts for the PR record.
    if (process.env.VC_PANEL_REPORT) writeFileSync(process.env.VC_PANEL_REPORT, JSON.stringify(compared, null, 2));
  });

  it("answers null for an id it cannot read, and refuses an unknown overlay", () => {
    const { Engine } = wasm();
    const h = Engine.newGame(1, "classic");
    try {
      for (const bad of [Number.NaN, 1.5, Infinity, -Infinity, 2 ** 60, "3", null, undefined, {}]) {
        expect(h.unitDetail(bad as number)).toBeUndefined();
        expect(h.transportDetail(bad as number)).toBeUndefined();
      }
      expect(() => h.floorHeatmap("traffic")).toThrow(/unknown heatmap mode/);
      expect(() => h.floorHeatmap("")).toThrow(/unknown heatmap mode/);
      expect(h.floorHeatmap("congestion")).toBe("[]");
    } finally {
      h.free();
    }
  });
});
