import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { GRID } from "../../engine/facilities";
import { rentOf } from "../../engine/econConfig";
import type { SerializedGame, Unit } from "../../engine/types";

/**
 * The Classic/Modern pricing split (#299): the No Rate off-market state, the
 * canon-rung defaults on new builds, and the NFR3 snap-on-load migration with
 * its golden fixture (each pre-split value pinned to its expected rung by
 * name, the two ratified sharp edges included, the bulletin posted once).
 */

const SNAP_BULLETIN =
  "Classic pricing: rents snapped to the four 1994 rate levels. Condos can now sell for as little as $50,000.";

/** A served floor-2 strip wide enough for several rooms, mode-selectable. */
function strip(mode: "classic" | "modern" = "classic", seed = 7): Simulation {
  const sim = Simulation.newGame(seed, mode);
  const mid = Math.floor(GRID.width / 2);
  const x0 = mid - 30;
  // Widen the starter ground lobby first so the floor strip above is supported
  // end to end (the seeded lobby covers only the middle 40 tiles); grow it
  // outward from the seed so every new tile lands adjacent to existing lobby.
  for (let x = mid - 21; x >= x0; x--) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let x = mid + 20; x < x0 + 60; x++) expect(sim.tower.place("lobby", 1, x).ok).toBe(true);
  for (let i = 0; i < 60; i++) {
    const r = sim.tower.place("floor", 2, x0 + i);
    expect(r.ok).toBe(true);
  }
  expect(sim.buildTransport("elevatorStandard", x0, 1, 2).ok).toBe(true);
  sim.money = 1e9;
  return sim;
}

const x0 = () => Math.floor(GRID.width / 2) - 30;

describe("Classic new builds price on the canon ladder (AR6)", () => {
  it("a new Classic build lists at the Average rung, stored explicitly where it differs from the band default", () => {
    const sim = strip("classic");
    sim.star = 3; // hotels are star-gated; this test is about pricing, not gates
    expect(sim.build("office", 2, x0()).ok).toBe(true);
    expect(sim.build("condo", 2, x0() + 10).ok).toBe(true);
    expect(sim.build("hotelSingle", 2, x0() + 27).ok).toBe(true);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    const condo = sim.tower.units.find((u) => u.kind === "condo")!;
    const room = sim.tower.units.find((u) => u.kind === "hotelSingle")!;
    // Office Average coincides with the band default, so the override strips
    // (sparse saves stay sparse) while rentOf still reads the rung.
    expect(office.rent).toBeUndefined();
    expect(rentOf(office)).toBe(10_000);
    // Condo and hotel Averages differ from the band defaults: stored explicitly.
    expect(condo.rent).toBe(150_000);
    expect(room.rent).toBe(2_000);
  });

  it("a new Modern build keeps the band default (unset override)", () => {
    const sim = strip("modern");
    expect(sim.build("condo", 2, x0()).ok).toBe(true);
    const condo = sim.tower.units.find((u) => u.kind === "condo")!;
    expect(condo.rent).toBeUndefined();
    expect(rentOf(condo)).toBe(160_000);
  });
});

