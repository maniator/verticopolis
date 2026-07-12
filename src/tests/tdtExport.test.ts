import { describe, expect, it } from "vitest";
import type { SerializedGame, Transport, Unit } from "../engine/types";
import { SAVE_VERSION } from "../engine/saveMigration";
import {
  TDT_DEFAULT_VIEW_X,
  TDT_DEFAULT_VIEW_Y,
  TDT_ELEVATOR_SCHEDULE_DEFAULT,
  TDT_PERSON_RECORD_SIZE,
  TDT_ROUTING_TAIL_SIZE,
  parseTdtBinary,
} from "../storage/tdtFormat";
import { LegacyExportError, buildTDT, classFromRent, legacyFilename } from "../storage/tdtExport";
import { Simulation } from "../engine/Simulation";
import { GRID } from "../engine/facilities";
import { FASTFOOD_SUBTYPES, RESTAURANT_SUBTYPES, SHOP_SUBTYPES } from "../engine/retailSubtypes";
import { FAMILY_STORIES, PART_FAMILY, parseTDT } from "../storage/tdtImport";
import { buildTdt, sampleTowerSpec } from "./fixtures/tdtBuilder";

/** A bare room unit for hand-built saves. */
function unit(partial: Partial<Unit> & Pick<Unit, "id" | "kind" | "floor" | "x" | "width">): Unit {
  return {
    state: "empty",
    satisfaction: 1,
    occupants: 0,
    everOccupied: false,
    pendingIncome: 0,
    label: "",
    ...partial,
  };
}

/** A realistic serialized tower: the sample fixture pulled through the
 *  importer, so it carries rooms, hotel states, transports and paving in
 *  exactly the shape the live game serializes. */
function sampleSave(): SerializedGame {
  const buf = buildTdt(sampleTowerSpec());
  return parseTDT(buf.buffer as ArrayBuffer, "SAMPLE.TDT").save;
}

/** The rooms of a save (paving filtered out), in a comparable shape. */
function roomFacts(save: SerializedGame) {
  return save.units
    .filter((u) => u.kind !== "floor" && u.kind !== "lobby")
    .map((u) => ({
      kind: u.kind,
      floor: u.floor,
      x: u.x,
      width: u.width,
      state: u.state,
      everOccupied: u.everOccupied,
      occupants: u.occupants,
      rent: u.rent,
    }))
    .sort((a, b) => a.floor - b.floor || a.x - b.x);
}

