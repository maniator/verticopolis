// @vitest-environment node
// Node, as in the runner and main.ts, which pack and check the seeds.
import { describe, expect, it, vi } from "vitest";
import { SaveGame } from "../../storage/SaveGame";
import { AUTOSAVE_KEY, autosaveSeed, autosaveState, checkAutosaveSeeds } from "./savedStart";
import { buildScenarios } from "./scenarios";

const small = () => {
  const [sc] = buildScenarios(["small"]);
  return { name: sc.name, save: sc.save, population: sc.population };
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
    const other = JSON.parse(sc.save) as { money: number };
    other.money += 1;
    const second = autosaveSeed({ save: JSON.stringify(other) });
    expect(second.sha256).not.toBe(first.sha256);
  });
});

describe("checkAutosaveSeeds", () => {
  it("stops the run before any browser when a seed would not boot the scenario's tower", () => {
    const sc = small();
    // A packed value the boot cannot read (a fresh save text, so no seed is cached).
    const pack = vi.spyOn(SaveGame, "packSync").mockReturnValue("VCZ1:not a packed save");
    try {
      expect(() => checkAutosaveSeeds([{ ...sc, save: `${sc.save} ` }])).toThrow(/small: the autosave seed does not load back \(no tower, read as corrupt\)/);
    } finally {
      pack.mockRestore();
    }
    expect(() => checkAutosaveSeeds([{ ...sc, population: 0 }])).toThrow(/needs a tower with people in it/);
  });
});

describe("autosaveState", () => {
  it("puts the seed in the autosave slot of the app's origin", () => {
    const seed = autosaveSeed(small());
    expect(autosaveState("http://127.0.0.1:4173", seed)).toEqual({ cookies: [], origins: [{ origin: "http://127.0.0.1:4173", localStorage: [{ name: AUTOSAVE_KEY, value: seed.value }] }] });
  });
});