describe("No Rate: one inseparable off-market state (FR4)", () => {
  it("a vacant No Rate office never fills, however long move-ins run", () => {
    const sim = strip("classic", 11);
    expect(sim.build("office", 2, x0()).ok).toBe(true);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.state = "empty";
    expect(sim.setNoRate(office.id)).toBe(true);
    // Ten in-game days of hourly ticks: plenty for a served, priced office to
    // lease (its twin below leases within this window in the control run).
    for (let i = 0; i < 24 * 10; i++) sim.tick(60);
    expect(office.state).toBe("empty");
    expect(office.noRate).toBe(true);
    expect(rentOf(office)).toBe(0);
  });

  it("control: the same office at a rung DOES lease in that window (the guard is the flag, not the fixture)", () => {
    const sim = strip("classic", 11);
    expect(sim.build("office", 2, x0()).ok).toBe(true);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    office.state = "empty";
    for (let i = 0; i < 24 * 10 && office.state === "empty"; i++) sim.tick(60);
    expect(office.state).toBe("occupied");
  });

  it("setting No Rate on an OCCUPIED unit never evicts: the tenant stays, pays nothing, and still counts", () => {
    const sim = strip("classic", 13);
    expect(sim.build("office", 2, x0()).ok).toBe(true);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    sim.moveIn(office);
    expect(office.state).toBe("occupied");
    const popBefore = sim.ratingPopulation();
    expect(sim.setNoRate(office.id)).toBe(true);
    // Two full days of economy + satisfaction passes.
    for (let i = 0; i < 48; i++) sim.tick(60);
    expect(office.state).toBe("occupied"); // never evicted
    expect(rentOf(office)).toBe(0); // pays nothing
    expect(sim.ratingPopulation()).toBe(popBefore); // still counts toward stars
  });

  it("refuses a sold condo (price-locked) and any Modern unit (seam law)", () => {
    const classic = strip("classic", 17);
    expect(classic.build("condo", 2, x0()).ok).toBe(true);
    const condo = classic.tower.units.find((u) => u.kind === "condo")!;
    classic.moveIn(condo);
    expect(condo.everOccupied).toBe(true);
    expect(classic.setNoRate(condo.id)).toBe(false);
    expect(condo.noRate).toBeUndefined();

    const modern = strip("modern", 17);
    expect(modern.build("office", 2, x0()).ok).toBe(true);
    const office = modern.tower.units.find((u) => u.kind === "office")!;
    expect(modern.setNoRate(office.id)).toBe(false);
    expect(office.noRate).toBeUndefined();
  });

  it("repricing through the choke point puts the unit back on the market", () => {
    const sim = strip("classic", 19);
    expect(sim.build("office", 2, x0()).ok).toBe(true);
    const office = sim.tower.units.find((u) => u.kind === "office")!;
    expect(sim.setNoRate(office.id)).toBe(true);
    expect(sim.priceUnit(office, 5_000)).toBe(5_000);
    expect(office.noRate).toBeUndefined();
    expect(rentOf(office)).toBe(5_000);
  });

  it("the price choke point snaps any off-ladder target onto a rung in Classic", () => {
    const sim = strip("classic", 23);
    sim.star = 3; // hotels are star-gated; this test is about the choke point
    expect(sim.build("hotelSingle", 2, x0()).ok).toBe(true);
    const room = sim.tower.units.find((u) => u.kind === "hotelSingle")!;
    expect(sim.priceUnit(room, 1_750)).toBe(2_000); // exact tie 1.5k/2k rounds up
    expect(sim.priceUnit(room, 999_999)).toBe(3_000); // bounded by the top rung
  });
});

