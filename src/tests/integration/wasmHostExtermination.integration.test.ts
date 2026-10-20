import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { MAX_STEPS_PER_FRAME, quantumFor } from "../../engine/sim/fixedStep";
import { SPEEDS } from "../../game/frameLoop";
import { attachWasmHost } from "../../wasmhost/wasmHost";
import { startWasmHost } from "../../wasmhost/startWasmHost";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";
import { host, type Hosted } from "../wasmWorker/hostDriver";
import { freePoisoned, trapAfter } from "./wasmTraps";
import { RESTORED, UNDONE, gameApp, settle } from "./wasmRollback";

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 requires the engine package");

/** A Modern tower booked for one infested room, with a second room infested
 *  after the booking. */
function booked(): { sim: Simulation; paid: { unitId?: number }; later: { unitId?: number } } {
  const sim = Simulation.newGame(902, "modern");
  sim.money = 1e8;
  for (let x = 170; x < 220; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = 170; x < 220; x++) expect(sim.tower.place("floor", 2, x).ok).toBe(true);
  const paid = sim.tower.place("hotelSingle", 2, 170);
  const later = sim.tower.place("hotelSingle", 2, 190);
  expect(paid.ok).toBe(true);
  expect(later.ok).toBe(true);
  sim.tower.getUnit(paid.unitId!)!.state = "infested";
  expect(sim.callExterminator()).toMatchObject({ ok: true, rooms: 1 });
  sim.tower.getUnit(later.unitId!)!.state = "infested";
  return { sim, paid, later };
}

/** Tick the TypeScript loop an hour at a time to 08:00 on the due day, when
 *  the Modern housekeeping shift lands the treatment. */
function toTreatment(sim: Simulation): void {
  for (let hour = 0; hour < 48 && !(sim.clock.day === 1 && sim.clock.hour === 8); hour++) sim.tick(60);
  expect([sim.clock.day, sim.clock.hour]).toEqual([1, 8]);
}

/** The billed room is treated and the room infested after the booking is
 *  not, so the treatment kept to the booked list. */
function treatedBilledOnly(sim: Simulation, paid: { unitId?: number }, later: { unitId?: number }): void {
  expect(sim.tower.getUnit(paid.unitId!)!.state).toBe("empty");
  expect(sim.tower.getUnit(later.unitId!)!.state).toBe("infested");
  expect(sim.exterminationDueDay).toBeUndefined();
  expect(sim.exterminationRoomIds).toBeUndefined();
}

afterEach(freePoisoned);

describe.skipIf(!hasWasmPackage())("WASM attach with a pending exterminator", () => {
  it("keeps billed IDs through attach, merge, treatment and detach", () => {
    const { sim, paid, later } = booked();
    const attached = attachWasmHost(sim, wasm());
    try {
      attached.syncStructure();
      expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
      expect(JSON.parse(attached.engine.serialize()).exterminationRoomIds).toEqual([paid.unitId]);
      // From 07:00 on day 0, 25 hourly ticks reach 08:00 on the due day, when
      // the Modern housekeeping shift lands the treatment.
      for (let hour = 0; hour < 25; hour++) sim.tick(60);
      attached.syncStructure();
      expect([sim.clock.day, sim.clock.hour]).toEqual([1, 8]);
      treatedBilledOnly(sim, paid, later);
    } finally {
      attached.detach();
    }
    expect(sim.exterminationRoomIds).toBeUndefined();
    expect(sim.callExterminator()).toMatchObject({ ok: true, rooms: 1 });
  });

  it("keeps the treatment to the billed rooms when the host lets go mid-booking", () => {
    const { sim, paid, later } = booked();
    const attached = attachWasmHost(sim, wasm());
    try {
      attached.syncStructure();
      sim.tick(60);
      attached.syncStructure();
    } finally {
      attached.detach();
    }
    expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
    // Back on the TypeScript loop: 08:00 on the due day lands the treatment.
    toTreatment(sim);
    treatedBilledOnly(sim, paid, later);
  });
});

/**
 * S4's booking case (#874, #902): an engine that traps mid-booking falls back
 * to TypeScript from the newest restore point, which is an engine-written
 * save, so the booked list must survive the engine's writer and the
 * TypeScript loader for the treatment to keep to the billed rooms.
 * Temporary, with the fallback.
 */
