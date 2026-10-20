import { afterEach, describe, expect, it, vi } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { quantumFor } from "../../engine/sim/fixedStep";
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
    const host = attachWasmHost(sim, wasm());
    try {
      host.syncStructure();
      expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
      expect(JSON.parse(host.engine.serialize()).exterminationRoomIds).toEqual([paid.unitId]);
      // From 07:00 on day 0, 25 hourly ticks reach 08:00 on the due day, when
      // the Modern housekeeping shift lands the treatment.
      for (let hour = 0; hour < 25; hour++) sim.tick(60);
      host.syncStructure();
      expect([sim.clock.day, sim.clock.hour]).toEqual([1, 8]);
      expect(sim.tower.getUnit(paid.unitId!)!.state).toBe("empty");
      expect(sim.tower.getUnit(later.unitId!)!.state).toBe("infested");
      expect(sim.exterminationDueDay).toBeUndefined();
      expect(sim.exterminationRoomIds).toBeUndefined();
    } finally {
      host.detach();
    }
    expect(sim.exterminationRoomIds).toBeUndefined();
    expect(sim.callExterminator()).toMatchObject({ ok: true, rooms: 1 });
  });

  it("keeps the treatment to the billed rooms when the host lets go mid-booking", () => {
    const { sim, paid, later } = booked();
    const host = attachWasmHost(sim, wasm());
    try {
      host.syncStructure();
      sim.tick(60);
      host.syncStructure();
    } finally {
      host.detach();
    }
    expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
    // Back on the TypeScript loop: 08:00 on the due day lands the treatment.
    for (let hour = 0; hour < 24; hour++) sim.tick(60);
    expect([sim.clock.day, sim.clock.hour]).toEqual([1, 8]);
    expect(sim.tower.getUnit(paid.unitId!)!.state).toBe("empty");
    expect(sim.tower.getUnit(later.unitId!)!.state).toBe("infested");
    expect(sim.exterminationDueDay).toBeUndefined();
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
    // A trap in a command: the newest point is the undo capture's save.
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
      expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
      if (path === "command") a.captureUndo("Lobby");
      trapAfter(h.current()!.engine, path === "tick" ? "tick" : "build");
      trap(sim);
      if (path === "command") a.commitUndo();
      expect(h.status.lastFallback).toEqual({ reason: path === "tick" ? "trap-tick" : "trap-command", stage: "start" });
      await settle();
      const fresh = a.sim;
      expect(fresh).not.toBe(sim);
      expect(h.status.hosted).toBe(false);
      expect(fresh.log[fresh.log.length - 1].text).toBe(line);
      // The tower came back from a point the engine wrote after the attach,
      // with the booking as it was.
      expect(fresh.clock.minutes).toBeGreaterThan(startedAt);
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

/** Step the worker host at the fastest speed, four steps a frame as the
 *  frame loop caps them, to 08:00 on the due day. */
async function workerToTreatment(h: Hosted): Promise<void> {
  for (let frame = 0; frame < 2_000; frame++) {
    await h.sync();
    if (h.sim.clock.day > 1 || (h.sim.clock.day === 1 && h.sim.clock.hour >= 8)) break;
    for (let step = 0; step < 4; step++) h.sim.tick(quantumFor(SPEEDS[3], h.sim.clock.minuteOfDay));
  }
  expect([h.sim.clock.day, h.sim.clock.hour]).toEqual([1, 8]);
}

/**
 * The worker host attaches from the instance's save and adopts the engine's
 * state through the same `mergeSimulation` (#902). PR #1068 rewrites that
 * merge and adds an hourly save delta, so these pin the adoption of the
 * booked list for the worker host, across hourly passes.
 */
describe.skipIf(!hasWasmPackage())("the worker host with a pending exterminator (#902)", () => {
  it("keeps the billed rooms through the worker's attach and merges, and the engine treats only them", async () => {
    const { sim, paid, later } = booked();
    const h = await host("worker", sim);
    try {
      await h.worker!.host.settle();
      expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
      expect((h.sim.serialize() as { exterminationRoomIds?: number[] }).exterminationRoomIds).toEqual([paid.unitId]);
      await workerToTreatment(h);
      await h.worker!.host.settle();
      treatedBilledOnly(sim, paid, later);
      expect(h.worker!.fatal).toEqual([]);
      expect(h.worker!.errors).toEqual([]);
    } finally {
      h.detach();
    }
  });

  it("keeps the treatment to the billed rooms when the worker host lets go mid-booking", async () => {
    const { sim, paid, later } = booked();
    const h = await host("worker", sim);
    try {
      for (let frame = 0; frame < 15; frame++) {
        for (let step = 0; step < 4; step++) sim.tick(quantumFor(SPEEDS[3], sim.clock.minuteOfDay));
        await h.sync();
      }
      await h.worker!.host.settle();
      // Past at least one hourly pass, and still on the booking day.
      expect(sim.clock.hour).toBeGreaterThanOrEqual(8);
      expect(sim.clock.day).toBe(0);
      expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
      expect(h.worker!.fatal).toEqual([]);
    } finally {
      h.detach();
    }
    expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
    // Back on the TypeScript loop.
    toTreatment(sim);
    treatedBilledOnly(sim, paid, later);
  });
});