describe("snap-on-load: the golden pre-split migration fixture (NFR3)", () => {
  /**
   * A hand-shaped pre-split Classic save. Each unit pins one migration case by
   * name; geometry keeps every room on its own patch of a floored strip.
   */
  function preSplitSave(): { save: SerializedGame; ids: Record<string, number> } {
    const sim = strip("classic", 29);
    const X = x0();
    const place = (kind: Parameters<Simulation["build"]>[0], x: number) => {
      const r = sim.tower.place(kind, 2, x);
      expect(r.ok).toBe(true);
      return r.unitId!;
    };
    // tower.place (not sim.build) so nothing pre-stamps a rung: these units
    // carry exactly the rents a pre-split save would.
    const ids = {
      officeAtOldMax: place("office", X), // $20k, the old band max
      officeTie: place("office", X + 9), // $7,500, the exact 5k/10k tie
      officeUnset: place("office", X + 18), // no override: the old default
      condoOldFloor: place("condo", X + 27), // $80k, the old firesale floor
    };
    const byId = (id: number) => sim.tower.units.find((u) => u.id === id)!;
    byId(ids.officeAtOldMax).rent = 20_000;
    byId(ids.officeTie).rent = 7_500;
    byId(ids.condoOldFloor).rent = 80_000;
    return { save: sim.serialize(), ids };
  }

  it("pins each pre-split value to its rung: the old office max drops to High, the $80k firesale condo lands on $100k, ties round up", () => {
    const { save, ids } = preSplitSave();
    const before = save.units
      .filter((u) => Object.values(ids).includes(u.id))
      .reduce((sum, u) => sum + rentOf(u as Unit), 0);
    // Pre-split effective rents: 20,000 + 7,500 + 10,000 (default) + 80,000.
    expect(before).toBe(117_500);
    const sim = Simulation.deserialize(save);
    const byId = (id: number) => sim.tower.units.find((u) => u.id === id)!;
    expect(rentOf(byId(ids.officeAtOldMax))).toBe(15_000); // old $20k max -> High
    expect(rentOf(byId(ids.officeTie))).toBe(10_000); // $7,500 tie rounds UP to Average
    expect(rentOf(byId(ids.officeUnset))).toBe(10_000); // default was already Average
    expect(rentOf(byId(ids.condoOldFloor))).toBe(100_000); // old $80k floor -> $100k
    // The income shift is visible in review: the fixture's rent roll moves
    // from $117,500 to $135,000 in one load, the accepted NFR3 one-time cost.
    const after = Object.values(ids).reduce((sum, id) => sum + rentOf(byId(id)), 0);
    expect(after).toBe(135_000);
  });

  it("posts the pinned bulletin once (with the condo callout), and never again on a re-load", () => {
    const { save } = preSplitSave();
    const sim = Simulation.deserialize(save);
    const snapLines = sim.log.filter((e) => e.text === SNAP_BULLETIN);
    expect(snapLines).toHaveLength(1);
    expect(snapLines[0].kind).toBe("info"); // bulletin-only, never a toast
    // Idempotent: the snapped save re-loads silently.
    const again = Simulation.deserialize(sim.serialize());
    expect(again.log.filter((e) => e.text === SNAP_BULLETIN)).toHaveLength(1); // the restored line only
    expect(again.log).toHaveLength(sim.log.length);
  });

  it("a condo-less pre-split save gets the base line without the condo callout", () => {
    const sim = strip("classic", 31);
    const r = sim.tower.place("office", 2, x0());
    expect(r.ok).toBe(true);
    sim.tower.units.find((u) => u.id === r.unitId)!.rent = 20_000;
    const loaded = Simulation.deserialize(sim.serialize());
    const texts = loaded.log.map((e) => e.text);
    expect(texts).toContain("Classic pricing: rents snapped to the four 1994 rate levels.");
    expect(texts.some((t) => t.includes("Condos can now sell"))).toBe(false);
  });

  it("a save already on the rungs loads silently (no bulletin, no rewrite)", () => {
    const sim = strip("classic", 37);
    expect(sim.build("office", 2, x0()).ok).toBe(true);
    expect(sim.build("condo", 2, x0() + 10).ok).toBe(true);
    const loaded = Simulation.deserialize(sim.serialize());
    expect(loaded.log.some((e) => e.text.startsWith("Classic pricing:"))).toBe(false);
  });

  it("forged rents (NaN, negative, absurd) clamp then snap: nothing off-ladder survives into a Classic tower", () => {
    const sim = strip("classic", 41);
    const X = x0();
    const a = sim.tower.place("office", 2, X);
    const b = sim.tower.place("office", 2, X + 9);
    const c = sim.tower.place("hotelSuite", 2, X + 18);
    expect(a.ok && b.ok && c.ok).toBe(true);
    const save = sim.serialize();
    (save.units.find((u) => u.id === a.unitId) as { rent?: unknown }).rent = NaN;
    (save.units.find((u) => u.id === b.unitId) as { rent?: unknown }).rent = -12;
    (save.units.find((u) => u.id === c.unitId) as { rent?: unknown }).rent = 9e15;
    const loaded = Simulation.deserialize(save);
    const rents = loaded.tower.units
      .filter((u) => u.kind === "office" || u.kind === "hotelSuite")
      .map((u) => rentOf(u));
    expect(rents).toEqual(expect.arrayContaining([10_000, 2_000, 9_000])); // Average / Very Low / top rung
    for (const u of loaded.tower.units) {
      if (u.kind === "office") expect([2_000, 5_000, 10_000, 15_000]).toContain(rentOf(u));
      if (u.kind === "hotelSuite") expect([1_500, 4_000, 6_000, 9_000]).toContain(rentOf(u));
    }
  });

  it("a sold Classic condo's price snaps too (uniform, no intent-guessing) and the buy-back mirrors the rung", () => {
    const sim = strip("classic", 43);
    const r = sim.tower.place("condo", 2, x0());
    expect(r.ok).toBe(true);
    const condo = sim.tower.units.find((u) => u.id === r.unitId)!;
    condo.rent = 120_000; // a pre-split sale price (the old default)
    condo.everOccupied = true;
    condo.state = "occupied";
    const loaded = Simulation.deserialize(sim.serialize());
    const rc = loaded.tower.units.find((u) => u.kind === "condo")!;
    expect(rc.rent).toBe(100_000); // nearest rung
    // The buy-back mirrors the snapped price exactly.
    const moneyBefore = loaded.money;
    (loaded as unknown as { vacate(u: Unit, reason: string): void }).vacate(rc, "access");
    expect(loaded.money).toBe(moneyBefore - 100_000);
  });

  it("Modern saves are untouched: no snap, no bulletin", () => {
    const sim = strip("modern", 47);
    const X = x0();
    const a = sim.tower.place("office", 2, X);
    const b = sim.tower.place("condo", 2, X + 10);
    expect(a.ok && b.ok).toBe(true);
    sim.tower.units.find((u) => u.id === a.unitId)!.rent = 17_000; // off-ladder, in-band
    sim.tower.units.find((u) => u.id === b.unitId)!.rent = 90_000;
    const loaded = Simulation.deserialize(sim.serialize());
    expect(loaded.tower.units.find((u) => u.kind === "office")!.rent).toBe(17_000);
    expect(loaded.tower.units.find((u) => u.kind === "condo")!.rent).toBe(90_000);
    expect(loaded.log.some((e) => e.text.startsWith("Classic pricing:"))).toBe(false);
  });
});