function transportFacts(save: SerializedGame) {
  return save.transports
    .map((t) => ({
      kind: t.kind,
      x: t.x,
      bottom: t.bottom,
      top: t.top,
      cars: t.cars,
      skipFloors: [...(t.skipFloors ?? [])].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.x - b.x || a.bottom - b.bottom);
}

describe("buildTDT: export → import round trip", () => {
  it("rooms, states, and transports survive the trip through our own parser", () => {
    const save = sampleSave();
    const { bytes } = buildTDT(save);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "SAMPLE.TDT").save;

    expect(roomFacts(back)).toEqual(roomFacts(save));
    expect(transportFacts(back)).toEqual(transportFacts(save));
    expect(back.money).toBe(save.money); // importer output is already $100-quantized
    expect(back.star).toBe(save.star);
    // frameForMinuteOfDay/minuteOfDayForFrame are exact inverses (the 2,600-
    // tick clock is finer-grained than minutes), so the clock is lossless.
    expect(back.minutes).toBe(save.minutes);
    expect(back.mode).toBe("classic");
  });

  it("our own output raises ZERO importer warnings (a warning here is a writer bug)", () => {
    const { bytes } = buildTDT(sampleSave());
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
  });

  it("export is stable: exporting the re-import yields byte-identical bytes", () => {
    const first = buildTDT(sampleSave()).bytes;
    const again = buildTDT(parseTDT(first.buffer as ArrayBuffer, "S.TDT").save).bytes;
    expect(again).toEqual(first);
  });

  it("a modern-mode tower is refused with a typed error", () => {
    const save = { ...sampleSave(), mode: "modern" as const };
    expect(() => buildTDT(save)).toThrow(LegacyExportError);
    expect(() => buildTDT(save)).toThrow(/Classic towers/);
  });

  it("retail subtypes round-trip: shop / fastFood / restaurant preserve their canon variant", () => {
    // Build a real Simulation, populate three retail units with distinct
    // canon subtypes, serialize, export, and re-import through parseTDT.
    // The resulting units must carry the same variant names on both sides.
    const sim = Simulation.newGame(3);
    sim.money = 1e12;
    sim.star = 5;
    const x0 = Math.floor(GRID.width / 2) - 20;
    for (let i = 0; i < 40; i++) sim.tower.place("floor", 2, x0 + i);
    sim.buildTransport("elevatorStandard", x0, 1, 2);
    // Distinct kinds, distinct floors so the retail-table row order is stable.
    for (let i = 0; i < 40; i++) sim.tower.place("floor", 3, x0 + i);
    for (let i = 0; i < 40; i++) sim.tower.place("floor", 4, x0 + i);
    // Place through the low-level place path to keep sequence deterministic,
    // then FORCE canonical names so the assertion doesn't hinge on which
    // subtype the RNG happened to pick.
    const s = sim.tower.place("shop", 2, x0)!;
    const f = sim.tower.place("fastFood", 3, x0)!;
    const r = sim.tower.place("restaurant", 4, x0)!;
    sim.tower.getUnit(s.unitId!)!.subtype = SHOP_SUBTYPES[3]; // Book Store
    sim.tower.getUnit(f.unitId!)!.subtype = FASTFOOD_SUBTYPES[1]; // Chinese Cafe
    sim.tower.getUnit(r.unitId!)!.subtype = RESTAURANT_SUBTYPES[4]; // Steak House

    const wire = sim.serialize();
    const { bytes } = buildTDT(wire);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "R.TDT").save;

    const backShop = back.units.find((u) => u.kind === "shop");
    const backFf = back.units.find((u) => u.kind === "fastFood");
    const backRest = back.units.find((u) => u.kind === "restaurant");
    expect(backShop?.subtype).toBe(SHOP_SUBTYPES[3]);
    expect(backFf?.subtype).toBe(FASTFOOD_SUBTYPES[1]);
    expect(backRest?.subtype).toBe(RESTAURANT_SUBTYPES[4]);
  });

  it("an empty tower exports a valid minimal file", () => {
    const save: SerializedGame = {
      version: SAVE_VERSION,
      seed: 1,
      money: 2_000_000,
      star: 1,
      minutes: 7 * 60,
      mode: "classic",
      units: [],
      transports: [],
      nextId: 1,
      towerName: "Empty",
      builtWeddingHall: false,
      evaluatedTower: false,
    };
    const { bytes, report } = buildTDT(save);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "EMPTY.TDT").save;
    expect(back.units).toHaveLength(0);
    expect(back.money).toBe(2_000_000);
    expect(report.roomsExported).toBe(0);
  });

  // The 1994 game TRUSTS the header aggregate counts (doc §1) rather than
  // recomputing from the floor map: a zeroed recyclingCount made it nag "your
  // tower needs a Recycling Center" on a tower that had two (found via the real
  // game, tools/simtower/). These pin the fix AND the invariant the party
  // ratified: counts come from the EMITTED rooms, not the input (burned shells
  // and out-of-range rooms never inflate a count the reader believes).
  describe("header aggregate counts", () => {
    const u16 = (b: Uint8Array, off: number) => b[off] | (b[off + 1] << 8);
    const tower = (units: Unit[]): SerializedGame => ({
      version: SAVE_VERSION,
      seed: 1,
      money: 2_000_000,
      star: 1,
      minutes: 7 * 60,
      mode: "classic",
      units,
      transports: [],
      nextId: units.length + 1,
      towerName: "Counts",
      builtWeddingHall: false,
      evaluatedTower: false,
    });

    it("derives all six counts from the emitted rooms, excluding burned + out-of-range", () => {
      const { bytes } = buildTDT(
        tower([
          unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }), // ground lobby -> lobbyHeight 1
          unit({ id: 2, kind: "recycling", floor: 2, x: 0, width: 20 }), // counts
          unit({ id: 3, kind: "recycling", floor: 5, x: 40, width: 20, state: "gutted" }), // burned -> excluded
          unit({ id: 4, kind: "shop", floor: 8, x: 0, width: 12 }), // commercial
          unit({ id: 5, kind: "restaurant", floor: 9, x: 0, width: 24 }), // commercial
          unit({ id: 6, kind: "fastFood", floor: 10, x: 0, width: 16 }), // commercial
          unit({ id: 7, kind: "shop", floor: 105, x: 0, width: 12 }), // out-of-range -> excluded
          unit({ id: 8, kind: "security", floor: 11, x: 0, width: 8 }),
          unit({ id: 9, kind: "partyHall", floor: 12, x: 0, width: 24 }), // hall+cinema
          unit({ id: 10, kind: "cinema", floor: 13, x: 0, width: 31 }), // hall+cinema
          unit({ id: 11, kind: "parking", floor: -1, x: 0, width: 4 }),
          unit({ id: 12, kind: "parking", floor: -2, x: 0, width: 4 }),
        ]),
      );
      expect(u16(bytes, 0x1c)).toBe(1); // lobbyHeight
      expect(u16(bytes, 0x2a)).toBe(1); // recyclingCount (burned one excluded)
      expect(u16(bytes, 0x2e)).toBe(3); // commercialCount (out-of-range shop excluded)
      expect(u16(bytes, 0x30)).toBe(1); // securityCount
      expect(u16(bytes, 0x32)).toBe(2); // parkingStallCount
      expect(u16(bytes, 0x36)).toBe(2); // hallCinemaCount (partyHall + cinema)
    });

    it("clamps securityCount to the canon max of 10", () => {
      const units: Unit[] = [unit({ id: 0, kind: "lobby", floor: 1, x: 0, width: 1 })];
      for (let i = 0; i < 12; i++) {
        units.push(unit({ id: i + 1, kind: "security", floor: 2 + i, x: 0, width: 8 }));
      }
      expect(u16(buildTDT(tower(units)).bytes, 0x30)).toBe(10);
    });

    // Tripwire: the header switch and the emit tables (KIND_TENANT / PART_STACKS)
    // are maintained separately, so a kind added to the count switch but not to
    // an emit path would over-count silently. Verify every counted kind emits.
    it("every counted kind actually emits a tenant (header can't outrun the map)", () => {
      const counted: { kind: Unit["kind"]; width: number }[] = [
        { kind: "recycling", width: 20 },
        { kind: "shop", width: 12 },
        { kind: "restaurant", width: 24 },
        { kind: "fastFood", width: 16 },
        { kind: "security", width: 8 },
        { kind: "partyHall", width: 24 },
        { kind: "cinema", width: 31 },
      ];
      for (const c of counted) {
        const { report } = buildTDT(
          tower([
            unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
            unit({ id: 2, kind: c.kind, floor: 3, x: 0, width: c.width }),
          ]),
        );
        expect(report.roomsExported, `${c.kind} must emit a tenant`).toBeGreaterThanOrEqual(1);
      }
    });
  });

  it("the wedding hall round-trips at the crown (floor 100)", () => {
    const save = sampleSave();
    save.units.push({
      id: 9_000,
      kind: "weddingHall",
      floor: 100,
      x: 180,
      width: 16,
      state: "empty",
      satisfaction: 1,
      occupants: 0,
      everOccupied: false,
      pendingIncome: 0,
      label: "Wedding Hall",
    });
    const { bytes } = buildTDT(save);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT").save;
    const halls = back.units.filter((u) => u.kind === "weddingHall");
    expect(halls).toHaveLength(1);
    expect(halls[0].floor).toBe(100);
    expect(back.builtWeddingHall).toBe(true);
  });

  it("stacked walkway flights collapse into multi-story records and come back apart", () => {
    const save = sampleSave();
    // Three stacked stairs flights at one x: floors 1-2, 2-3, 3-4.
    for (let i = 0; i < 3; i++) {
      save.transports.push({
        id: 8_000 + i,
        kind: "stairs",
        x: 200,
        width: 8,
        bottom: 1 + i,
        top: 2 + i,
        cars: 0,
        carPositions: [],
        carDir: [],
        load: 0,
      });
    }
    const { bytes } = buildTDT(save);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT").save;
    const flights = back.transports.filter((t) => t.kind === "stairs" && t.x === 200);
    expect(flights.map((f) => [f.bottom, f.top]).sort((a, b) => a[0] - b[0])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  it("the reverse fidelity report is honest about rounding and losses", () => {
    const save = sampleSave();
    save.money = 1_234_567; // not a multiple of 100
    const named = save.units.find((u) => u.kind === "office")!;
    named.label = "Corner Office";
    const { report } = buildTDT(save);
    expect(report.money).toBe(1_234_600);
    expect(report.staysBehind.join(" ")).toMatch(/round to the nearest \$100/);
    expect(report.staysBehind.join(" ")).toMatch(/custom room name/);
    expect(report.comesAlong.join(" ")).toMatch(/elevator shaft/);
    expect(report.filename).toBe("SAMPLE.TDT");
  });
});

describe("buildTDT: review hardening (states, collisions, caps, hostile input)", () => {
  it("vacating and moving-in tenants export as sitting tenants, never as vacancies", () => {
    const save = sampleSave();
    const office = save.units.find((u) => u.kind === "office" && u.state === "occupied")!;
    office.state = "vacating";
    const { bytes } = buildTDT(save);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT").save;
    const backOffice = back.units.find((u) => u.kind === "office" && u.x === office.x)!;
    expect(backOffice.state).toBe("occupied");
    expect(backOffice.everOccupied).toBe(true);
  });

  it("burned-out and burning rooms export as burned floor (type 48), not healthy rooms", () => {
    const save = sampleSave();
    const office = save.units.find((u) => u.kind === "office" && u.state === "occupied")!;
    office.state = "gutted";
    const { bytes, report } = buildTDT(save);
    expect(report.staysBehind.join(" ")).toMatch(/burned-out room/);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT");
    expect(
      back.save.units.some(
        (u) => u.kind === "office" && u.x === office.x && u.floor === office.floor,
      ),
    ).toBe(false);
    expect(back.report.couldNotBring.join(" ")).toMatch(/burned/i);
  });

  it("a vacant-but-once-rented office loses its history, and the report says so", () => {
    const save = sampleSave();
    save.units.push(unit({ id: 9_100, kind: "office", floor: 3, x: 10, width: 9, everOccupied: true }));
    const { report } = buildTDT(save);
    expect(report.staysBehind.join(" ")).toMatch(/rental history/);
  });

  it("the cathedral stack stops above a multi-story room's UPPER story (no overlapping tenants)", () => {
    const save = sampleSave();
    // Cinema based at 98 occupies 98-99 under the hall's x-range.
    save.units.push(unit({ id: 9_200, kind: "cinema", floor: 98, x: 180, width: 31 }));
    save.units.push(unit({ id: 9_201, kind: "weddingHall", floor: 100, x: 180, width: 16 }));
    const { bytes } = buildTDT(save);
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT").save;
    expect(back.units.filter((u) => u.kind === "cinema")).toHaveLength(1);
    const halls = back.units.filter((u) => u.kind === "weddingHall");
    expect(halls).toHaveLength(1);
    expect(halls[0].floor).toBe(100);
    // Nothing overlaps: the importer dropped zero rooms.
    expect(parseTDT(bytes.buffer as ArrayBuffer, "S.TDT").report.couldNotBring.join(" ")).not.toMatch(
      /overlapped/,
    );
  });

  it("a floor with more rooms than the format holds is refused, not written broken", () => {
    const save = sampleSave();
    for (let i = 0; i < 300; i++) {
      save.units.push(unit({ id: 10_000 + i, kind: "office", floor: 40, x: i, width: 1 }));
    }
    expect(() => buildTDT(save)).toThrow(LegacyExportError);
  });

  it("rooms outside the 1994 floor range are skipped and counted, reserved rows stay empty", () => {
    const save = sampleSave();
    save.units.push(unit({ id: 9_300, kind: "cinema", floor: 100, x: 10, width: 31 })); // story at 101
    const { bytes, report } = buildTDT(save);
    expect(report.staysBehind.join(" ")).toMatch(/outside the floors/);
    // The modal facts match the bytes: the skipped room's extent at 101 must
    // not leak into the reported floor count.
    expect(report.floors).toBeLessThanOrEqual(100);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT");
    expect(back.report.couldNotBring.join(" ")).not.toMatch(/reserved floor row/);
  });

  it("shafts past the 24-slot table are dropped and REPORTED, never silently", () => {
    const save = sampleSave();
    for (let i = 0; i < 30; i++) {
      save.transports.push({
        id: 20_000 + i,
        kind: "elevatorStandard",
        x: 5 + i * 6,
        width: 4,
        bottom: 0,
        top: 5,
        cars: 2,
        carPositions: [0, 0],
        carDir: [0, 0],
        load: 0,
      });
    }
    const { report } = buildTDT(save);
    expect(report.comesAlong.join(" ")).toMatch(/24 elevator shafts/);
    expect(report.staysBehind.join(" ")).toMatch(/past 1994's 24-shaft limit/);
  });

  it("car counts clamp into 1..8 both ways (a 9-car forgery can't desync the payload)", () => {
    const save = sampleSave();
    save.transports.find((t) => t.kind !== "stairs" && t.kind !== "escalator")!.cars = 9;
    const { bytes } = buildTDT(save);
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
  });

  it("a skipFloors entry on an endpoint is ignored: endpoints always stop", () => {
    const save = sampleSave();
    const shaft = save.transports.find((t) => t.kind !== "stairs" && t.kind !== "escalator")!;
    shaft.skipFloors = [shaft.bottom];
    const { bytes } = buildTDT(save);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT").save;
    const backShaft = back.transports.find((t) => t.kind === shaft.kind)!;
    expect(backShaft.skipFloors ?? []).toEqual([]);
  });

  it("parking connected counts only ramp-chained stalls (orphans export 0)", () => {
    const save = sampleSave(); // fixture: ramp + one flush stall on B1
    save.units.push(unit({ id: 9_400, kind: "parking", floor: 0, x: 300, width: 4 })); // orphan
    const { bytes } = buildTDT(save);
    // Offset of the parking block's u16 is fragile; assert via the importer's
    // echo instead: the sample's report mentions exactly 1 connected stall.
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT");
    // The importer echoes the file's connected count: only the flush stall.
    expect(back.report.broughtOver.join(" ")).toMatch(/counted 1 connected to a ramp/);
  });

  it("non-finite money exports as $0 and reports $0, never $NaN", () => {
    const save = { ...sampleSave(), money: NaN };
    const { report, bytes } = buildTDT(save);
    expect(report.money).toBe(0);
    expect(parseTDT(bytes.buffer as ArrayBuffer, "S.TDT").save.money).toBe(0);
  });

  it("forged transports are sanitized like the importer's: unknown kinds drop with a report line, coordinates clamp", () => {
    const save = sampleSave();
    save.transports.push(
      // Unknown kind: no 1994 equivalent.
      { id: 21_000, kind: "office", x: 10, width: 4, bottom: 1, top: 5, cars: 1, carPositions: [1], carDir: [0], load: 0 },
      // Wild extents: clamps into the grid instead of wrapping the byte masks.
      { id: 21_001, kind: "elevatorStandard", x: 9_999, width: 4, bottom: -50, top: 500, cars: NaN, carPositions: [NaN], carDir: [], load: 0 },
      // Degenerate: dropped.
      { id: 21_002, kind: "elevatorService", x: 20, width: 4, bottom: 8, top: 8, cars: 2, carPositions: [8, 8], carDir: [0, 0], load: 0 },
    );
    const { bytes, report } = buildTDT(save);
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
    expect(report.staysBehind.join(" ")).toMatch(/2 transports couldn't be represented/);
    // The sample's 1 shaft + the clamped forgery = 2 shafts, honestly counted.
    expect(report.comesAlong.join(" ")).toMatch(/2 elevator shafts/);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT").save;
    const clamped = back.transports.filter((t) => t.kind === "elevatorStandard" && t.x !== 150);
    expect(clamped).toHaveLength(1);
    expect(clamped[0].bottom).toBeGreaterThanOrEqual(-9);
    expect(clamped[0].top - clamped[0].bottom).toBeLessThanOrEqual(30);
  });

  it("a forged star feeds ONE sanitized value into both the header and the report", () => {
    const forged = buildTDT({ ...sampleSave(), star: NaN });
    expect(forged.report.star).toBe(1);
    expect(parseTDT(forged.bytes.buffer as ArrayBuffer, "S.TDT").save.star).toBe(1);
    const high = buildTDT({ ...sampleSave(), star: 9.7 });
    expect(high.report.star).toBe(6);
    expect(parseTDT(high.bytes.buffer as ArrayBuffer, "S.TDT").save.star).toBe(6);
  });

  it("a floor AT the 256-tenant ceiling exports (only strictly-greater refuses)", () => {
    const save = sampleSave();
    for (let i = 0; i < 256; i++) {
      save.units.push(unit({ id: 11_000 + i, kind: "office", floor: 40, x: i, width: 1 }));
    }
    const { bytes } = buildTDT(save);
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
  });
});

describe("shared-table tripwires: the writer's inversions match the importer", () => {
  it("every PART_STACKS id maps back to its kind, with the family's full story count", () => {
    // PART_STACKS is module-private; assert through behavior: each multi-story
    // kind round-trips as itself at its family height via the mapping tests
    // above, and the inverse tables agree id-by-id.
    const stacks: Record<string, number[]> = {
      cinema: [19, 18],
      recycling: [21, 20],
      partyHall: [30, 29],
      metro: [33, 32, 31],
      weddingHall: [36, 37, 38, 39, 40],
    };
    for (const [kind, ids] of Object.entries(stacks)) {
      expect(ids).toHaveLength(FAMILY_STORIES[kind as keyof typeof FAMILY_STORIES]!);
      for (const id of ids) expect(PART_FAMILY[id]).toBe(kind);
    }
  });
});

describe("classFromRent / legacyFilename", () => {
  it("maps band anchors to the four 1994 classes; unset stays Average", () => {
    expect(classFromRent("office", 2_000)).toBe(0); // band.min
    expect(classFromRent("office", 10_000)).toBe(2); // band.default
    expect(classFromRent("office", 20_000)).toBe(3); // band.max
    expect(classFromRent("office", undefined)).toBe(2);
    expect(classFromRent("security", 123)).toBe(2); // unpriced kind
  });

  it("filenames are DOS-safe: A-Z0-9, upper, max 8 chars, never empty or a device name", () => {
    expect(legacyFilename("My Tower!")).toBe("MYTOWER.TDT");
    expect(legacyFilename("verticopolis prime")).toBe("VERTICOP.TDT");
    expect(legacyFilename("---")).toBe("TOWER1.TDT");
    // Reserved DOS device names can't exist as files on the target systems.
    expect(legacyFilename("Con")).toBe("TOWER1.TDT");
    expect(legacyFilename("lpt1")).toBe("TOWER1.TDT");
  });
});

// These pin the fixes that make an exported tower actually LOAD and PLAY in the
// real 1994 game (found + confirmed with the SimTower harness, tools/simtower/):
// a populated tower needs a nonzero people count; the file must carry the
// trailing routing region; built shafts need a real schedule block or their cars
// never run; and the saved view opens on the ground, not the sky.
describe("buildTDT: real-game loadability (people, routing tail, schedule, camera)", () => {
  const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
  const u32 = (b: Uint8Array, o: number) =>
    (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  // The u32 people count sits immediately after the 120-record floor map.
  const peopleOffset = (b: Uint8Array): number => {
    let o = 0x230;
    for (let i = 0; i < 120; i++) o += 6 + u16(b, o) * 18 + 94 * 2;
    return o;
  };
  const shaft = (over: Partial<Transport> = {}): Transport => ({
    id: 10, kind: "elevatorStandard", x: 20, width: 8, bottom: 1, top: 9,
    cars: 1, carPositions: [1], carDir: [0], load: 0, ...over,
  });
  const tower = (units: Unit[], transports: Transport[] = []): SerializedGame => ({
    version: SAVE_VERSION, seed: 1, money: 2_000_000, star: 2, minutes: 7 * 60,
    mode: "classic", units, transports, nextId: units.length + 1,
    towerName: "Load", builtWeddingHall: false, evaluatedTower: false,
  });

  it("an empty tower writes people count 0 (the game loads that fine)", () => {
    const { bytes } = buildTDT(tower([unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 })]));
    expect(u32(bytes, peopleOffset(bytes))).toBe(0);
  });

  it("a populated tower writes a nonzero census with that many zeroed records", () => {
    const { bytes } = buildTDT(
      tower([
        unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
        unit({ id: 2, kind: "office", floor: 2, x: 0, width: 12, state: "occupied" }), // 6
        unit({ id: 3, kind: "office", floor: 3, x: 0, width: 12, state: "occupied" }), // 6
        unit({ id: 4, kind: "condo", floor: 4, x: 0, width: 16, state: "occupied" }), //  3
        unit({ id: 5, kind: "office", floor: 5, x: 0, width: 12, state: "empty" }), // vacant, 0
      ]),
    );
    const off = peopleOffset(bytes);
    const count = u32(bytes, off);
    expect(count).toBe(6 + 6 + 3); // vacant office excluded
    const records = bytes.subarray(off + 4, off + 4 + count * TDT_PERSON_RECORD_SIZE);
    expect(records).toHaveLength(count * TDT_PERSON_RECORD_SIZE);
    expect(records.every((x) => x === 0)).toBe(true); // records re-simulate; content is zero
  });

  it("a commercial-only tower writes its people census from catalog population", () => {
    // shop = 20, fastFood = 25 (proportional-to-footprint design values).
    const { bytes } = buildTDT(
      tower([
        unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
        unit({ id: 2, kind: "shop", floor: 2, x: 0, width: 12, state: "occupied" }),
        unit({ id: 3, kind: "fastFood", floor: 3, x: 0, width: 16, state: "occupied" }),
      ]),
    );
    // shop (20) + fastFood (25) = 45
    expect(u32(bytes, peopleOffset(bytes))).toBe(20 + 25);
  });

  it("vacant commercial units do not add their catalog population to the census", () => {
    // Vacant units (state: empty) are not present; residentCount is never called
    // for them. The room-count floor still produces a nonzero count (SimTower
    // needs a nonzero people block for any non-empty tower), but it should be
    // the small floor value, NOT the catalog population × rooms.
    const { bytes } = buildTDT(
      tower([
        unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
        unit({ id: 2, kind: "shop", floor: 2, x: 0, width: 12, state: "empty" }),
        unit({ id: 3, kind: "restaurant", floor: 3, x: 0, width: 24, state: "empty" }),
      ]),
    );
    // Room-count floor = 2 (the two vacant commercial rooms), not catalog pop × 2.
    expect(u32(bytes, peopleOffset(bytes))).toBe(2);
  });

  it("mixed tower census sums offices, condos, and present commercial correctly", () => {
    const { bytes } = buildTDT(
      tower([
        unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
        unit({ id: 2, kind: "office", floor: 2, x: 0, width: 12, state: "occupied" }), // 6
        unit({ id: 3, kind: "fastFood", floor: 3, x: 0, width: 16, state: "occupied" }), // 25
        unit({ id: 4, kind: "restaurant", floor: 4, x: 0, width: 24, state: "occupied" }), // 35
        unit({ id: 5, kind: "shop", floor: 5, x: 0, width: 12, state: "empty" }), // 0 (vacant)
      ]),
    );
    expect(u32(bytes, peopleOffset(bytes))).toBe(6 + 25 + 35);
  });

  it("a forged NaN condo `residents` can't poison the census to 0", () => {
    const { bytes } = buildTDT(
      tower([
        unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
        unit({ id: 2, kind: "office", floor: 2, x: 0, width: 12, state: "occupied" }), // 6
        unit({ id: 3, kind: "condo", floor: 3, x: 0, width: 16, state: "occupied", residents: NaN }),
      ]),
    );
    // The office's 6 survives (the NaN addend is skipped, not propagated), and
    // the count stays a finite nonzero -- never NaN -> 0.
    expect(u32(bytes, peopleOffset(bytes))).toBeGreaterThanOrEqual(6);
  });

  it("emits the 0xff routing tail so the file reaches the length the game reads", () => {
    const { bytes } = buildTDT(tower([unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 })]));
    const tail = bytes.subarray(bytes.length - TDT_ROUTING_TAIL_SIZE);
    expect(tail).toHaveLength(TDT_ROUTING_TAIL_SIZE);
    expect(tail.every((x) => x === 0xff)).toBe(true);
  });

  it("writes the New Tower view-scroll default so a load opens on the ground lobby", () => {
    const { bytes } = buildTDT(tower([unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 })]));
    expect(u16(bytes, 0x26)).toBe(TDT_DEFAULT_VIEW_X);
    expect(u16(bytes, 0x28)).toBe(TDT_DEFAULT_VIEW_Y);
  });

  it("a built shaft carries the default schedule block (not zeros) so its cars run", () => {
    const { bytes } = buildTDT(
      tower([unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 })], [shaft()]),
    );
    let o = peopleOffset(bytes);
    o += 4 + u32(bytes, o) * TDT_PERSON_RECORD_SIZE; // skip people block
    o += 512 * 18; // skip retail table -> elevator table, first slot is the shaft
    expect(bytes[o]).toBe(1); // used
    expect([...bytes.subarray(o + 4, o + 4 + 56)]).toEqual([...TDT_ELEVATOR_SCHEDULE_DEFAULT]);
  });

  it("all of these still round-trip through our parser with zero warnings", () => {
    const { bytes } = buildTDT(
      tower(
        [
          unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
          unit({ id: 2, kind: "office", floor: 2, x: 0, width: 12, state: "occupied" }),
        ],
        [shaft()],
      ),
    );
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
  });
});
