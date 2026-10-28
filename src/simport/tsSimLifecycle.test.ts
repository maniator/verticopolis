import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import type { SerializedGame } from "../engine/types";
import { towerStateSig } from "../engine/UndoHistory";
import { MID, newSeededGame } from "../tests/fixtures/towerFixtures";
import { parityRestarts } from "../tests/parity/typescriptOnly";
import { describeLifecycleContract } from "./lifecycleContract.fixture";
import { createTsSim } from "./tsSim";

/** A port over a seeded Modern tower that adopts what it loads, and the
 *  tower it holds. */
function adopting(seed = 7) {
  const held = { sim: newSeededGame(seed, "modern"), adopts: [] as boolean[] };
  const port = createTsSim(() => held.sim, {
    adopt: (next, keepHistory) => {
      held.adopts.push(keepHistory);
      held.sim = next;
    },
  });
  return { held, port };
}

// In the `unitWasm` parity project every Simulation is hosted on the Rust
// engine once it ticks, so this runs the lifecycle on both of today's hosts.
describeLifecycleContract(
  "TsSim",
  () => {
    const { held, port } = adopting();
    return { port, reference: () => towerStateSig(held.sim.tower, held.sim.money) };
  },
  { restarts: parityRestarts },
);

describe("TsSim's lifecycle over the live instance", () => {
  it("adopts a loaded tower before the load returns, keeping the history only for an undo step", () => {
    const { held, port } = adopting();
    const text = port.saveNow();
    void port.load({ from: "history", text });
    const restored = held.sim;
    void port.load({ from: "found", seed: 3, mode: "classic", calendar: "realWorld", unbridged: false });
    expect(held.sim).not.toBe(restored);
    expect(held.adopts).toEqual([true, false]);
  });

  it("cannot load without a way to adopt, and leaves the tower", async () => {
    const sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    await expect(port.load({ from: "found", seed: 3, mode: "classic", calendar: "realWorld", unbridged: false })).rejects.toThrow("cannot load");
    expect(port.view.tower).toBe(sim.tower);
  });

  it("saves what the instance serializes, a copy kept in memory included", () => {
    const { held, port } = adopting();
    port.tick(1);
    expect(port.saveNow()).toBe(JSON.stringify(held.sim.serialize()));
    expect(port.saveNow({ memory: true })).toBe(port.saveNow());
  });

  it("rejects a stored load with the first save's error", async () => {
    const { held, port } = adopting();
    const tower = held.sim;
    const generation = port.generation;
    const errorOf = (save: unknown) => {
      try {
        Simulation.deserialize(save as SerializedGame);
      } catch (e) {
        return e as Error;
      }
      throw new Error("expected the save not to load");
    };
    const [first, second] = [errorOf(null), errorOf(undefined)];
    expect(first.message).not.toBe(second.message);
    await expect(port.load({ from: "stored", saves: [null, undefined] as unknown as SerializedGame[] })).rejects.toEqual(first);
    expect(held.sim).toBe(tower);
    expect(port.generation).toBe(generation);
  });

  it("gives each tower its own generation, moved by a swap made outside the port", () => {
    let sim = newSeededGame(7, "modern");
    const port = createTsSim(() => sim);
    const first = port.generation;
    sim.tower.towerName = "Renamed";
    expect(port.generation).toBe(first);
    const before = sim;
    sim = newSeededGame(8, "modern");
    const second = port.generation;
    expect(second).not.toBe(first);
    sim = before;
    expect(port.generation).toBe(first);
  });

  it("fingerprints the tower as the undo history always has", async () => {
    const { held, port } = adopting();
    expect(port.undoSignature()).toBe(towerStateSig(held.sim.tower, held.sim.money));
    expect(await port.command({ op: "build", kind: "office", floor: 2, x: MID - 4 })).toMatchObject({ ok: true });
    expect(port.undoSignature()).toBe(towerStateSig(held.sim.tower, held.sim.money));
  });
});
