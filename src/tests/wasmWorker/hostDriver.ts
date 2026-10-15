import { Simulation } from "../../engine/Simulation";
import type { Person } from "../../engine/crowd/person";
import { canonicalJson } from "../../engine/canonicalJson";
import { stateView } from "../../engine/conformanceView";
import { quantumFor } from "../../engine/sim/fixedStep";
import { SPEEDS, advanceOwedMinutes } from "../../game/frameLoop";
import type { StepDebt } from "../../engine/sim/fixedStep";
import { attachWasmHost, type WasmHost } from "../../wasmhost/wasmHost";
import { attachWorkerHost, type WorkerHost } from "../../wasmhost/workerHost";
import { stepGate } from "../../wasmhost/stepGate";
import { wasm } from "../conformance/wasmEngine";
import { testWorker, until, type TestWorker } from "./channel";

/**
 * The three hosts of the WASM engine behind one driver, so a test runs the
 * same steps and the same commands on each and compares what comes out:
 * "step" (the shipped host, synced after every step), "frame" (the
 * coalesced main-thread host) and "worker" (the worker host on the real
 * package behind a message channel).
 */
export type HostKind = "step" | "frame" | "worker";

export interface Hosted {
  kind: HostKind;
  sim: Simulation;
  /** Bring the read model up to date (for the worker: send the batch and
   *  wait for its reply). Called where a frame loop would flush. */
  sync(): Promise<void>;
  /** The engine's exact save, with the read model caught up. */
  exactSave(): Promise<unknown>;
  detach(): void;
  main?: WasmHost;
  worker?: { host: WorkerHost; channel: TestWorker; fatal: string[]; errors: string[] };
}

export async function host(kind: HostKind, sim: Simulation, gen = 1): Promise<Hosted> {
  if (kind !== "worker") {
    const main = attachWasmHost(sim, wasm(), { sync: kind });
    return {
      kind, sim, main,
      sync: async () => { stepGate(sim)?.flush(); },
      exactSave: async () => { main.syncStructure(); return JSON.parse(main.engine.serialize()); },
      detach: () => main.detach(),
    };
  }
  const channel = testWorker(wasm());
  const fatal: string[] = [];
  const errors: string[] = [];
  const h = attachWorkerHost(sim, {
    gen,
    catalogs: channel.core.catalogs(),
    send: (m, t) => channel.postMessage(m, t),
    onFatal: (m) => fatal.push(m),
    onError: (m) => errors.push(m),
  });
  channel.onmessage = (e) => h.receive(e.data);
  await until(() => h.loaded() || fatal.length > 0, "the worker to load the tower");
  const gate = () => stepGate(sim);
  return {
    kind, sim,
    worker: { host: h, channel, fatal, errors },
    sync: async () => {
      gate()?.flush();
      await until(() => !gate() || gate()!.canStep() || fatal.length > 0, "the worker's reply");
      if (fatal.length > 0) throw new Error(`worker host failed: ${fatal.join("; ")}`);
    },
    exactSave: async () => {
      await h.settle();
      return sim.serialize();
    },
    detach: () => {
      h.detach();
      channel.terminate();
    },
  };
}

/** Run `steps` fixed steps at the fastest speed, sized from the clock as
 *  the frame loop sizes them, syncing every `batch` steps (the frame loop's
 *  cap of four) and running `at(step)` commands at batch boundaries. */
export async function script(h: Hosted, steps: number, at: (step: number, sim: Simulation) => void = () => {}, batch = 4): Promise<void> {
  const rate = SPEEDS[3];
  for (let s = 0; s < steps; s++) {
    if (s % batch === 0) {
      await h.sync();
      at(s, h.sim);
    }
    h.sim.tick(quantumFor(rate, h.sim.clock.minuteOfDay));
  }
  await h.sync();
}

/** The read model's own state view (its `serialize` is the host's while
 *  hosted, so the prototype's runs here). */
export function ownStateView(sim: Simulation): string {
  const own = Object.getOwnPropertyDescriptor(sim, "serialize");
  if (own) delete (sim as Partial<Simulation>).serialize;
  try {
    return canonicalJson(stateView(sim));
  } finally {
    if (own) Object.defineProperty(sim, "serialize", own);
  }
}

/** The person fields a frame carries, as the read model holds them. */
export function framePeople(sim: Simulation): unknown[] {
  return sim.crowd.people.map((p: Person) => ({
    id: p.id, seed: p.seed, state: p.state, floor: p.floor, x: p.x, fy: p.fy, wait: p.wait, originFloor: p.originFloor,
    originUnitId: p.originUnitId, venueUnitId: p.venueUnitId, mealVenueId: p.mealVenueId, routine: p.routine, dwellSecondsLeft: p.dwellSecondsLeft,
    floors: [...p.floors], shafts: [...p.shafts], staff: p.staff, countedHotelGuest: p.countedHotelGuest, returning: p.returning,
  }));
}

/** The cars and unit counters a frame carries. */
export function frameMotion(sim: Simulation): unknown {
  return {
    cars: sim.tower.transports.map((t) => ({ id: t.id, pos: [...t.carPositions], dir: [...t.carDir], load: t.carLoad ? [...t.carLoad] : null })),
    units: sim.tower.units.map((u) => ({ id: u.id, state: u.state, occ: u.occupants, c: u.customersIn, h: u.hotelCustomersIn, m: u.outForMeal })),
  };
}

/** A fresh tower from a save text. */
export function fromSave(save: string): Simulation {
  return Simulation.deserialize(JSON.parse(save));
}

/** Drive the host through the frame loop's own owed-minute math, as
 *  `runFrame` does: per frame, the gate decides whether the frame steps,
 *  then the flush. `speeds` gives each frame's speed index (0 pauses), and
 *  the frame time cycles 60, 30 and 120 Hz. The worker host's reply is
 *  awaited after each frame, so every host steps the same sequence. */
export async function frames(h: Hosted, speeds: readonly number[], steadyClock = false): Promise<void> {
  const host = { sim: h.sim, accMinutes: 0 };
  const debt: StepDebt = { minutes: 0 };
  const dts = [1000 / 60, 1000 / 30, 1000 / 120];
  for (let f = 0; f < speeds.length; f++) {
    const gate = stepGate(h.sim);
    advanceOwedMinutes(host, debt, dts[f % dts.length], SPEEDS[speeds[f]] ?? 0, steadyClock, gate ? gate.canStep() : true);
    await h.sync();
  }
}
