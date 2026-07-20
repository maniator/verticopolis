import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";

const W = GRID.width;
const C = Math.floor(W / 2);
const DAY = 60 * 24;

function layFull(sim: Simulation, kind: "floor" | "lobby", floor: number): void {
  for (let x = C; x < W; x++) sim.tower.place(kind, floor, x);
  for (let x = C - 1; x >= 0; x--) sim.tower.place(kind, floor, x);
}

// Strand floor 40: an elevator reaches floor 30, then a 15-flight stair chain
// climbs to 45. Floor 40 sits 10 flights above the elevator top, past Classic's
// walk budget of 4, so it is SERVED (the network connects it) but no commuter
// will make the climb. Reachability is uncapped now (#503), so a too-long stair
// climb is the only thing that strands a connected floor.
function stairStrand(sim: Simulation): void {
  sim.tower.placeTransport("elevatorStandard", C, 1, 30); // reaches control floor 14 and floor 30
  for (let f = 30; f < 45; f++) sim.tower.placeTransport("stairs", C + 20, f, f + 1);
}

describe("Legibility — functionalParkingSet (Tower)", () => {
  it("exposes the chained set; count delegates; dead space excluded", () => {
    const sim = Simulation.newGame(1);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 0);
    sim.tower.place("parkingRamp", 0, C);
    const a = sim.tower.place("parking", 0, C + 16); // chained flush to the 16-wide ramp
    const b = sim.tower.place("parking", 0, C + 100); // isolated → dead
    const set = sim.tower.functionalParkingSet();
    expect(set.has(a.unitId!)).toBe(true);
    expect(set.has(b.unitId!)).toBe(false);
    expect(sim.tower.functionalParkingSpots()).toBe(set.size); // delegation invariant
    sim.tower.place("parking", 0, C + 20); // chain-extends flush off a
    expect(sim.tower.functionalParkingSet().size).toBe(2); // C+16 and C+20 now both chained
  });

  it("stacked parking with no ramp between floors is not connected", () => {
    const sim = Simulation.newGame(2);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 0);
    layFull(sim, "floor", -1);
    sim.tower.place("parkingRamp", -1, C);
    sim.tower.place("parking", -1, C + 16); // chained flush on B2
    const up = sim.tower.place("parking", 0, C + 16); // directly above, but no ramp on B1
    expect(sim.tower.functionalParkingSet().has(up.unitId!)).toBe(false);
  });
});

describe("Legibility — reachability & stranded floors (Simulation)", () => {
  function strandedTower(seed: number): Simulation {
    const sim = Simulation.newGame(seed);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    for (let f = 2; f <= 45; f++) layFull(sim, "floor", f);
    stairStrand(sim);
    const r = sim.tower.place("office", 40, C + 30); // a tenant up the long stair climb
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    return sim;
  }

  it("floorReachable distinguishes served-but-unreachable (long climb) from truly reachable", () => {
    const sim = strandedTower(3);
    expect(sim.floorReachable(1)).toBe(true);
    expect(sim.tower.isFloorServed(40)).toBe(true); // a shaft stops there
    expect(sim.floorReachable(40)).toBe(false); // ...but only via a 10-flight climb
    expect(sim.strandedFloors()).toContain(40);

    // An elevator 30→45 shortcuts the stair climb (1→30 by A, 30→40 by the new
    // shaft: two rides, no long walk), so floor 40 is reachably-close.
    expect(sim.tower.placeTransport("elevatorStandard", C - 10, 30, 45).ok).toBe(true);
    expect(sim.floorReachable(40)).toBe(true);
    expect(sim.strandedFloors()).not.toContain(40);
  });

  it("strandedFloors excludes tenant-less, below-ground, and reachable floors", () => {
    const sim = Simulation.newGame(4);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 2);
    sim.tower.placeTransport("elevatorStandard", C, 1, 2);
    const r = sim.tower.place("office", 2, 0);
    sim.tower.units.find((u) => u.id === r.unitId)!.state = "occupied";
    expect(sim.strandedFloors()).toEqual([]); // floor 2 is reachable; nothing stranded
  });

  it("emits the stranded nudge once per 0→>0 crossing, not repeatedly", () => {
    const sim = strandedTower(5);
    const count = () => sim.log.filter((e) => e.text.includes("reachable only by a long stair climb")).length;
    sim.tick(DAY);
    expect(count()).toBe(1); // fired on the crossing
    sim.tick(DAY);
    expect(count()).toBe(1); // still stranded → no duplicate
  });
});

