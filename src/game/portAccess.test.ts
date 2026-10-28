import { describe, expect, it } from "vitest";
import { catalogFacility } from "../engine/catalogTypes";
import { Simulation } from "../engine/Simulation";
import { useTowerCatalogSource } from "../engine/towerCatalog";
import { catalogOf, isUnlocked, quoteBuild, quoteShaft } from "./portAccess";
import { portDeps } from "./portDeps.fixture";
import { KINDS } from "../engine/port/layout";

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
  it("is the catalog of the reader's mode, kept across header updates", () => {
    const classic = new Simulation(1, "classic");
    const modern = new Simulation(1, "modern");
    const cd = portDeps(classic);
    const md = portDeps(modern);
    const c = { enginePort: cd.engine, reader: cd.reader };
    const m = { enginePort: md.engine, reader: md.reader };
    expect(catalogOf(c).mode).toBe("classic");
    expect(catalogOf(m).mode).toBe("modern");
    const first = catalogOf(c);
    c.reader.update();
    expect(catalogOf(c)).toBe(first);
  });

  it("follows the catalog source installed on the engine port", () => {
    const sim = new Simulation(1, "classic");
    const { engine: enginePort, reader } = portDeps(sim);
    const base = catalogOf({ enginePort, reader });
    const office = catalogFacility(base, "office");
    const hosted = {
      ...base,
      facilities: base.facilities.map((f) => (f.key === "office" ? { ...f, width: f.width + 2, cost: f.cost + 1000 } : f)),
    };
    useTowerCatalogSource(enginePort, () => hosted);
    const read = catalogFacility(catalogOf({ enginePort, reader }), "office");
    expect(read.width).toBe(office.width + 2);
    expect(read.cost).toBe(office.cost + 1000);
    useTowerCatalogSource(enginePort, null);
    expect(catalogFacility(catalogOf({ enginePort, reader }), "office").width).toBe(office.width);
  });
});

describe("isUnlocked", () => {
  it("answers what the simulation answers for every kind, from the reader's header", () => {
    for (const mode of ["classic", "modern"] as const) {
      const sim = new Simulation(7, mode);
      const { reader } = portDeps(sim);
      for (const star of [1, 3, 5, 6]) {
        sim.star = star;
        reader.update();
        for (const kind of KINDS) expect(isUnlocked({ reader }, kind), `${mode} ${star} ${kind}`).toBe(sim.isUnlocked(kind));
      }
    }
  });

  it("answers as of the reader's last update", () => {
    const sim = tower();
    const { reader } = portDeps(sim);
    expect(isUnlocked({ reader }, "elevatorExpress")).toBe(false);
    sim.star = 5;
    expect(isUnlocked({ reader }, "elevatorExpress")).toBe(false);
    reader.update();
    expect(isUnlocked({ reader }, "elevatorExpress")).toBe(sim.isUnlocked("elevatorExpress"));
  });
});
