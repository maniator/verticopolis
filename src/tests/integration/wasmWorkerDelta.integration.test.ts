import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { ShadowEngine } from "../../dualrun/shadow";
import type { ShadowCommand } from "../../dualrun/commands";
import { KEYFRAME_EXEMPT_OPS } from "../../wasmhost/saveSyncRules";
import type { FromWorker } from "../../wasmhost/workerProtocol";
import { buildScenarios } from "../perfCompare/scenarios";
import { hasWasmPackage, wasm } from "../conformance/wasmEngine";
import { fromSave, host, script, type Hosted } from "../wasmWorker/hostDriver";
import { startWorkerHost, type WorkerHostHandle } from "../../wasmhost/workerController";
import type { WasmHostApp } from "../../wasmhost/startWasmHost";
import { stepGate } from "../../wasmhost/stepGate";
import { spawned, until } from "../wasmWorker/channel";

/**
 * The delta oracle for the worker host's hourly delta (#1045): over the
 * three benchmark towers and two in-game days, after every reply that
 * brought a delta or a full save (every op sent included, since each check
 * runs right after a sync), the read model's own save equals the engine's
 * `serialize()`. A delta that drifted from a full merge in any saved field
 * fails here at the hour it drifted. One run adds player edits that leave
 * the layout alone, so the hours after a command (full saves) and the
 * deltas after them are checked too.
 */

/** The read model's own save (while hosted, `serialize` is the host's). */
function ownSave(sim: Simulation): unknown {
  const own = Object.getOwnPropertyDescriptor(sim, "serialize");
  if (own) delete (sim as Partial<Simulation>).serialize;
  try {
    return JSON.parse(JSON.stringify(sim.serialize()));
  } finally {
    if (own) Object.defineProperty(sim, "serialize", own);
  }
}

/** Player edits between steps: money, a rename, rents up and down, an
 *  office taken off the market, a camera stamp. None moves the layout. */
function edits(step: number, sim: Simulation): void {
  const office = sim.tower.units.find((u) => u.kind === "office");
  if (step === 100) sim.money = sim.money + 250_000;
  if (step === 300) sim.tower.towerName = "Delta Tower";
  if (step === 500 && office) sim.adjustRent(office.id, 1);
  if (step === 700 && office) sim.adjustRent(office.id, -1);
  if (step === 900 && office) sim.setNoRate(office.id);
  if (step === 1100) sim.view = { tile: 140, floor: 3, zoom: 1.5 };
}

const DAY_STEPS = 720; // 2-minute steps at the fastest speed, roughly
const SCENARIOS = buildScenarios();
const RUNS = [...SCENARIOS.map((sc) => ({ sc, edited: false })), { sc: SCENARIOS[0], edited: true }, { sc: SCENARIOS[1], edited: true }];

describe.skipIf(!hasWasmPackage())("the worker host's hourly delta", () => {
  for (const { sc, edited } of RUNS) {
    it(`keeps the read model equal to the engine's save on the ${sc.name} tower${edited ? ", with player edits" : ""}`, async () => {
      const sim = fromSave(sc.save);
      const h = await host("worker", sim);
      const w = h.worker!;
      const engine = (): ShadowEngine => (w.channel.core as unknown as { shadow: ShadowEngine }).shadow;
      let seen = 0;
      let checked = 0;
      try {
        await script(h, 2 * DAY_STEPS, (step, s) => {
          // The sync before this awaited the reply to every op sent, so the
          // read model is caught up whenever a save half arrived.
          const replies = w.channel.received.filter((m): m is Extract<FromWorker, { type: "frame" }> => m.type === "frame");
          const fresh = replies.slice(seen);
          seen = replies.length;
          if (fresh.some((r) => r.delta || r.merge)) {
            expect(ownSave(s), `after ${w.host.stats.deltas} deltas and ${w.host.stats.merges} full saves`).toEqual(JSON.parse(engine().handle().serialize()));
            checked++;
          }
          if (edited) edits(step, s);
        });
      } finally {
        h.detach();
      }
      expect(w.fatal).toEqual([]);
      expect(w.errors).toEqual([]);
      expect(w.host.stats.deltasRefused).toBe(0);
      expect(checked).toBeGreaterThanOrEqual(40);
      if (!edited) {
        // Two days of hour passes on an unchanged layout: every one goes
        // out as a delta, the first taken against the loaded save.
        expect(w.host.stats.merges).toBe(0);
        expect(w.host.stats.deltas).toBeGreaterThanOrEqual(40);
      } else {
        // The hour after each edit but the camera stamp and the rename (both
        // exempt) sends a full save.
        const hasOffice = (JSON.parse(sc.save) as { units: { kind: string }[] }).units.some((u) => u.kind === "office");
        expect(w.host.stats.merges).toBe(hasOffice ? 4 : 1);
        expect(w.host.stats.deltas).toBeGreaterThanOrEqual(36);
      }
    }, 600_000);
  }
});