describe("Legibility — reachability gates move-ins (Simulation)", () => {
  /** Like strandedTower, but with empty rentable units instead of a tenant:
   *  condo/office/hotel on floor 40 (served, but reachable only up a too-long
   *  stair climb) and a control condo on floor 14 (one ride up the elevator). */
  function strandedMoveInTower(seed: number): {
    sim: Simulation;
    unit: (id: number) => { state: string; everOccupied: boolean };
    ids: { condo40: number; office40: number; hotel40: number; condo14: number };
  } {
    const sim = Simulation.newGame(seed);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    for (let f = 2; f <= 45; f++) layFull(sim, "floor", f);
    // Floor 40 is served (an elevator + a 15-flight stair chain connect it) but
    // reachably-close only past Classic's walk budget, so no commuter climbs it.
    stairStrand(sim);
    const room = (kind: "condo" | "office" | "hotelSingle", floor: number, x: number) => {
      const r = sim.tower.place(kind, floor, x);
      expect(r.ok).toBe(true);
      return r.unitId!;
    };
    const ids = {
      condo40: room("condo", 40, 20),
      office40: room("office", 40, 60),
      hotel40: room("hotelSingle", 40, 100),
      condo14: room("condo", 14, 20),
    };
    const unit = (id: number) => sim.tower.units.find((u) => u.id === id)!;
    return { sim, unit, ids };
  }

  it("no tenant kind moves in on a served but unreachable floor (long climb), while a reachable floor fills", () => {
    const { sim, unit, ids } = strandedMoveInTower(8);
    expect(sim.tower.isFloorServed(40)).toBe(true); // served, so only the reachability gate blocks
    sim.tick(7 * DAY); // a week of hourly move-in rolls
    expect(unit(ids.condo40).state).toBe("empty");
    expect(unit(ids.condo40).everOccupied).toBe(false); // no sale banked
    expect(unit(ids.office40).state).toBe("empty");
    expect(unit(ids.hotel40).everOccupied).toBe(false); // never filled, even in the evenings
    expect(unit(ids.condo14).everOccupied).toBe(true); // control: demand itself is alive
  });

  it("move-ins resume once a bridge connects the floor to the lobby", () => {
    const { sim, unit, ids } = strandedMoveInTower(9);
    sim.tick(2 * DAY);
    expect(unit(ids.condo40).everOccupied).toBe(false);
    // An elevator 30→45 shortcuts the stair climb (1→30 by A, 30→40 by the new shaft).
    expect(sim.tower.placeTransport("elevatorStandard", C - 10, 30, 45).ok).toBe(true);
    sim.tick(3 * DAY);
    expect(unit(ids.condo40).everOccupied).toBe(true);
  });

  it("a condo already sold on a stranded floor survives save/load untouched", () => {
    const { sim, ids } = strandedMoveInTower(10);
    const before = sim.tower.units.find((u) => u.id === ids.condo40)!;
    before.state = "occupied"; // sold under the old rules (the SixSeven shape)
    before.everOccupied = true;
    before.rent = 160_000;
    const loaded = Simulation.deserialize(sim.serialize());
    loaded.tick(2 * DAY);
    const after = loaded.tower.units.find((u) => u.kind === "condo" && u.floor === 40)!;
    expect(after.state).toBe("occupied"); // no retroactive eviction
    expect(after.everOccupied).toBe(true); // no buy-back reversal
  });

  it("the daily advisory covers a stranded floor of still-empty units; stats scope stays leased-only", () => {
    const { sim } = strandedMoveInTower(11);
    // Wide scope sees the empty units; the stats-modal (leased) scope does not.
    expect(sim.strandedFloors("rentable")).toContain(40);
    expect(sim.strandedFloors()).toEqual([]);
    const entries = () => sim.log.filter((e) => e.text.includes("reachable only by a long stair climb"));
    sim.tick(DAY);
    expect(entries()).toHaveLength(1); // fired with nothing leased up there
    expect(entries()[0].kind).toBe("info"); // log-only advisory, never a toast
    sim.tick(DAY);
    expect(entries()).toHaveLength(1); // latched while the condition persists
  });

  it("a dirty hotel room keeps its stranded floor in the rentable scope (it is rentable again once cleaned)", () => {
    const { sim, unit, ids } = strandedMoveInTower(12);
    const hotel = sim.tower.units.find((u) => u.id === ids.hotel40)!;
    hotel.state = "dirty"; // guest checked in while reachable, checked out after the shaft was lost
    // Remove the other floor-40 units so the dirty room alone must carry the scope.
    for (const id of [ids.condo40, ids.office40]) sim.tower.removeUnit(id);
    expect(sim.strandedFloors("rentable")).toContain(40);
    expect(sim.strandedFloors()).toEqual([]); // dirty is not leased
    sim.tick(DAY);
    expect(unit(ids.hotel40).state).toBe("dirty"); // and the gate never refills it
  });

  it("a stranded floor of only gutted/burning/under-construction shells draws no advisory", () => {
    const { sim } = strandedMoveInTower(13);
    const floor40 = sim.tower.units.filter((u) => u.floor === 40 && u.kind !== "floor");
    floor40[0].state = "gutted";
    floor40[1].state = "construction";
    floor40[2].state = "fire";
    expect(sim.strandedFloors("rentable")).toEqual([]); // nothing rentable up there
    sim.tick(DAY);
    expect(sim.log.filter((e) => e.text.includes("reachable only by a long stair climb"))).toHaveLength(0);
  });

  it("shift: a reachable floor that loses its shortcut stops filling, keeps its tenants, and re-nudges", () => {
    const { sim, unit, ids } = strandedMoveInTower(14);
    // Make floor 40 reachable (1 → 15 → 40) and let the condo sell.
    const shortcut = sim.tower.placeTransport("elevatorStandard", C - 10, 30, 45);
    expect(shortcut.ok).toBe(true);
    sim.tick(3 * DAY);
    expect(unit(ids.condo40).everOccupied).toBe(true);
    const entries = () => sim.log.filter((e) => e.text.includes("reachable only by a long stair climb"));
    expect(entries()).toHaveLength(0); // nothing stranded yet, latch is unarmed

    // The shortcut goes away: the floor shifts reachable → stranded.
    sim.tower.removeTransport(shortcut.transportId!);
    expect(sim.floorReachable(40)).toBe(false);
    expect(sim.tower.isFloorServed(40)).toBe(true);
    // Fresh inventory placed after the shift is what the gate must starve
    // (the units from the reachable era may have legitimately filled).
    const lateCondo = sim.tower.place("condo", 40, 140).unitId!;
    sim.tick(3 * DAY);
    expect(unit(ids.condo40).everOccupied).toBe(true); // no retroactive eviction
    expect(unit(lateCondo).everOccupied).toBe(false); // and nothing new moves in
    expect(unit(lateCondo).state).toBe("empty");
    expect(entries()).toHaveLength(1); // the advisory announced the shift
  });

  it("the local chain reaches every band uncapped; express is a convenience; a broken chain strands the island (#503)", () => {
    const sim = Simulation.newGame(16);
    sim.money = 1e12;
    const skyset = new Set([15, 30]);
    layFull(sim, "lobby", 1);
    for (let f = 2; f <= 45; f++) layFull(sim, skyset.has(f) ? "lobby" : "floor", f);
    expect(sim.tower.placeTransport("elevatorStandard", C, 1, 15).ok).toBe(true); // A
    const b = sim.tower.placeTransport("elevatorStandard", C + 6, 15, 30); // B (the middle link)
    expect(b.ok).toBe(true);
    expect(sim.tower.placeTransport("elevatorStandard", C + 12, 30, 45).ok).toBe(true); // C
    // The A→B→C local chain already reaches every floor (uncapped, #503), no express needed.
    for (let f = 2; f <= 45; f++) expect(sim.floorReachable(f)).toBe(true);
    // An express is a speed convenience; adding then removing it changes nothing.
    const ex = sim.tower.placeTransport("elevatorExpress", C + 20, 1, 45);
    expect(ex.ok).toBe(true);
    sim.tower.removeTransport(ex.transportId!);
    for (let f = 2; f <= 45; f++) expect(sim.floorReachable(f)).toBe(true);
    // Breaking the CHAIN strands: remove the middle link B and the 30..45 band is
    // an island (no shaft bridges 15..30).
    sim.tower.removeTransport(b.transportId!);
    expect(sim.floorReachable(15)).toBe(true); // ground band intact
    expect(sim.floorReachable(30)).toBe(false); // island: served by C but cut off from the lobby
    expect(sim.floorReachable(45)).toBe(false);
  });

  it("shift: the advisory latch re-arms after the floor is fixed, and fires again on a relapse", () => {
    const { sim } = strandedMoveInTower(15);
    const entries = () => sim.log.filter((e) => e.text.includes("reachable only by a long stair climb"));
    sim.tick(DAY);
    expect(entries()).toHaveLength(1); // stranded from the start → first nudge

    // Fix it: floor 40 becomes reachable, the condition clears, the latch re-arms.
    const shortcut = sim.tower.placeTransport("elevatorStandard", C - 10, 30, 45);
    expect(shortcut.ok).toBe(true);
    sim.tick(DAY);
    expect(entries()).toHaveLength(1); // cleared → no new nudge

    // Relapse: the shortcut is demolished, the same floor strands again.
    sim.tower.removeTransport(shortcut.transportId!);
    sim.tick(DAY);
    expect(entries()).toHaveLength(2); // a fresh crossing fires a fresh advisory
  });
});

