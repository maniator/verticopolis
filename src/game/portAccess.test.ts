import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { catalogOf, isUnlocked, quoteBuild, quoteShaft } from "./portAccess";
import { portDeps } from "./portDeps.fixture";

function tower() {
  const sim = new Simulation(7, "classic");
  for (let x = 10; x < 30; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  return sim;
}

describe("quoteBuild", () => {
  it("answers what canBuild answers, with the engine's own refusal text", () => {
    const sim = tower();
    const { engine, codes } = portDeps(sim);
    const ok = quoteBuild(engine, codes, "floor", 2, 12);
    const want = sim.canBuild("floor", 2, 12);
    expect(ok).toEqual({ ok: want.ok, cost: want.cost, reason: undefined });
    const refused = quoteBuild(engine, codes, "office", 9, 12);
    const wantRefused = sim.canBuild("office", 9, 12);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe(wantRefused.reason);
    expect(refused.cost).toBe(wantRefused.cost);
  });
});

describe("quoteShaft", () => {
  it("answers the placement check, and a refusal carries its reason", () => {
    const sim = tower();
    for (let x = 10; x < 30; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
    const { engine, codes } = portDeps(sim);
    expect(quoteShaft(engine, codes, "elevatorStandard", 12, 1, 2)).toEqual({ ok: true, reason: undefined });
    const refused = quoteShaft(engine, codes, "elevatorStandard", 12, 1, 6);
    expect(refused.ok).toBe(false);
    expect(refused.reason).toBe(sim.tower.validateTransport("elevatorStandard", 12, 1, 6).reason);
  });
});

describe("catalogOf", () => {
  it("is the catalog of the view's mode, kept across header updates", () => {
    const classic = portDeps(new Simulation(1, "classic")).reader;
    const modern = portDeps(new Simulation(1, "modern")).reader;
    expect(catalogOf(classic).mode).toBe("classic");
    expect(catalogOf(modern).mode).toBe("modern");
    const first = catalogOf(classic);
    classic.update();
    expect(catalogOf(classic)).toBe(first);
  });
});

describe("isUnlocked", () => {
  it("reads the simulation, the one gap the port leaves", () => {
    const sim = tower();
    expect(isUnlocked({ sim }, "office")).toBe(sim.isUnlocked("office"));
    expect(isUnlocked({ sim }, "elevatorExpress")).toBe(false);
  });
});
