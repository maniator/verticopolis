// @vitest-environment node
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { checkScenario, loadWebPackage } from "./nodeCheck";
import { SCENARIO_NAMES, buildScenarios, loadFixtureSave } from "./scenarios";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg is not built; run npm run wasm:build");
const needsEngine = !hasWasmPackage() && !wasmRequired();
// The served browser package (build output, written by wasm:build), which
// perf:compare's Node check loads.
const WEB_PKG = resolve(import.meta.dirname, "../../public/engine");
const hasWebPkg = ["verticopolis_engine_bg.wasm", "verticopolis_engine.js"].every((f) => existsSync(resolve(WEB_PKG, f)));
if (wasmRequired() && !hasWebPkg) throw new Error("VC_REQUIRE_WASM=1 but src/public/engine/ is not built; run npm run wasm:build");

interface SavedUnits {
  units: { kind: string; x: number; state?: string }[];
}

/** The engine's crowd after each step of `steps` two-minute ticks, from `save`. */
function run(save: string, steps: number, each: (people: number, units: () => SavedUnits["units"]) => void = () => {}): { people: number; units: SavedUnits["units"] } {
  const engine = wasm().Engine.fromSave(save);
  try {
    const people = (): number => (JSON.parse(engine.crowdView()) as { people: unknown[] }).people.length;
    const units = (): SavedUnits["units"] => (JSON.parse(engine.serialize()) as SavedUnits).units;
    for (let i = 0; i < steps; i++) {
      engine.tick(2);
      each(people(), units);
    }
    return { people: people(), units: units() };
  } finally {
    engine.free();
  }
}

describe("the harnesses' scenarios", () => {
  const scenarios = buildScenarios();

  it("are deterministic: the same save bytes every load", () => {
    expect(buildScenarios().map((s) => s.sha256)).toEqual(scenarios.map((s) => s.sha256));
  });

  it("span small, medium and large towers (large has thousands of occupants)", () => {
    const [small, medium, large] = scenarios;
    expect(scenarios.map((s) => s.name)).toEqual(["small", "medium", "large"]);
    expect(small.population).toBeLessThan(1000);
    expect(medium.population).toBeGreaterThan(small.population);
    expect(large.population).toBeGreaterThan(10_000);
    expect(large.transports).toBeGreaterThanOrEqual(5);
  });

  // Issue #972 named split-tower.vctower as the small tower. Its crowd stays
  // tiny, so its ticks would exercise little of the crowd simulation; the
  // synthetic tower replaces it. docs/performance/ts-vs-wasm.md quotes these
  // figures, so a crowd change that fails this test means updating the doc.
  it.skipIf(needsEngine)("moves a real crowd on the small tower, where split-tower.vctower barely moves one", () => {
    const peakOverADay = (save: string): { peak: number; end: number } => {
      let peak = 0;
      const { people } = run(save, 720, (n) => (peak = Math.max(peak, n)));
      return { peak, end: people };
    };
    expect(peakOverADay(JSON.stringify(loadFixtureSave("conformance/fixtures/split-tower.vctower")))).toEqual({ peak: 27, end: 0 });
    expect(peakOverADay(buildScenarios(["small"])[0].save).peak).toBe(140);
  }, 120_000);

  it.skipIf(needsEngine)("loads every tower in the engine and runs two in-game hours on it", () => {
    for (const sc of buildScenarios(SCENARIO_NAMES)) {
      const { units } = run(sc.save, 60);
      expect(units.length, sc.name).toBeGreaterThan(0);
    }
  }, 240_000);

  // The hotel-heavy tower (#1279) is there for the housekeeping paths: the
  // morning checkout dirties hundreds of rooms, and the wing at x 270 and up
  // is out of every crew's route, so its rooms stay dirty on later days.
  it.skipIf(needsEngine)("dirties hundreds of hotel rooms at checkout and keeps the unreachable wing dirty", () => {
    const save = buildScenarios(["hotel-heavy"])[0].save;
    const dirty = (units: SavedUnits["units"]) => units.filter((u) => u.kind.startsWith("hotel") && u.state === "dirty");
    let peak = 0;
    const day = run(save, 720, (_, units) => (peak = Math.max(peak, dirty(units()).length)));
    expect(peak).toBeGreaterThan(500);
    expect(dirty(day.units).length).toBeGreaterThan(100);
    const wing = run(save, 720 * 2).units.filter((u) => u.kind.startsWith("hotel") && u.x >= 270);
    expect(wing.length).toBeGreaterThan(100);
    expect(dirty(wing).length).toBeGreaterThan(wing.length / 2);
  }, 240_000);

  // perf:compare's anchor: the served package's digests, which every browser
  // sample must match, are the Rust engine's own for the same save and ticks.
  it.skipIf(needsEngine || (!hasWebPkg && !wasmRequired()))("records the served package's start and end states for the browser runs to match", async () => {
    const mod = await loadWebPackage(WEB_PKG);
    const [small] = buildScenarios(["small"]);
    const c = checkScenario(mod, small, 60, 2, 5);
    const engine = wasm().Engine.fromSave(small.save);
    try {
      expect(c.start).toEqual({ state: engine.stateDigest(), crowd: engine.crowdDigest() });
      // The warmup ran on a throwaway copy, so the check's end is 60 ticks on.
      for (let i = 0; i < 60; i++) engine.tick(2);
      expect(c.end).toEqual({ state: engine.stateDigest(), crowd: engine.crowdDigest() });
    } finally {
      engine.free();
    }
    expect(c.end.state).not.toBe(c.start.state);
    expect([c.scenario, c.steps, c.dt]).toEqual(["small", 60, 2]);
  }, 120_000);
});