/**
 * The keyframe rule's exempt list (`saveSyncRules.ts`): a command may skip
 * the full save only when it changes no unit record and the engine cannot
 * refuse it. Each op on the list has a case here that applies it to the
 * real engine; an op added without a case fails the coverage check below.
 */
const EXEMPT_CASES: Record<string, ShadowCommand[]> = {
  setView: [{ op: "setView", view: { tile: 140, floor: 3, zoom: 1.5 } }, { op: "setView", view: null }],
  emit: [{ op: "emit", text: "A log line.", kind: "info" }],
  setTowerName: [{ op: "setTowerName", name: "Delta Tower" }, { op: "setTowerName", name: null }, { op: "setTowerName", name: "" }],
};

/** Layout edits inside an hour: a build, then a demolition. Each moves the
 *  layout, so the hour pass after it is a full save (a delta never adds,
 *  removes or moves a unit), and the deltas resume after it. */
describe.skipIf(!hasWasmPackage())("the worker host's hourly delta across structural edits", () => {
  it("keeps the read model equal to the engine's save through a build and a demolition, and keeps the exact save", async () => {
    const sim = fromSave(buildScenarios()[0].save);
    const h = await host("worker", sim);
    const w = h.worker!;
    const engine = (): ShadowEngine => (w.channel.core as unknown as { shadow: ShadowEngine }).shadow;
    let seen = 0;
    let checked = 0;
    let built: { floor: number; x: number } | null = null;
    let carRemoved = false;
    try {
      await script(h, 2 * DAY_STEPS, (step, s) => {
        const replies = w.channel.received.filter((m): m is Extract<FromWorker, { type: "frame" }> => m.type === "frame");
        const fresh = replies.slice(seen);
        seen = replies.length;
        if (fresh.some((r) => r.delta || r.merge)) {
          expect(ownSave(s), `after ${w.host.stats.deltas} deltas and ${w.host.stats.merges} full saves`).toEqual(JSON.parse(engine().handle().serialize()));
          checked++;
        }
        if (step === 200) {
          s.money = s.money + 5_000_000;
          for (let x = 0; x < 400 && !built; x += 10) if (s.build("office", 2, x).ok) built = { floor: 2, x };
        }
        // A car taken off a lift: a transport edit, which moves the layout.
        if (step === 500) {
          const lift = s.tower.transports.find((t) => t.cars > 1);
          if (lift) carRemoved = s.setCars(lift.id, lift.cars - 1);
        }
        if (step === 800 && built) expect(s.sellAt(built.floor, built.x)).toBe(true);
      });
      expect(built, "an office was placed").not.toBeNull();
      // The exact save is the engine's, after the deltas and the edits.
      expect(await h.exactSave()).toEqual(JSON.parse(engine().handle().serialize()));
    } finally {
      h.detach();
    }
    expect(w.fatal).toEqual([]);
    expect(w.errors).toEqual([]);
    expect(w.host.stats.deltasRefused).toBe(0);
    expect(checked).toBeGreaterThanOrEqual(40);
    // The build, the car and the demolition each cost the hour pass after them a full
    // save (the money edit rides with the build's), and the rest were deltas.
    expect(carRemoved, "a transport edit ran").toBe(true);
    expect(w.host.stats.merges).toBeGreaterThanOrEqual(3);
    expect(w.host.stats.merges).toBeLessThanOrEqual(6);
    expect(w.host.stats.deltas).toBeGreaterThanOrEqual(36);
  }, 600_000);
});

/** A worker that dies in the middle of an hour, after deltas have been
 *  applied: the tower falls back to the TypeScript engine with the state of
 *  the last reply, runs on, and its save loads into a fresh worker whose
 *  first hour pass is a delta against that load. */
