import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { buildScenarios } from "../perfCompare/scenarios";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { fromSave, host } from "../wasmWorker/hostDriver";
import { stepGate } from "../../wasmhost/stepGate";
import { advanceOwedMinutes, SPEEDS } from "../../game/frameLoop";
import { ShadowEngine } from "../../dualrun/shadow";
import { loadCommand } from "../../dualrun/mirror";
import type { ToWorker } from "../../wasmhost/workerProtocol";

/**
 * The synchronous saves on the worker host (#1018): the quick and slot
 * saves, the undo snapshot and the crash report call `sim.serialize()` and
 * cannot wait for the worker. While steps are in flight that save is the
 * read model's own. These pin what it has to be, on the real package,
 * pipelined as in the browser: a tower that loads and plays on a fresh
 * engine and on TypeScript, with every command the player made, and a clock
 * that is its state's own minute (the steps still in flight are not in the
 * state, so a save that counted them would start a loaded tower past an hour
 * or day pass that never ran).
 */

const SCENARIOS = buildScenarios();

describe.skipIf(!hasWasmPackage())("synchronous saves on the worker host while steps are in flight", () => {
  it("load and play on a fresh engine and on TypeScript, keep every command, and carry their state's own minute", async () => {
    const sim = fromSave(SCENARIOS[1].save);
    const h = await host("worker", sim);
    // The minutes of the batch in flight: the last ops message sent.
    const inFlightMinutes = (): number => {
      const ops = (h.worker!.channel.sent as ToWorker[]).filter((m): m is Extract<ToWorker, { type: "ops" }> => m.type === "ops");
      return (ops[ops.length - 1]?.ops ?? []).reduce((n, o) => n + ("dt" in o ? o.dt : 0), 0);
    };
    let taken = 0;
    let acrossAnHour = 0;
    try {
      const debt = { minutes: 0 };
      const app = { sim, accMinutes: 0 };
      for (let f = 0; f < 600; f++) {
        const gate = stepGate(sim)!;
        advanceOwedMinutes(app, debt, 1000 / 60, SPEEDS[3], false, gate.canStep());
        gate.flush();
        if (f % 37 === 5) sim.money = sim.money + 1000;
        if (f % 71 === 3) sim.tower.towerName = `Tower ${f}`;
        const pending = inFlightMinutes();
        if (f % 23 === 7 && !gate.canStep() && pending > 0) {
          const before = h.worker!.host.stats.approximateSaves;
          const save = JSON.parse(JSON.stringify(sim.serialize())) as ReturnType<Simulation["serialize"]>;
          expect(h.worker!.host.stats.approximateSaves, "a save taken mid-flight is the read model's").toBe(before + 1);
          expect(save.minutes, "the state's own minute, without the steps in flight").toBeCloseTo(sim.clock.minutes - pending, 9);
          if (Math.floor(save.minutes / 60) !== Math.floor(sim.clock.minutes / 60)) acrossAnHour++;
          // Every command the player made is in it.
          expect(save.towerName).toBe(sim.tower.towerName);
          expect(save.money).toBe(sim.money);
          // It loads and plays on a fresh engine and on TypeScript.
          const tower = Simulation.deserialize(save);
          const engine = new ShadowEngine(wasm());
          try {
            engine.apply(loadCommand(tower, 0));
            for (let i = 0; i < 120; i++) engine.apply({ op: "tick", dt: 2 });
          } finally {
            engine.free();
          }
          for (let i = 0; i < 60; i++) tower.tick(2);
          taken++;
        }
        // One task turn: a reply may or may not be in by the next frame.
        await new Promise((r) => setImmediate(r));
      }
      expect(h.worker!.fatal).toEqual([]);
      expect(taken, "saves taken with steps in flight").toBeGreaterThan(10);
      expect(acrossAnHour, "saves whose in-flight steps cross an hour").toBeGreaterThan(0);
    } finally {
      h.detach();
    }
  }, 300_000);
});