describe("a Classic condo returning to market re-lists on the ladder", () => {
  it("vacate() snaps a legacy out-of-band asking price onto a rung instead of the Modern band clamp", () => {
    const sim = strip("classic", 53);
    const r = sim.tower.place("condo", 2, x0());
    expect(r.ok).toBe(true);
    const condo = sim.tower.units.find((u) => u.id === r.unitId)!;
    condo.rent = 240_000; // legacy sold price (in-memory; loads would snap it)
    condo.everOccupied = true;
    condo.state = "occupied";
    (sim as unknown as { vacate(u: Unit, reason: string): void }).vacate(condo, "access");
    expect(condo.everOccupied).toBe(false);
    expect(condo.rent).toBe(200_000); // re-listed on the High rung
  });
});

describe("review regressions: unset defaults and the No Rate buy-back", () => {
  it("a pre-split hotel with NO stored rent lands on Average, not the nearest rung to the old band default", () => {
    // An absent override is not a stored rent: it means "on the default", and
    // the ladder's default rung is Average (AR6). Snapping the old $90 band
    // default's dollars would land Very Low and price a migrated untouched
    // room differently from an identical new build.
    const sim = strip("classic", 59);
    const r = sim.tower.place("hotelSingle", 2, x0());
    expect(r.ok).toBe(true);
    const loaded = Simulation.deserialize(sim.serialize());
    const room = loaded.tower.units.find((u) => u.kind === "hotelSingle")!;
    expect(rentOf(room)).toBe(2_000); // Average, matching a fresh build
    // The jump from the $90 effective default is a visible change: bulletined.
    expect(loaded.log.some((e) => e.text.startsWith("Classic pricing:"))).toBe(true);
  });

  it("an imported occupied No Rate condo still costs the full buy-back when its owner leaves", () => {
    // rentOf reads $0 for an off-market unit, but the buy-back mirrors the
    // SALE price: a class-4 import must not let the owner walk away free.
    const sim = strip("classic", 61);
    const r = sim.tower.place("condo", 2, x0());
    expect(r.ok).toBe(true);
    const condo = sim.tower.units.find((u) => u.id === r.unitId)!;
    condo.everOccupied = true;
    condo.state = "occupied";
    condo.rent = 150_000;
    condo.noRate = true; // the importer's class-4 state on an occupied condo
    const before = sim.money;
    (sim as unknown as { vacate(u: Unit, reason: string): void }).vacate(condo, "access");
    expect(sim.money).toBe(before - 150_000); // never a $0 walk-away
  });
});