describe.skipIf(!hasWasmPackage())("an engine trap mid-booking falls back and keeps the treatment (#874)", () => {
  it.each([
    // A trap in a tick: the newest point is the last merge's save.
    { path: "tick", line: RESTORED, trap: (sim: Simulation) => sim.tick(60) },
    // A trap in a command: the newest point is the undo capture's save, a
    // minute after the last merge (a step with no hour pass merges nothing).
    { path: "command", line: UNDONE, trap: (sim: Simulation) => expect(sim.build("lobby", 1, 220).ok).toBe(true) },
  ])("after a trap in a $path, the TypeScript loop treats only the billed room", async ({ path, line, trap }) => {
    const { sim, paid, later } = booked();
    const startedAt = sim.clock.minutes;
    const a = gameApp(sim);
    const h = startWasmHost(a, wasm(), { info: vi.fn(), error: vi.fn() });
    try {
      expect(h.status.hosted).toBe(true);
      // Three hosted hours: each hour's merge is a restore point the engine wrote.
      for (let hour = 0; hour < 3; hour++) sim.tick(60);
      expect(sim.clock.minutes).toBe(startedAt + 180);
      expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
      if (path === "command") {
        sim.tick(1);
        a.captureUndo("Lobby");
      }
      trapAfter(h.current()!.engine, path === "tick" ? "tick" : "build");
      trap(sim);
      if (path === "command") a.commitUndo();
      expect(h.status.lastFallback).toEqual({ reason: path === "tick" ? "trap-tick" : "trap-command", stage: "start" });
      await settle();
      const fresh = a.sim;
      expect(fresh).not.toBe(sim);
      expect(h.status.hosted).toBe(false);
      expect(fresh.log.length).toBeGreaterThan(0);
      expect(fresh.log[fresh.log.length - 1].text).toBe(line);
      // The tower came back from the newest point the engine wrote after the
      // attach (the last merge's, or the capture's a minute later), with the
      // booking as it was.
      expect(fresh.clock.minutes).toBe(startedAt + (path === "tick" ? 180 : 181));
      expect(fresh.clock.day).toBe(0);
      expect(fresh.exterminationDueDay).toBe(1);
      expect(fresh.exterminationRoomIds).toEqual([paid.unitId]);
      expect(fresh.tower.getUnit(paid.unitId!)!.state).toBe("infested");
      expect(fresh.tower.getUnit(later.unitId!)!.state).toBe("infested");
      toTreatment(fresh);
      treatedBilledOnly(fresh, paid, later);
    } finally {
      h.stop();
    }
  });
});

/** One frame at the fastest speed: the frame loop's four steps, each sized
 *  from the clock, then the flush and the worker's reply. */
async function workerFrame(h: Hosted): Promise<void> {
  for (let step = 0; step < MAX_STEPS_PER_FRAME; step++) h.sim.tick(quantumFor(SPEEDS[3], h.sim.clock.minuteOfDay));
  await h.sync();
}

/** Run the worker host a frame at a time until the read model's clock is
 *  in `hour` on `day`. */
async function workerUntil(h: Hosted, day: number, hour: number): Promise<void> {
  for (let frame = 0; frame < 2_000; frame++) {
    if (h.sim.clock.day > day || (h.sim.clock.day === day && h.sim.clock.hour >= hour)) break;
    await workerFrame(h);
  }
  expect([h.sim.clock.day, h.sim.clock.hour]).toEqual([day, hour]);
}

/**
 * The worker host attaches from the instance's save and adopts the engine's
 * state through the same `mergeSimulation` (#902). PR #1068 rewrites that
 * merge and adds an hourly save delta, so these pin the adoption of the
 * booked list for the worker host on both paths: the full save a settle
 * asks for, and the hour pass's own reply.
 */
describe.skipIf(!hasWasmPackage())("the worker host with a pending exterminator (#902)", () => {
  it("keeps the billed rooms through the worker's attach, and the engine treats only them", async () => {
    const { sim, paid, later } = booked();
    const h = await host("worker", sim);
    const worker = h.worker!;
    try {
      await worker.host.settle();
      expect(worker.host.loaded()).toBe(true);
      // The settle's merge kept the list on the read model.
      expect(worker.host.stats.merges).toBeGreaterThan(0);
      expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
      // The engine's own exact save carries the list: no approximate save
      // from the read model was taken.
      const approximate = worker.host.stats.approximateSaves;
      expect((sim.serialize() as { exterminationRoomIds?: number[] }).exterminationRoomIds).toEqual([paid.unitId]);
      expect(worker.host.stats.approximateSaves).toBe(approximate);
      await workerUntil(h, 1, 8);
      await worker.host.settle();
      treatedBilledOnly(sim, paid, later);
      expect(worker.fatal).toEqual([]);
      expect(worker.errors).toEqual([]);
    } finally {
      h.detach();
    }
  });

  it("puts the list back on the hour's merge, and keeps the treatment to it when the worker host lets go", async () => {
    const { sim, paid, later } = booked();
    const h = await host("worker", sim);
    const worker = h.worker!;
    try {
      await h.sync();
      expect(worker.host.loaded()).toBe(true);
      // Cleared on the read model, the list can only come back from the
      // engine's state, which the 08:00 hour pass sends with its reply (no
      // settle here, so this is the hourly path).
      sim.exterminationRoomIds = undefined;
      await workerUntil(h, 0, 8);
      expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
      expect(worker.fatal).toEqual([]);
      expect(worker.errors).toEqual([]);
    } finally {
      h.detach();
    }
    expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
    // Back on the TypeScript loop.
    toTreatment(sim);
    treatedBilledOnly(sim, paid, later);
  });
});
