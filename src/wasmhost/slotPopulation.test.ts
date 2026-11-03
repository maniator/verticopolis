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

  it("tells onThrow about every throw before it propagates, and about nothing on success (#1612)", () => {
    const { mod } = stubModule(() => JSON.stringify({ population: 1 }));
    const heard: unknown[] = [];
    const read = populationReaderFromModule(mod, (e) => heard.push(e));
    expect(read("fine")).toBe(1);
    expect(heard).toEqual([]);
    expect(() => read("refuse")).toThrow("bad save");
    expect(heard).toHaveLength(1);
    expect((heard[0] as Error).message).toBe("bad save");
  });

  it("hands a trap in the stats read to onThrow, and still frees the engine", () => {
    const trap = new WebAssembly.RuntimeError("unreachable");
    const { mod, seen } = stubModule(() => {
      throw trap;
    });
    const heard: unknown[] = [];
    expect(() => populationReaderFromModule(mod, (e) => heard.push(e))("a save")).toThrow(trap);
    expect(heard).toEqual([trap]);
    expect(seen.freed).toBe(1);
  });

  it("hands a trap in the free to onThrow instead of losing it behind a good read", () => {
    const trap = new WebAssembly.RuntimeError("memory access out of bounds");
    const mod = { Engine: { fromSave: () => ({ towerStats: () => JSON.stringify({ population: 9 }), free: () => { throw trap; } }) } } as unknown as Pick<WasmModule, "Engine">;
    const heard: unknown[] = [];
    const read = populationReaderFromModule(mod, (e) => heard.push(e));
    expect(() => read("a save")).toThrow(trap);
    expect(heard).toEqual([trap]);
    expect(() => read("a save")).toThrow(trap); // nothing was remembered for the poisoned read
  });

  it("names the trap first when the read fails plainly and the free traps", () => {
    const trap = new WebAssembly.RuntimeError("unreachable");
    const mod = { Engine: { fromSave: () => ({ towerStats: () => "not json", free: () => { throw trap; } }) } } as unknown as Pick<WasmModule, "Engine">;
    const heard: unknown[] = [];
    expect(() => populationReaderFromModule(mod, (e) => heard.push(e))("a save")).toThrow(/unreachable/);
    expect(heard).toHaveLength(1);
    expect((heard[0] as { cause?: unknown }).cause).toBe(trap);
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
