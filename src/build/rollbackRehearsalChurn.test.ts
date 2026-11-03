import { describe, expect, it } from "vitest";
import { churnOf, classifyLosses, isLoss, lossKey, parseChurn, playChurn } from "./rollbackRehearsalChurn.ts";
import { diffSaves, type EngineHandle, type EnginePackage } from "./rollbackRehearsal.ts";

const SAVE = { money: 5, units: [{ state: 1, name: "a" }, { state: 2, name: "b" }], queue: [1, 2, 3], milestones: { first: 1 } };

describe("diffSaves list shrinks", () => {
  it("counts the elements a list lost over every place, so an earlier growth cannot hide a later shrink", () => {
    const before = { rooms: [{ guests: [1] }, { guests: [1, 2, 3] }] };
    const after = { rooms: [{ guests: [1, 2] }, { guests: [1] }] };
    const entry = diffSaves(before, after).find((d) => d.path === "rooms[].guests[] length");
    expect(entry).toMatchObject({ kind: "changed", count: 2, removed: 2 });
    expect(isLoss(entry!)).toBe(true);
  });

  it("does not call a list that only grew a loss", () => {
    const entry = diffSaves({ queue: [1] }, { queue: [1, 2] }).find((d) => d.path === "queue[] length");
    expect(entry?.removed).toBeUndefined();
    expect(isLoss(entry!)).toBe(false);
  });
});

describe("churn", () => {
  it("lists dropped paths and shrunk lists, sorted and unique", () => {
    const after = { money: 5, units: [{ name: "a" }, { name: "b" }], queue: [], milestones: {} };
    expect(churnOf(SAVE, after)).toEqual({ "changed queue[] length": 3, "dropped milestones.first": 1, "dropped units[].state": 2 });
  });

  it("plays the save on the engine and keeps only what play removed", () => {
    const pkg = (ticks: { n: number }): EnginePackage => ({
      label: "cand",
      fromSave: (): EngineHandle => {
        let played = false;
        return {
          serialize: () => JSON.stringify(played ? { money: 5, units: [{ name: "a" }, { name: "b" }], queue: [1, 2, 3], milestones: { first: 1 } } : SAVE),
          tick() {
            played = true;
            ticks.n += 1;
          },
          free() {},
        };
      },
    });
    const ticks = { n: 0 };
    expect(playChurn(pkg(ticks), JSON.stringify(SAVE), 1)).toEqual({ "dropped units[].state": 2 });
    expect(ticks.n).toBe(30);
  });

  it("keeps the most a list lost at any checkpoint, so a shrink that regrows still counts", () => {
    let ticks = 0;
    const pkg: EnginePackage = {
      label: "cand",
      fromSave: (): EngineHandle => ({
        serialize: () => JSON.stringify({ ...SAVE, queue: ticks === 60 ? [] : [1, 2, 3, 4] }),
        tick() {
          ticks += 1;
        },
        free() {},
      }),
    };
    expect(playChurn(pkg, JSON.stringify(SAVE), 3)).toMatchObject({ "changed queue[] length": 3 });
  });

  it("counts what the load itself leaves out, because the browser compares against the seeded text", () => {
    const leaner = { money: 5, units: [{ name: "a" }, { name: "b" }], queue: [1, 2, 3], milestones: { first: 1 } };
    const pkg: EnginePackage = { label: "cand", fromSave: (): EngineHandle => ({ serialize: () => JSON.stringify(leaner), tick() {}, free() {} }) };
    expect(playChurn(pkg, JSON.stringify(SAVE), 1)).toEqual({ "dropped units[].state": 2 });
  });

  it("reads a churn file and refuses anything else", () => {
    expect(parseChurn({ "A.TDT": { "dropped x": 3 } })).toEqual({ "A.TDT": { "dropped x": 3 } });
    expect(() => parseChurn([])).toThrow(/not an object/);
    expect(() => parseChurn({ a: ["dropped x"] })).toThrow(/loss key to a count/);
    expect(() => parseChurn({ a: { "dropped x": 0 } })).toThrow(/count of one or more/);
  });
});

describe("classifyLosses", () => {
  const losses = diffSaves(SAVE, { money: 5, units: [{ name: "a" }], queue: [], towerName: "x" }).filter(isLoss);

  it("without a churn record fails only a dropped top-level field", () => {
    const withTop = diffSaves({ ...SAVE, towerName: "x" }, SAVE).filter(isLoss);
    expect(classifyLosses(withTop, undefined).failing.map((d) => d.path)).toEqual(["towerName"]);
    const nested = diffSaves(SAVE, { ...SAVE, units: [{ name: "a" }], queue: [] }).filter(isLoss);
    expect(classifyLosses(nested, undefined).failing).toEqual([]);
    expect(classifyLosses(nested, undefined).review.length).toBe(nested.length);
  });

  it("with a churn record fails every loss that play alone does not explain", () => {
    const { failing, review } = classifyLosses(losses, { "dropped units[].state": 2, "changed queue[] length": 3 });
    expect(review.map((d) => d.path).sort()).toEqual(["queue[] length", "units[].state"]);
    expect(failing.map((d) => `${d.kind} ${d.path}`)).toEqual(expect.arrayContaining(["dropped milestones", "changed units[] length"]));
  });

  it("fails a loss in more places than play alone makes it", () => {
    const both = diffSaves(SAVE, { money: 5, units: [{ name: "a" }, { name: "b" }], queue: [1, 2, 3], milestones: { first: 1 } }).filter(isLoss);
    const { failing, review } = classifyLosses(both, { "dropped units[].state": 1 });
    expect(failing.map(lossKey)).toEqual(["dropped units[].state"]);
    expect(review).toEqual([]);
    expect(classifyLosses(both, { "dropped units[].state": 2 }).failing).toEqual([]);
  });

  it("counts elements, so a rollback that empties a list play only shortened by one still fails", () => {
    const rollback = diffSaves(SAVE, { ...SAVE, queue: [] }).filter(isLoss);
    expect(classifyLosses(rollback, { "changed queue[] length": 1 }).failing.map(lossKey)).toEqual(["changed queue[] length"]);
    expect(classifyLosses(rollback, { "changed queue[] length": 3 }).failing).toEqual([]);
  });
});
