import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { buildScenarios } from "../perfCompare/scenarios";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { fromSave, host, script } from "../wasmWorker/hostDriver";
import { stepGate } from "../../wasmhost/stepGate";
import { advanceOwedMinutes, SPEEDS } from "../../game/frameLoop";
import { ShadowEngine } from "../../dualrun/shadow";
import { loadCommand } from "../../dualrun/mirror";
import type { FromWorker, ToWorker } from "../../wasmhost/workerProtocol";

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

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 but engine-rs/pkg/ is not built; run npm run wasm:build");

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
          // The in-flight minutes run again on load: when they cross an hour,
          // that hour pass runs once on the loaded tower.
          const runs = tower.onHourRuns;
          tower.tick(pending);
          expect(tower.clock.minutes).toBeCloseTo(sim.clock.minutes, 9);
          expect(tower.onHourRuns - runs).toBe(Math.floor(sim.clock.minutes / 60) - Math.floor(save.minutes / 60));
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

/**
 * A save, an undo snapshot or a restore point taken right after an hourly
 * delta (#1045). The read model's own save is the engine's at that sync (the
 * delta oracle pins it), loads back to the same save, and a worker host
 * started from it takes the next hours as deltas on top of the load.
 */
describe.skipIf(!hasWasmPackage())("a restore point taken after hourly deltas", () => {
  it("is the engine's save, loads back unchanged, and restarts the deltas on a new worker host", async () => {
    const sim = fromSave(SCENARIOS[1].save);
    const h = await host("worker", sim);
    const w = h.worker!;
    const engine = (): ShadowEngine => (w.channel.core as unknown as { shadow: ShadowEngine }).shadow;
    let seen = 0;
    let snapshot: ReturnType<Simulation["serialize"]> | null = null;
    try {
      await script(h, 360, (_step, s) => {
        const replies = w.channel.received.filter((m): m is Extract<FromWorker, { type: "frame" }> => m.type === "frame");
        const fresh = replies.slice(seen);
        seen = replies.length;
        if (snapshot === null && w.host.stats.deltas >= 3 && fresh.some((r) => r.delta)) {
          snapshot = JSON.parse(JSON.stringify(s.serialize())) as ReturnType<Simulation["serialize"]>;
          expect(snapshot, "the restore point is the engine's save at this sync").toEqual(JSON.parse(engine().handle().serialize()));
        }
      });
      expect(w.fatal).toEqual([]);
      expect(w.host.stats.merges, "only deltas so far").toBe(0);
    } finally {
      h.detach();
    }
    expect(snapshot, "a delta arrived after the third").not.toBeNull();
    // The restore: the same save back, as undo and a slot load do it.
    const restored = Simulation.deserialize(snapshot!);
    expect(JSON.parse(JSON.stringify(restored.serialize()))).toEqual(snapshot);
    // A new worker host on the restored tower loads it and goes on in deltas.
    const again = await host("worker", restored);
    try {
      await script(again, 120);
      expect(again.worker!.fatal).toEqual([]);
      expect(again.worker!.errors).toEqual([]);
      expect(again.worker!.host.stats.deltasRefused).toBe(0);
      expect(again.worker!.host.stats.deltas).toBeGreaterThanOrEqual(2);
      expect(again.worker!.host.stats.merges).toBe(0);
    } finally {
      again.detach();
    }
  }, 300_000);
});
