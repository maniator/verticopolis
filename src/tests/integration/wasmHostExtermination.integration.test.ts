import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { attachWasmHost } from "../../wasmhost/wasmHost";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

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
    host.syncStructure();
    sim.tick(60);
    host.syncStructure();
    host.detach();
    expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
    // Back on the TypeScript loop: 08:00 on the due day lands the treatment.
    for (let hour = 0; hour < 24; hour++) sim.tick(60);
    expect([sim.clock.day, sim.clock.hour]).toEqual([1, 8]);
    expect(sim.tower.getUnit(paid.unitId!)!.state).toBe("empty");
    expect(sim.tower.getUnit(later.unitId!)!.state).toBe("infested");
    expect(sim.exterminationDueDay).toBeUndefined();
  });
});
