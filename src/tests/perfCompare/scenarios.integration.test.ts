// @vitest-environment node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkScenario, loadWebPackage } from "./nodeCheck";
import { buildScenarios } from "./scenarios";
import { wasmRequired } from "../conformance/wasmEngine";

const PKG = resolve(import.meta.dirname, "../../public/engine");
const hasPkg = ["verticopolis_engine_bg.wasm", "verticopolis_engine.js"].every((f) => existsSync(resolve(PKG, f)));
if (wasmRequired() && !hasPkg) throw new Error("VC_REQUIRE_WASM=1 but src/public/engine/ is not built; run npm run wasm:build");

describe("the comparison's scenarios", () => {
  const scenarios = buildScenarios();

  it("are deterministic: the same save bytes every build", () => {
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

  // The served browser package (build output, written by wasm:build). A plain
  // checkout without it skips, the same way packageHash.test.ts treats a
  // missing package; `npm run test:wasm` sets VC_REQUIRE_WASM=1, where a
  // missing package fails instead of skipping (#1122).
  it.skipIf(!hasPkg && !wasmRequired())("run identically on both engines in Node for two in-game hours", async () => {
    const mod = await loadWebPackage(PKG);
    for (const sc of scenarios.slice(0, 2)) {
      const c = checkScenario(mod, sc, 60, 2, 5);
      expect(c.start.tsState).toBe(c.start.wasmState);
      expect(c.end.tsCrowd).toBe(c.end.wasmCrowd);
      expect(c.match, `${sc.name} engines agree`).toBe(true);
    }
  }, 120_000);

  // The #1270 towers start from the same bytes on both engines and stay
  // together: the bracket towers, and the many-unit tower whose cost is units.
  it.skipIf(!hasPkg && !wasmRequired())("run identically on both engines for the bracket and many-unit towers", async () => {
    const mod = await loadWebPackage(PKG);
    for (const sc of buildScenarios(["bracket-a", "bracket-b", "many-unit"])) {
      const c = checkScenario(mod, sc, 60, 2, 5);
      expect(c.start.tsState).toBe(c.start.wasmState);
      expect(c.end.tsCrowd).toBe(c.end.wasmCrowd);
      expect(c.match, `${sc.name} engines agree`).toBe(true);
    }
  }, 240_000);
});
