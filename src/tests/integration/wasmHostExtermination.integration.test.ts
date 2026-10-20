import { describe, expect, it } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { attachWasmHost } from "../../wasmhost/wasmHost";
import { hasWasmPackage, wasm, wasmRequired } from "../conformance/wasmEngine";

if (wasmRequired() && !hasWasmPackage()) throw new Error("VC_REQUIRE_WASM=1 requires the engine package");

describe.skipIf(!hasWasmPackage())("WASM attach with a pending exterminator", () => {
  it("keeps billed IDs through attach, merge, treatment and detach", () => {
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
    const host = attachWasmHost(sim, wasm());
    try {
      host.syncStructure();
      expect(sim.exterminationRoomIds).toEqual([paid.unitId]);
      expect(JSON.parse(host.engine.serialize()).exterminationRoomIds).toEqual([paid.unitId]);
      for (let hour = 0; hour < 24; hour++) sim.tick(60);
      host.syncStructure();
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
});
