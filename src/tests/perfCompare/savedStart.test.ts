// @vitest-environment node
// Node, as in the runner and main.ts, which pack and check the seeds.
import { describe, expect, it } from "vitest";
import { AUTOSAVE_KEY, autosaveSeed, autosaveState, checkAutosaveSeeds } from "./savedStart";
import { buildSmallTower } from "./scenarios";

const small = () => {
  const sim = buildSmallTower();
  return { name: "small" as const, save: JSON.stringify(sim.serialize()), population: sim.population };
};

describe("autosaveSeed", () => {
  it("is a stored autosave the game's own reader loads back as the scenario's tower, with no storage left behind", () => {
    const sc = small();
    expect(sc.population).toBeGreaterThan(0);
    const seed = autosaveSeed(sc);
    expect(seed.value.startsWith("VCZ1:")).toBe(true);
    expect(seed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(() => checkAutosaveSeeds([sc])).not.toThrow();
    expect((globalThis as { localStorage?: unknown }).localStorage).toBeUndefined();
  });

  it("is packed once per save text, so a run's processes boot the same bytes and another save gets its own seed", () => {
    const sc = small();
    const first = autosaveSeed(sc);
    expect(autosaveSeed({ ...sc })).toBe(first);
    const other = buildSmallTower();
    other.money += 1;
    const second = autosaveSeed({ save: JSON.stringify(other.serialize()) });
    expect(second.sha256).not.toBe(first.sha256);
  });
});

describe("checkAutosaveSeeds", () => {
  it("stops the run before any browser when a seed would not boot the scenario's tower", () => {
    const sc = small();
    expect(() => checkAutosaveSeeds([{ ...sc, population: sc.population + 1 }])).toThrow(/small: the autosave seed does not load back \(population \d+, the save \d+\)/);
    expect(() => checkAutosaveSeeds([{ ...sc, population: 0 }])).toThrow(/needs a tower with people in it/);
  });
});

describe("autosaveState", () => {
  it("puts the seed in the autosave slot of the app's origin", () => {
    const seed = autosaveSeed(small());
    expect(autosaveState("http://127.0.0.1:4173", seed)).toEqual({ cookies: [], origins: [{ origin: "http://127.0.0.1:4173", localStorage: [{ name: AUTOSAVE_KEY, value: seed.value }] }] });
  });
});
