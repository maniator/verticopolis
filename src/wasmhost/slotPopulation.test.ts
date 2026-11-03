import { describe, expect, it } from "vitest";
import type { WasmModule } from "../dualrun/binding";
import { populationReaderFromModule, SLOT_MEMO_ENTRIES } from "./slotPopulation";

interface Stub {
  freed: number;
  loads: string[];
}

/** An engine package whose `fromSave` answers `stats` and records its use. */
function stubModule(stats: () => string): { mod: Pick<WasmModule, "Engine">; seen: Stub } {
  const seen: Stub = { freed: 0, loads: [] };
  const Engine = {
    fromSave(text: string) {
      if (text === "refuse") throw new Error("bad save");
      seen.loads.push(text);
      return { towerStats: stats, free: () => void seen.freed++ };
    },
  };
  return { mod: { Engine } as unknown as Pick<WasmModule, "Engine">, seen };
}

describe("the engine-backed slot population reader", () => {
  it("answers the engine's population and frees the engine", () => {
    const { mod, seen } = stubModule(() => JSON.stringify({ population: 321 }));
    expect(populationReaderFromModule(mod)("a save")).toBe(321);
    expect(seen.freed).toBe(1);
  });

  it("frees the engine when its stats are not JSON", () => {
    const { mod, seen } = stubModule(() => "not json");
    expect(() => populationReaderFromModule(mod)("a save")).toThrow();
    expect(seen.freed).toBe(1);
  });

  it("frees the engine when the population is not a number", () => {
    const { mod, seen } = stubModule(() => JSON.stringify({ population: "many" }));
    expect(() => populationReaderFromModule(mod)("a save")).toThrow("no population");
    expect(seen.freed).toBe(1);
  });

  it("refuses a population that is not a finite number", () => {
    const { mod, seen } = stubModule(() => '{"population":1e999}'); // JSON.parse reads this as Infinity
    expect(() => populationReaderFromModule(mod)("a save")).toThrow("no population");
    expect(seen.freed).toBe(1);
  });

  it("lets a refused save's error through, with nothing to free", () => {
    const { mod, seen } = stubModule(() => JSON.stringify({ population: 1 }));
    expect(() => populationReaderFromModule(mod)("refuse")).toThrow("bad save");
    expect(seen.freed).toBe(0);
  });

  it("loads a save once and answers its repeats from the memo", () => {
    const { mod, seen } = stubModule(() => JSON.stringify({ population: 5 }));
    const read = populationReaderFromModule(mod);
    read("same");
    read("same");
    expect(seen.loads).toEqual(["same"]);
    read("other");
    expect(seen.loads).toEqual(["same", "other"]);
  });

  it("does not remember a refused save, and forgets the oldest past its limit", () => {
    const { mod, seen } = stubModule(() => JSON.stringify({ population: 5 }));
    const read = populationReaderFromModule(mod);
    expect(() => read("refuse")).toThrow();
    expect(() => read("refuse")).toThrow();
    for (let i = 0; i <= SLOT_MEMO_ENTRIES; i++) read(`save ${i}`);
    expect(seen.loads).toHaveLength(SLOT_MEMO_ENTRIES + 1);
    read("save 0"); // the oldest was dropped, so it loads again
    expect(seen.loads).toHaveLength(SLOT_MEMO_ENTRIES + 2);
    read(`save ${SLOT_MEMO_ENTRIES}`); // the newest is still remembered
    expect(seen.loads).toHaveLength(SLOT_MEMO_ENTRIES + 2);
  });
});