describe("Legibility — rating & stats (Simulation)", () => {
  it("hotelsCountTowardRating flips at 4★ and rating population diverges", () => {
    const sim = Simulation.newGame(6);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 2);
    for (let i = 0, x = 0; i < 40 && x + 4 <= W; i++, x += 4) {
      const r = sim.tower.place("hotelSingle", 2, x);
      if (r.ok) sim.tower.units.find((u) => u.id === r.unitId)!.state = "asleep";
    }
    sim.star = 3;
    expect(sim.hotelsCountTowardRating()).toBe(true);
    expect(sim.ratingPopulation()).toBe(sim.population); // hotels included below 4★
    sim.star = 4;
    expect(sim.hotelsCountTowardRating()).toBe(false);
    expect(sim.ratingPopulation()).toBeLessThan(sim.population); // hotels excluded at 4★+
  });

  it("stats() exposes only the cheap parkingSpaces count (garage-less → 0)", () => {
    const sim = Simulation.newGame(7);
    sim.money = 1e12;
    layFull(sim, "lobby", 1);
    layFull(sim, "floor", 0);
    expect(sim.stats().parkingSpaces).toBe(0); // no parking yet → stats row is omitted by the UI
    sim.tower.place("parkingRamp", 0, C);
    sim.tower.place("parking", 0, C + 16);
    sim.tower.place("parking", 0, C + 100); // dead
    expect(sim.stats().parkingSpaces).toBe(2);
    // The working count is a flood-fill computed at modal-build time (NOT in the
    // 6 Hz stats()), so assert it via the source method directly.
    expect(sim.tower.functionalParkingSet().size).toBe(1); // only the chained one works
  });
});