describe.skipIf(!hasWasmPackage())("the worker host's deltas and a crash", () => {
  const quiet = { info: () => {}, error: () => {} };
  const app = (sim: Simulation): WasmHostApp => {
    const a: WasmHostApp = { sim, adoptSim: (next) => { a.sim = next; } };
    return a;
  };
  const driven = (handle: WorkerHostHandle, a: WasmHostApp): Hosted => ({
    kind: "worker",
    sim: a.sim,
    sync: async () => {
      stepGate(a.sim)?.flush();
      await until(() => !stepGate(a.sim) || stepGate(a.sim)!.canStep(), "the reply");
    },
    exactSave: async () => {
      await handle.settle();
      return a.sim.serialize();
    },
    detach: () => handle.stop(),
  });

  it("falls back mid-hour after deltas with the last reply's state, and its save resumes on a fresh worker", async () => {
    const worker = spawned(wasm());
    const a = app(fromSave(buildScenarios()[0].save));
    const handle = startWorkerHost(a, worker, () => Promise.reject(new Error("no restart")), quiet);
    await until(() => handle.current()?.loaded() ?? false, "load");
    await script(driven(handle, a), DAY_STEPS);
    const sim = a.sim;
    const stats = handle.current()!.stats;
    expect(stats.deltas, "hour passes went out as deltas").toBeGreaterThanOrEqual(10);
    expect(stats.deltasRefused).toBe(0);
    sim.drainGameplayEvents();
    const applied = sim.clock.minutes;
    const ownSaveOf = (x: Simulation) => JSON.stringify(Simulation.prototype.serialize.call(x));
    const lastReplyState = ownSaveOf(sim);
    // A batch goes out and the worker dies before answering.
    sim.tick(2);
    sim.tick(2);
    stepGate(sim)!.flush();
    expect(stepGate(sim)!.canStep(), "a batch in flight").toBe(false);
    worker.worker.crash("boom");
    expect(handle.status.hosted).toBe(false);
    expect(sim.clock.minutes, "the steps no reply confirmed are given back").toBe(applied);
    expect(ownSaveOf(sim), "the state is the last reply's, deltas included").toBe(lastReplyState);
    // TypeScript runs it on over an hour boundary, and its save loads into a
    // fresh engine, which sends its first hour pass as a delta.
    for (let i = 0; i < 40; i++) sim.tick(2);
    const back = Simulation.deserialize(JSON.parse(JSON.stringify(sim.serialize())));
    const fresh = spawned(wasm());
    const b = app(back);
    const again = startWorkerHost(b, fresh, () => Promise.reject(new Error("no restart")), quiet);
    await until(() => again.current()?.loaded() ?? false, "the fresh worker to load the saved tower");
    await script(driven(again, b), 120);
    expect(again.status.errors).toEqual([]);
    expect(again.current()!.stats).toMatchObject({ deltasRefused: 0 });
    expect(again.current()!.stats.deltas).toBeGreaterThanOrEqual(1);
    expect(again.current()!.stats.merges).toBe(0);
    again.stop();
    handle.stop();
  }, 300_000);
});

describe.skipIf(!hasWasmPackage())("the keyframe rule's exempt commands", () => {
  it("has a case for every exempt op", () => {
    expect([...KEYFRAME_EXEMPT_OPS].sort()).toEqual(Object.keys(EXEMPT_CASES).sort());
  });

  for (const op of KEYFRAME_EXEMPT_OPS) {
    it(`${op} leaves every unit record alone and is never refused`, () => {
      const sc = buildScenarios()[0];
      const shadow = new ShadowEngine(wasm());
      shadow.apply({ op: "load", gen: 1, save: sc.save, markers: { lastHour: 0, lastDay: 0, lastQuarter: 0, lastMonth: 0 } });
      const saved = (): Record<string, unknown> => JSON.parse(shadow.handle().serialize()) as Record<string, unknown>;
      const before = saved().units;
      // The read model gets the same command by its own setter, as the
      // frame loop does; the engine's save must read the same afterwards,
      // so a delta that carries the save's remainder whole leaves them equal.
      const model = fromSave(sc.save);
      const apply: Record<string, (c: ShadowCommand) => void> = {
        setView: (c) => { model.view = (c as { view: Simulation["view"] }).view; },
        emit: () => {},
        setTowerName: (c) => { model.tower.towerName = (c as { name: string | null }).name as string; },
      };
      for (const cmd of EXEMPT_CASES[op] ?? []) {
        expect(() => shadow.apply(cmd)).not.toThrow();
        expect(saved().units).toEqual(before);
        apply[op](cmd);
        // A null name is the relay of a nullish one; the read model's name is
        // always a string, so only the strings are compared.
        if (op === "setTowerName" && (cmd as { name: unknown }).name !== null) expect(saved().towerName, JSON.stringify(cmd)).toEqual((JSON.parse(JSON.stringify(model.serialize())) as { towerName?: unknown }).towerName);
        if (op === "setView") expect(saved().view, JSON.stringify(cmd)).toEqual((JSON.parse(JSON.stringify(model.serialize())) as { view?: unknown }).view);
      }
      shadow.free();
    });
  }
});

describe.skipIf(!hasWasmPackage())("serializeForSync", () => {
  for (const sc of SCENARIOS) {
    it(`is the engine's serialize() text, before and after steps and deltas, on the ${sc.name} tower`, () => {
      const engine = wasm().Engine.fromSave(sc.save);
      try {
        expect(engine.serializeForSync()).toBe(engine.serialize());
        for (let hour = 0; hour < 3; hour++) {
          for (let i = 0; i < 30; i++) engine.tick(2);
          const before = engine.serialize();
          const delta = engine.saveDelta();
          expect(delta, "a delta against the last sync").toBeDefined();
          // Taking a delta moves nothing in the save the engine reports.
          expect(engine.serialize()).toBe(before);
          expect(engine.serializeForSync()).toBe(before);
        }
      } finally {
        engine.free();
      }
    });
  }
});
