import { describe, expect, it } from "vitest";
import { newSeededGame } from "../fixtures/towerFixtures";
import type { FacilityKind, SerializedGame, Transport, Unit } from "../../engine/types";
import { SAVE_VERSION } from "../../engine/saveMigration";
import {
  TDT_DEFAULT_VIEW_X,
  TDT_DEFAULT_VIEW_Y,
  TDT_ELEVATOR_PER_FLOOR_SIZE,
  TDT_ELEVATOR_SCHEDULE_DEFAULT,
  TDT_FLOOR_COUNT,
  TDT_FLOOR_INDEX_ENTRIES,
  TDT_FLOOR_OFFSET,
  TDT_HEADER_SIZE,
  TDT_PERSON_RECORD_SIZE,
  TDT_TENANT_RECORD_SIZE,
  TDT_ROUTING_TAIL_SIZE,
  parseTdtBinary,
} from "../../storage/tdtFormat";
import { LegacyExportError, buildTDT, classFromRent, legacyFilename } from "../../storage/tdtExport";
import { FACILITIES, GRID } from "../../engine/facilities";
import { FASTFOOD_SUBTYPES, RESTAURANT_SUBTYPES, SHOP_SUBTYPES } from "../../engine/retailSubtypes";
import { FAMILY_STORIES, PART_FAMILY, parseTDT } from "../../storage/tdtImport";
import { buildTdt, sampleTowerSpec } from "../fixtures/tdtBuilder";

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

/** Read one floor's raw unit records (in FILE order, not through parseTDT which
 *  merges and re-sorts) straight from exported bytes, for the record-ordering
 *  tests. Walks the 6-byte floor header + `count` × {@link TDT_TENANT_RECORD_SIZE}
 *  records + the per-floor remap table, using the codec constants so it tracks
 *  the format. */
function readFloorRecords(bytes: Uint8Array, tdtIndex: number): { left: number; type: number }[] {
  const u16 = (off: number) => bytes[off] | (bytes[off + 1] << 8);
  let off = TDT_HEADER_SIZE;
  for (let index = 0; index < TDT_FLOOR_COUNT; index++) {
    const count = u16(off);
    const base = off + 6;
    if (index === tdtIndex) {
      const recs: { left: number; type: number }[] = [];
      for (let k = 0; k < count; k++) {
        const ro = base + k * TDT_TENANT_RECORD_SIZE;
        recs.push({ left: u16(ro), type: (bytes[ro + 4] << 24) >> 24 });
      }
      return recs;
    }
    off = base + count * TDT_TENANT_RECORD_SIZE + TDT_FLOOR_INDEX_ENTRIES * 2;
  }
  return [];
}

/** Walk to one floor's record block and hand the caller its 6-byte header plus
 *  every record's full span. Used by the coverage tests, which have to ask what
 *  TILES a row's records actually cover, not just which types appear on it. */
function readFloor(
  bytes: Uint8Array,
  tdtIndex: number,
): { extent: { left: number; right: number }; spans: { left: number; right: number; type: number }[] } {
  const u16 = (off: number) => bytes[off] | (bytes[off + 1] << 8);
  let off = TDT_HEADER_SIZE;
  for (let index = 0; index < TDT_FLOOR_COUNT; index++) {
    const count = u16(off);
    const base = off + 6;
    if (index === tdtIndex) {
      const spans: { left: number; right: number; type: number }[] = [];
      for (let k = 0; k < count; k++) {
        const ro = base + k * TDT_TENANT_RECORD_SIZE;
        spans.push({ left: u16(ro), right: u16(ro + 2), type: (bytes[ro + 4] << 24) >> 24 });
      }
      return { extent: { left: u16(off + 2), right: u16(off + 4) }, spans };
    }
    off = base + count * TDT_TENANT_RECORD_SIZE + TDT_FLOOR_INDEX_ENTRIES * 2;
  }
  return { extent: { left: 0, right: 0 }, spans: [] };
}

const recordSpans = (bytes: Uint8Array, tdtIndex: number) => readFloor(bytes, tdtIndex).spans;
const floorExtent = (bytes: Uint8Array, tdtIndex: number) => readFloor(bytes, tdtIndex).extent;

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

  it("the built-shaft payload size is car-count INDEPENDENT (guards the cars*348 desync)", () => {
    // The appended built-shaft block is a SINGLE fixed 348-byte car block, one
    // per shaft, NOT one per car (harness-confirmed on the real 1994 game).
    // Sizing it `cars * 348` overran every multi-car shaft and desynced the
    // retail game's whole elevator table after the first one (only one elevator
    // rendered, and the parking/basement block after it mis-read). The
    // exporter, importer skip, and tdtBuilder fixture all share one constant, so
    // a revert to `* cars` would move together and leave every OTHER test green;
    // this is the only automated guard. Two exports identical except the car
    // count (same floor range -> same serviced floors) MUST be the same length.
    const shaft = (cars: number) => ({
      id: 100,
      kind: "elevatorStandard" as FacilityKind,
      x: 100,
      width: 4,
      bottom: 1,
      top: 10,
      cars,
      carPositions: Array.from({ length: cars }, () => 1),
      carDir: Array.from({ length: cars }, () => 0),
      load: 0,
    });
    const oneCar = sampleSave();
    oneCar.transports.push(shaft(1));
    const eightCars = sampleSave();
    eightCars.transports.push(shaft(8));
    expect(buildTDT(eightCars).bytes.length).toBe(buildTDT(oneCar).bytes.length);
  });

  it("the built-shaft payload size counts SPANNED floors, not serviced ones", () => {
    // Sibling of the car-count guard above, and the same class of bug. The
    // appended per-floor entries run bottom..top INCLUSIVE, whether or not the
    // shaft stops on a floor: every reference save we had stopped everywhere,
    // so serviced == spanned there and the wrong rule looked right. Sizing by
    // serviced floors under-ran any shaft with skip floors, and the real 1994
    // game then lost every shaft after it (measured on the Wine harness: a
    // 4-shaft tower rendered 2). Two exports identical except one shaft's stop
    // settings MUST be the same length; a serviced-floor size makes the skipping
    // one shorter.
    const shaft = (skipFloors: number[]) => ({
      id: 100,
      kind: "elevatorStandard" as FacilityKind,
      x: 100,
      width: 4,
      bottom: 1,
      top: 12,
      cars: 2,
      carPositions: [1, 1],
      carDir: [0, 0],
      load: 0,
      skipFloors,
    });
    const stopsEverywhere = sampleSave();
    stopsEverywhere.transports.push(shaft([]));
    const skipsFive = sampleSave();
    skipsFive.transports.push(shaft([4, 5, 6, 7, 8]));
    expect(buildTDT(skipsFive).bytes.length).toBe(buildTDT(stopsEverywhere).bytes.length);
    // Same length only proves the size ignores stop flags; it would also hold
    // for a fixed 120-entry block or any other skip-independent rule. Pin the
    // rule itself: growing a shaft's SPAN by N floors must grow the file by
    // exactly N per-floor entries. The taller shaft skips ten INTERIOR floors,
    // so both shafts stop at exactly 12 floors (endpoints always stop): under
    // the old serviced-floor rule this delta would be 0, not 10 entries.
    const shorter = sampleSave();
    shorter.transports.push({ ...shaft([]), top: 12 });
    const taller = sampleSave();
    taller.transports.push({ ...shaft([12, 13, 14, 15, 16, 17, 18, 19, 20, 21]), top: 22 });
    expect(buildTDT(taller).bytes.length - buildTDT(shorter).bytes.length).toBe(
      10 * TDT_ELEVATOR_PER_FLOOR_SIZE,
    );
    // And the stop settings themselves still round-trip (the bitmap is written
    // whatever the payload size is).
    const back = parseTDT(buildTDT(skipsFive).bytes.buffer as ArrayBuffer, "S.TDT").save;
    const imported = back.transports.find((t) => t.x === 100 && t.kind === "elevatorStandard")!;
    expect(imported.skipFloors).toEqual([4, 5, 6, 7, 8]);
  });

  it("a fixed tower exports to a GOLDEN byte length (pins the absolute block sizes)", () => {
    // Every other size test here is relative, and the writer, the reader's skip,
    // and the fixture all share one helper, so they move together: a wrong value
    // for TDT_ELEVATOR_BUILT_FIXED (3140), TDT_ELEVATOR_PER_FLOOR_SIZE (324) or
    // TDT_ELEVATOR_CAR_BLOCK_SIZE (348) round-trips through our own code
    // perfectly while the real 1994 game desyncs. Those three numbers are
    // measured against the retail game (docs/canon/tdt-format.md §8), not
    // derivable, so pin them with a LITERAL: this tower must export to exactly
    // this many bytes.
    //
    // If this fails, do NOT just update the number. The likely causes, in order:
    // the three elevator block sizes (re-measure on the tools/simtower harness
    // and update the canon doc), TDT_ROUTING_TAIL_SIZE (25,600 here, and still
    // provisional per its own docstring), or a change to the fixed header /
    // retail / finance / parking / stairs block sizes. Work out which, and say
    // so here.
    //
    // The tower is deliberately POPULATION-FREE (structure and one shaft, no
    // tenants): the people block is 16 bytes per resident, so a census-bearing
    // tower would make this literal move whenever an economy knob like office
    // population is tuned, firing a byte-layout test for a balance change.
    const units: Unit[] = [unit({ id: 1, kind: "lobby", floor: 1, x: 100, width: 1, state: "occupied" })];
    for (let i = 0; i < 4; i++) {
      units.push(unit({ id: 10 + i, kind: "floor", floor: 2 + i, x: 100, width: 9 }));
    }
    const save: SerializedGame = {
      version: SAVE_VERSION, seed: 1, money: 1_000_000, star: 1, minutes: 600, mode: "classic",
      units, nextId: 100, towerName: "GOLD", builtWeddingHall: false, evaluatedTower: false,
      transports: [
        {
          id: 50, kind: "elevatorStandard", x: 90, width: 4, bottom: 1, top: 8, cars: 2,
          carPositions: [1, 1], carDir: [0, 0], load: 0, skipFloors: [3, 4],
        },
      ],
    };
    const built = buildTDT(save);
    expect(built.report.comesAlong[0]).toMatch(/^0 rooms/); // no census: see above
    expect(built.bytes.length).toBe(71_284);
  });

  // `builtShaftPayloadSize`'s own arithmetic contract is pinned at the UNIT
  // tier, in src/storage/tdtConstants.test.ts, so `npm run test:unit` covers the
  // root byte-layout invariant without the heavier integration project. What
  // the tests here own is the part only a whole encoded file can show: that the
  // writer, the reader's skip and the fixture actually AGREE on that size.

  it("a shaft AFTER a skip-floor shaft still decodes (the desync the game showed)", () => {
    // The guard the previous test cannot be: a writer/reader disagreement about
    // the payload rule only bites the slots that FOLLOW a shaft whose serviced
    // count differs from its span. With the skipping shaft last, a wrong skip
    // lands in trailing padding, every later slot reads as empty, and nothing
    // fails. So: skipping shaft first, ordinary shaft after it, and the second
    // shaft's geometry must survive the round trip. In the real 1994 game this
    // exact shape rendered 2 of 4 shafts before the fix.
    const save = sampleSave();
    save.transports.push({
      id: 200,
      kind: "elevatorStandard" as FacilityKind,
      x: 100,
      width: 4,
      bottom: 1,
      top: 12,
      cars: 2,
      carPositions: [1, 1],
      carDir: [0, 0],
      load: 0,
      skipFloors: [4, 5, 6, 7, 8],
    });
    save.transports.push({
      id: 201,
      kind: "elevatorService" as FacilityKind,
      x: 120,
      width: 4,
      bottom: 2,
      top: 9,
      cars: 3,
      carPositions: [2, 2, 2],
      carDir: [0, 0, 0],
      load: 0,
    });
    const { bytes } = buildTDT(save);
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
    // The test only has teeth while the skipping shaft is written to an EARLIER
    // slot than the plain one: with it last, a wrong skip lands in trailing
    // padding, every later slot reads as empty, and nothing fails. Pin the order
    // in the file so a future change that sorts shafts cannot quietly neuter it.
    const decoded = parseTdtBinary(bytes).elevators!;
    const skipperSlot = decoded.findIndex((e) => e.x === 100);
    const trailingSlot = decoded.findIndex((e) => e.x === 120);
    expect(skipperSlot).toBeGreaterThanOrEqual(0);
    expect(trailingSlot).toBeGreaterThan(skipperSlot);
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT").save;
    const trailing = back.transports.find((t) => t.kind === "elevatorService" && t.x === 120);
    expect(trailing).toBeDefined();
    expect(trailing!.bottom).toBe(2);
    expect(trailing!.top).toBe(9);
    expect(trailing!.cars).toBe(3);
    // The skipping shaft ahead of it kept its own stop settings.
    const skipper = back.transports.find((t) => t.kind === "elevatorStandard" && t.x === 100)!;
    expect(skipper.skipFloors).toEqual([4, 5, 6, 7, 8]);
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
    const sim = newSeededGame(3);
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

    // Export-side ground truth (NOT circular via parseTDT): the variant index
    // must land on unit-record byte 6, where the real 1994 game reads it, and
    // byte 17 must stay 0. parseTdtBinary reads those fixed offsets literally
    // (.variant = byte 6, .subtype = byte 17), so this pins the wire bytes.
    const raw = parseTdtBinary(bytes);
    const allTenants = raw.floors.flatMap((fl) => fl.tenants);
    const tenantOf = (type: number) => allTenants.find((t) => t.type === type);
    expect(tenantOf(10)?.variant).toBe(3); // shop Book Store at byte 6
    expect(tenantOf(12)?.variant).toBe(1); // fastFood Chinese Cafe at byte 6
    expect(tenantOf(6)?.variant).toBe(4); // restaurant Steak House at byte 6
    expect(tenantOf(10)?.subtype).toBe(0); // byte 17 stays 0 (not the variant)
    expect(tenantOf(12)?.subtype).toBe(0);
    expect(tenantOf(6)?.subtype).toBe(0);

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

  // Floor-record ordering (gh-318 sky-gap). Game-written saves list a floor's
  // unit records in ascending left-edge order, with the empty-floor (type-0)
  // paving spans interleaved at their real x-position. Our gather appends the
  // type-0 fillers after the rooms, so a wide floor with a mid-floor gap used to
  // emit records out of x-order; the real 1994 renderer then truncated the floor
  // at the misplaced type-0 span and drew the rest of the floor as bare sky
  // (verified in the Wine harness). The encoder now sorts each floor's records
  // by left edge; this pins that a mid-floor gap keeps the records ascending.
  it("emits a wide floor's records in ascending left order, type-0 gap interleaved (gh-318)", () => {
    // A wide floor: three 9-wide offices, a 2-tile paving gap, then a fourth
    // office past the gap. The gap becomes a type-0 span sitting BETWEEN the
    // third and fourth office by x, but our gather appends it after every room.
    const OURFLOOR = 3;
    const save: SerializedGame = {
      version: SAVE_VERSION,
      seed: 1,
      money: 2_000_000,
      star: 1,
      minutes: 7 * 60,
      mode: "classic",
      units: [
        unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
        unit({ id: 2, kind: "office", floor: OURFLOOR, x: 0, width: 9 }), // 0..9
        unit({ id: 3, kind: "office", floor: OURFLOOR, x: 9, width: 9 }), // 9..18
        unit({ id: 4, kind: "office", floor: OURFLOOR, x: 18, width: 9 }), // 18..27
        unit({ id: 5, kind: "floor", floor: OURFLOOR, x: 27, width: 1 }), // paving gap
        unit({ id: 6, kind: "floor", floor: OURFLOOR, x: 28, width: 1 }), // paving gap
        unit({ id: 7, kind: "office", floor: OURFLOOR, x: 29, width: 9 }), // 29..38 (past the gap)
      ],
      transports: [],
      nextId: 100,
      towerName: "Ordering",
      builtWeddingHall: false,
      evaluatedTower: false,
    };
    const { bytes } = buildTDT(save);
    const recs = readFloorRecords(bytes, OURFLOOR + TDT_FLOOR_OFFSET);

    // The gap must round-trip as a type-0 record on this floor.
    expect(recs.some((r) => r.type === 0)).toBe(true);
    // Every record's left edge is non-decreasing: the type-0 span sits between
    // the offices it separates, not appended after the last one.
    const lefts = recs.map((r) => r.left);
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
    // Exactly one type-0 gap here (left 27); it must sit BEFORE the office past
    // the gap (left 29) in file order, not appended after it. Anchor on the
    // specific spans so a stray type-0 elsewhere can't satisfy the check.
    const gapPos = recs.findIndex((r) => r.type === 0 && r.left === 27);
    const officePastGapPos = recs.findIndex((r) => r.type === 7 && r.left === 29);
    expect(gapPos).toBeGreaterThanOrEqual(0);
    expect(officePastGapPos).toBeGreaterThanOrEqual(0);
    expect(gapPos).toBeLessThan(officePastGapPos);
  });

  it("a forged out-of-range unit x still emits records in encoded-u16 order (sort guard, gh-318)", () => {
    // The sort must key on the u16 value that gets WRITTEN (left & 0xffff), not
    // the raw left: a non-finite or out-of-range left encodes to a different
    // u16 than it sorts as (NaN -> 0, -1 -> 65535), so keying on the raw value
    // could still emit records whose encoded left goes backwards and re-open the
    // sky-gap. Records must come out ascending by the ENCODED value, and the
    // export must be deterministic.
    const OURFLOOR = 3;
    const forged: SerializedGame = {
      version: SAVE_VERSION,
      seed: 1,
      money: 2_000_000,
      star: 1,
      minutes: 7 * 60,
      mode: "classic",
      units: [
        unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
        unit({ id: 2, kind: "office", floor: OURFLOOR, x: 0, width: 9 }),
        unit({ id: 3, kind: "office", floor: OURFLOOR, x: Number.NaN, width: 9 }),
        unit({ id: 4, kind: "office", floor: OURFLOOR, x: 18, width: 9 }),
      ],
      transports: [],
      nextId: 100,
      towerName: "Forged",
      builtWeddingHall: false,
      evaluatedTower: false,
    };
    const a = buildTDT(forged).bytes;
    const b = buildTDT(forged).bytes;
    expect(a).toEqual(b); // deterministic

    // Records come out ascending by the ENCODED u16 left (the value written).
    const lefts = readFloorRecords(a, OURFLOOR + TDT_FLOOR_OFFSET).map((r) => r.left);
    expect(lefts).toEqual([...lefts].sort((x, y) => x - y));
  });

  // Sky-lobby canonicalization (gh-319, doc §14). A plain floor on a sky-lobby
  // story (15/30/45…) exports byte-identically to a lobby there, and reads back
  // as a lobby. Harness-confirmed on the live 1994 game: our type-24 export of a
  // sky story renders as a sky lobby (the game draws lobby arches); feeding raw
  // type-0 there would draw bare floor, but the exporter never emits that.
  it("a plain floor on a sky-lobby story exports as a lobby, byte-identical (gh-319)", () => {
    const SKY = GRID.lobbyInterval * 2; // a multiple of the interval -> a sky-lobby story
    const towerWith = (kind: "floor" | "lobby"): SerializedGame => ({
      version: SAVE_VERSION,
      seed: 1,
      money: 2_000_000,
      star: 1,
      minutes: 7 * 60,
      mode: "classic",
      units: [
        unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
        // Same span on the sky story, only the KIND differs.
        unit({ id: 2, kind, floor: SKY, x: 40, width: 1 }),
        unit({ id: 3, kind, floor: SKY, x: 41, width: 1 }),
        unit({ id: 4, kind, floor: SKY, x: 42, width: 1 }),
      ],
      transports: [],
      nextId: 10,
      towerName: "Sky",
      builtWeddingHall: false,
      evaluatedTower: false,
    });
    const asFloor = buildTDT(towerWith("floor")).bytes;
    const asLobby = buildTDT(towerWith("lobby")).bytes;
    // The format carries no floor-vs-lobby distinction at a sky story: identical bytes.
    expect(asFloor).toEqual(asLobby);
    // And the sky story's records are the lobby type (24), not empty floor (0).
    const recs = readFloorRecords(asFloor, SKY + TDT_FLOOR_OFFSET);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.type === 24)).toBe(true);
    // Round-trips back as a lobby, not a bare floor.
    const back = parseTDT(asFloor.buffer as ArrayBuffer, "SKY.TDT").save;
    const skyKinds = new Set(back.units.filter((u) => u.floor === SKY).map((u) => u.kind));
    expect(skyKinds.has("lobby")).toBe(true);
    expect(skyKinds.has("floor")).toBe(false);

    // Contrast: the SAME plain floor on a NON-lobby story exports as empty floor
    // (type 0), not lobby. This pins that the type-24 above is sky-story-specific
    // (the isLobbyFloor gate), not "all paving is a lobby".
    const NOTSKY = SKY + 1; // one story above a sky lobby -> not a lobby floor
    const plainNonSky: SerializedGame = { ...towerWith("floor"), units: [
      unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
      unit({ id: 2, kind: "floor", floor: NOTSKY, x: 40, width: 1 }),
      unit({ id: 3, kind: "floor", floor: NOTSKY, x: 41, width: 1 }),
      unit({ id: 4, kind: "floor", floor: NOTSKY, x: 42, width: 1 }),
    ] };
    const nonSkyRecs = readFloorRecords(buildTDT(plainNonSky).bytes, NOTSKY + TDT_FLOOR_OFFSET);
    expect(nonSkyRecs.length).toBeGreaterThan(0);
    expect(nonSkyRecs.every((r) => r.type === 0)).toBe(true);
  });

  it("warns when a kept-legacy narrow shaft would collide at 1994's fixed elevator width", () => {
    // A boxed-in 3-wide standard the v5 migration preserved sits flush against
    // a 4-wide service shaft: legal in-engine, but the 1994 format has no
    // width field, so both export at the fixed footprint and overlap. The
    // report must say so instead of claiming every shaft made the trip.
    const save = sampleSave();
    const shaft = (kind: "elevatorStandard" | "elevatorService", x: number, width: number) => ({
      id: x,
      kind: kind as FacilityKind,
      x,
      width,
      bottom: 1,
      top: 10,
      cars: 1,
      carPositions: [1],
      carDir: [0],
      load: 0,
    });
    save.transports.push(shaft("elevatorStandard", 100, 3), shaft("elevatorService", 103, 4));
    const { report } = buildTDT(save);
    expect(report.staysBehind.join(" ")).toMatch(/overlaps a neighbor at 1994's fixed footprint widths/);

    // Control: the same pair with a clear tile between full-width footprints
    // raises no warning.
    const clear = sampleSave();
    clear.transports.push(shaft("elevatorStandard", 100, 3), shaft("elevatorService", 105, 4));
    expect(buildTDT(clear).report.staysBehind.join(" ")).not.toMatch(/at 1994's fixed footprint widths/);
  });

  it("the overlap warning inspects the emitted (collapsed) stair records, not the raw flight list", () => {
    // 66 stacked one-floor flights in one column collapse into 22 three-story
    // records, all comfortably inside the 64-slot table; a colliding escalator
    // beside the run would be sliced out of a raw-flight scan capped at 64
    // entries, silently hiding the warning for bytes that ARE exported.
    const save = sampleSave();
    const flight = (kind: "stairs" | "escalator", x: number, bottom: number, id: number) => ({
      id,
      kind: kind as FacilityKind,
      x,
      width: 8,
      bottom,
      top: bottom + 1,
      cars: 0,
      carPositions: [],
      carDir: [],
      load: 0,
    });
    for (let i = 0; i < 66; i++) save.transports.push(flight("stairs", 300, 1 + i, 9_000 + i));
    save.transports.push(flight("escalator", 304, 1, 9_999)); // overlaps the run at full width
    const { report } = buildTDT(save);
    expect(report.staysBehind.join(" ")).toMatch(/at 1994's fixed footprint widths/);
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

describe("buildTDT: No-Rate rent class + lastQuarterMoney header", () => {
  /** Little-endian i32 read at a header byte offset. */
  const i32 = (b: Uint8Array, off: number) =>
    (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) | 0;

  /** A minimal Classic save carrying `units`. */
  const tower = (units: Unit[], extra: Partial<SerializedGame> = {}): SerializedGame => ({
    version: SAVE_VERSION,
    seed: 1,
    money: 2_000_000,
    star: 1,
    minutes: 7 * 60,
    mode: "classic",
    units,
    transports: [],
    nextId: units.length + 1,
    towerName: "NoRate",
    builtWeddingHall: false,
    evaluatedTower: false,
    ...extra,
  });

  it("a No-Rate office exports rent-class byte 4", () => {
    const { bytes } = buildTDT(
      tower([unit({ id: 1, kind: "office", floor: 5, x: 100, width: 9, noRate: true })]),
    );
    const tdt = parseTdtBinary(bytes);
    const tenant = tdt.floors.flatMap((f) => f.tenants).find((t) => Math.abs(t.type) === 7);
    expect(tenant?.rentRate).toBe(4);
  });

  it("a non-priced kind (no rent band) exports rent-class byte 4, matching real saves", () => {
    // fast food / security / housekeeping charge no tenant rent; the 1994 game
    // stores them as class 4 (No Rate). Confirmed in my_tower/mo real saves.
    const { bytes } = buildTDT(
      tower([unit({ id: 1, kind: "fastFood", floor: 5, x: 100, width: 16 })]),
    );
    const tdt = parseTdtBinary(bytes);
    const tenant = tdt.floors.flatMap((f) => f.tenants).find((t) => Math.abs(t.type) === 12);
    expect(tenant?.rentRate).toBe(4);
  });

  it("No Rate survives a full round-trip (build -> import -> re-build keeps class 4)", () => {
    const save = tower([unit({ id: 1, kind: "office", floor: 5, x: 100, width: 9, noRate: true })]);
    const first = buildTDT(save).bytes;
    const reimported = parseTDT(first.buffer as ArrayBuffer, "N.TDT").save;
    const office = reimported.units.find((u) => u.kind === "office")!;
    expect(office.noRate).toBe(true); // flag came back on import
    const again = parseTdtBinary(buildTDT(reimported).bytes);
    const tenant = again.floors.flatMap((f) => f.tenants).find((t) => Math.abs(t.type) === 7);
    expect(tenant?.rentRate).toBe(4); // and re-export still emits class 4
  });

  it("Classic rung values round-trip losslessly: every rung of every kind maps to its class and back exactly (FR8)", () => {
    // One unit per rung per rentable kind, plus a No Rate office; the rung
    // dollar values ARE the class anchors post-split, so nothing snaps.
    const ladders: [FacilityKind, number, number[]][] = [
      ["office", 9, [2_000, 5_000, 10_000, 15_000]],
      ["condo", 16, [50_000, 100_000, 150_000, 200_000]],
      ["hotelSingle", 4, [500, 1_500, 2_000, 3_000]],
      ["hotelDouble", 6, [800, 2_000, 3_000, 4_500]],
      ["hotelSuite", 10, [1_500, 4_000, 6_000, 9_000]],
    ];
    const units: Unit[] = [];
    let id = 1;
    ladders.forEach(([kind, width, values], row) => {
      values.forEach((rent, i) => {
        units.push(unit({ id: id++, kind, floor: 5 + row, x: 20 + i * 40, width, rent }));
      });
    });
    units.push(unit({ id: id++, kind: "office", floor: 12, x: 200, width: 9, noRate: true }));
    const save = tower(units);
    const first = buildTDT(save);
    // Byte level: each unit's rent class is exactly its rung level (0-3), and
    // the No Rate office carries class 4 (doc §4 tenant type IDs).
    const TYPE: Record<string, number> = { office: 7, condo: 9, hotelSingle: 3, hotelDouble: 4, hotelSuite: 5 };
    const tdt = parseTdtBinary(first.bytes);
    const tenants = tdt.floors.flatMap((f) => f.tenants);
    for (const [kind] of ladders) {
      const rates = tenants
        .filter((t) => Math.abs(t.type) === TYPE[kind])
        .sort((a, b) => a.left - b.left)
        .map((t) => t.rentRate);
      // The office row carries the extra class-4 (No Rate) unit at the far right.
      expect(rates, kind).toEqual(kind === "office" ? [0, 1, 2, 3, 4] : [0, 1, 2, 3]);
    }
    // Round trip: the exact rung dollars come back on import (class 2 included:
    // Average is a real value now, not "keep the default").
    const back = parseTDT(first.bytes.buffer as ArrayBuffer, "R.TDT").save;
    for (const [kind, , values] of ladders) {
      const rents = back.units
        .filter((u) => u.kind === kind && !u.noRate)
        .sort((a, b) => a.x - b.x)
        .map((u) => u.rent);
      expect(rents, kind).toEqual(values);
    }
    expect(back.units.some((u) => u.kind === "office" && u.noRate === true)).toBe(true);
    // Zero importer warnings, and re-export is byte-identical (NFR9).
    expect(parseTdtBinary(first.bytes).warnings).toEqual([]);
    expect(buildTDT(back).bytes).toEqual(first.bytes);
    // The reverse fidelity report's "rents snap" line no longer applies: a
    // post-split Classic tower's rents are already the four classes.
    expect(first.report.staysBehind.some((s) => s.includes("snap to 1994's four lease classes"))).toBe(false);
  });

  it("writes lastQuarterMoney at header 0x10 (÷100), and 0 when unset", () => {
    const withSnapshot = buildTDT(tower([], { lastQuarterMoney: 1_500_000 })).bytes;
    expect(i32(withSnapshot, 0x10)).toBe(15_000); // 1,500,000 / 100

    const unset = buildTDT(tower([])).bytes;
    expect(i32(unset, 0x10)).toBe(0); // no snapshot -> 0
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

  it("burned-out and burning rooms export as bare floor, never as a type-48 record", () => {
    // The 1994 game draws a type-48 (burned area) record as garbage pixels,
    // measured on the Wine harness, so the exporter clears the debris instead:
    // the tiles come out as ordinary paving and the loss is reported.
    const save = sampleSave();
    const office = save.units.find((u) => u.kind === "office" && u.state === "occupied")!;
    office.state = "gutted";
    const { bytes, report } = buildTDT(save);
    expect(report.staysBehind.join(" ")).toMatch(/burned or burning room arrives cleared/);
    const records = readFloorRecords(bytes, office.floor + TDT_FLOOR_OFFSET);
    expect(records.some((r) => r.type === 48)).toBe(false);
    // EVERY tile the room occupied must come back as paving. Asserting only
    // that SOME paving record exists on the row would pass even if the vacated
    // span were left as a hole (which reads as unbuilt lot, the #318 sky gap).
    const paved = new Set<number>();
    for (const r of recordSpans(bytes, office.floor + TDT_FLOOR_OFFSET)) {
      if (r.type !== 0 && r.type !== 24) continue;
      for (let x = r.left; x < r.right; x++) paved.add(x);
    }
    const width = office.width ?? FACILITIES.office.width;
    for (let x = office.x; x < office.x + width; x++) {
      expect(paved.has(x)).toBe(true);
    }
    const back = parseTDT(bytes.buffer as ArrayBuffer, "S.TDT");
    expect(
      back.save.units.some(
        (u) => u.kind === "office" && u.x === office.x && u.floor === office.floor,
      ),
    ).toBe(false);
  });

  it("a floor whose ONLY room burned still exports, paved end to end", () => {
    // The shape the wide-record test cannot reach: nothing else on the row to
    // pave around, so if the vacated tiles did not claim the extent themselves
    // the floor would vanish from the file (or come back as unbuilt lot).
    const save = sampleSave();
    const floor = 7;
    save.units = save.units.filter((u) => u.floor !== floor);
    save.units.push(unit({ id: 9_400, kind: "office", floor, x: 120, width: 9, state: "gutted" }));
    const { bytes } = buildTDT(save);
    const spans = recordSpans(bytes, floor + TDT_FLOOR_OFFSET);
    expect(spans.some((r) => r.type === 48)).toBe(false);
    const paved = new Set<number>();
    for (const r of spans) {
      if (r.type !== 0 && r.type !== 24) continue;
      for (let x = r.left; x < r.right; x++) paved.add(x);
    }
    for (let x = 120; x < 129; x++) expect(paved.has(x)).toBe(true);
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
  });

  it("a burned room hanging off the lot edge claims no extent it cannot fill", () => {
    // A forged/legacy unit whose footprint runs past the lot: the paving pass
    // clamps its runs into [0, GRID.width], so the floor's advertised extent
    // must be clamped the same way. An unclamped extent leaves a tail of the
    // row with no record behind it.
    const save = sampleSave();
    const floor = 8;
    save.units = save.units.filter((u) => u.floor !== floor);
    save.units.push(
      unit({ id: 9_401, kind: "office", floor, x: GRID.width - 4, width: 9, state: "gutted" }),
    );
    const { bytes } = buildTDT(save);
    const spans = recordSpans(bytes, floor + TDT_FLOOR_OFFSET);
    // The row must actually EXIST (an empty walk would satisfy every bound
    // below vacuously) and its paving must reach the lot edge.
    expect(spans.length).toBeGreaterThan(0);
    const right = Math.max(...spans.map((r) => r.right));
    expect(right).toBe(GRID.width);
    // The header extent is the assertion with teeth: `w.u16` masks rather than
    // clamps, so an unclamped extent wraps instead of saturating.
    const extent = floorExtent(bytes, floor + TDT_FLOOR_OFFSET);
    expect(extent.right).toBe(GRID.width);
    expect(extent.right).toBeGreaterThanOrEqual(extent.left);
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
  });

  it("a row's encoded left edges never go backwards, even from a negative x", () => {
    // The 1994 renderer truncates a floor at the first record whose left edge
    // goes backwards (the #318 sky gap), so the record ORDER must match the
    // bytes actually written. Clamping the written left without re-keying the
    // sort broke exactly that: a left of -1 sorts LAST under the old mask key
    // (65535) but writes as 0, putting a 0 after a 40 in the file.
    const save = sampleSave();
    const floor = 6;
    save.units = save.units.filter((u) => u.floor !== floor);
    save.units.push(unit({ id: 9_500, kind: "office", floor, x: -1, width: 9, state: "occupied" }));
    save.units.push(unit({ id: 9_501, kind: "office", floor, x: 40, width: 9, state: "occupied" }));
    const { bytes } = buildTDT(save);
    const lefts = recordSpans(bytes, floor + TDT_FLOOR_OFFSET).map((r) => r.left);
    expect(lefts.length).toBeGreaterThan(1);
    for (let i = 1; i < lefts.length; i++) expect(lefts[i]).toBeGreaterThanOrEqual(lefts[i - 1]);
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
  });

  it("a forged unit's row never advertises an extent its records contradict", () => {
    // `w.u16` masks rather than clamps, so a forged width could put a row's
    // header and its records on different stories: the #318 sky gap in
    // miniature. The invariant is agreement, in BOTH directions, whatever the
    // paving pass decides to emit (an infinite width it refuses outright, which
    // is why asserting "records exist" here would be asserting the wrong thing).
    for (const [floor, width] of [
      [9, Number.POSITIVE_INFINITY],
      [8, 400], // finite but past the lot edge
    ] as const) {
      const save = sampleSave();
      save.units = save.units.filter((u) => u.floor !== floor);
      save.units.push(unit({ id: 9_402 + floor, kind: "floor", floor, x: 0, width }));
      const { bytes } = buildTDT(save);
      const spans = recordSpans(bytes, floor + TDT_FLOOR_OFFSET);
      const extent = floorExtent(bytes, floor + TDT_FLOOR_OFFSET);
      expect(extent.right).toBeLessThanOrEqual(GRID.width);
      expect(extent.right).toBeGreaterThanOrEqual(extent.left);
      for (const r of spans) {
        expect(r.left).toBeGreaterThanOrEqual(extent.left);
        expect(r.right).toBeLessThanOrEqual(extent.right);
      }
      // An empty extent must mean an empty row, and a non-empty row a non-empty
      // extent; either half alone can be satisfied by dropping the other.
      expect(spans.length > 0).toBe(extent.right > extent.left);
      expect(parseTdtBinary(bytes).warnings).toEqual([]);
    }
  });

  it("a burned room on the GROUND row comes back as lobby, not bare floor", () => {
    // The one row where the paving pass picks a different type, and the row the
    // export report's wording ("bare floor, or lobby on a lobby row") promises.
    const save = sampleSave();
    save.units = save.units.filter((u) => u.floor !== 1);
    save.units.push(unit({ id: 9_404, kind: "lobby", floor: 1, x: 100, width: 1, state: "occupied" }));
    save.units.push(unit({ id: 9_405, kind: "office", floor: 1, x: 101, width: 9, state: "gutted" }));
    const { bytes } = buildTDT(save);
    const lobbyTiles = new Set<number>();
    for (const r of recordSpans(bytes, 1 + TDT_FLOOR_OFFSET)) {
      if (r.type !== 24) continue;
      for (let x = r.left; x < r.right; x++) lobbyTiles.add(x);
    }
    for (let x = 101; x < 110; x++) expect(lobbyTiles.has(x)).toBe(true);
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
  });

  it("express shafts are written to LATER slots than the rest (the desync workaround)", () => {
    // The retail game loses every shaft written after an express slot, so the
    // exporter orders express last. Nothing else pins that, and losing it
    // silently re-breaks every exported tower that has an express.
    const save = sampleSave();
    const mk = (kind: FacilityKind, x: number, bottom: number, top: number): Transport => ({
      id: 300 + x, kind, x, width: kind === "elevatorExpress" ? 8 : 4, bottom, top,
      cars: 2, carPositions: [bottom, bottom], carDir: [0, 0], load: 0,
    });
    save.transports.push(mk("elevatorExpress", 60, 1, 30));
    save.transports.push(mk("elevatorStandard", 80, 1, 12));
    save.transports.push(mk("elevatorService", 90, 1, 12));
    const decoded = parseTdtBinary(buildTDT(save).bytes).elevators!;
    const expressSlot = decoded.findIndex((e) => e.x === 60);
    expect(expressSlot).toBeGreaterThanOrEqual(0);
    for (const other of [80, 90]) {
      const slot = decoded.findIndex((e) => e.x === other);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(expressSlot);
    }
  });

  it("the 24-slot cap drops by tower order, so the express workaround cannot eat the express", () => {
    // Truncation must run BEFORE the express reordering: sorting first would
    // push express shafts into the dropped tail, so a full tower would silently
    // lose its whole-tower transport instead of the shaft it actually built last.
    const save = sampleSave();
    save.transports = [];
    save.transports.push({
      id: 400, kind: "elevatorExpress" as FacilityKind, x: 40, width: 8, bottom: 1, top: 30,
      cars: 2, carPositions: [1, 1], carDir: [0, 0], load: 0,
    });
    for (let i = 0; i < 30; i++) {
      save.transports.push({
        id: 500 + i, kind: "elevatorStandard" as FacilityKind, x: 60 + i * 5, width: 4, bottom: 1, top: 12,
        cars: 1, carPositions: [1], carDir: [0], load: 0,
      });
    }
    const decoded = parseTdtBinary(buildTDT(save).bytes).elevators!;
    expect(decoded.length).toBe(24);
    expect(decoded.some((e) => e.x === 40)).toBe(true); // the express survived the cap
    expect(decoded[decoded.length - 1].x).toBe(40); // and still sits last
  });

  it("a burned MULTI-STORY unit leaves every one of its rows paved", () => {
    // A gutted 2-story facility claims extent on both rows while emitting no
    // record on either. Only the paving pass fills them, and the single-floor
    // office tests cannot reach the upper row.
    const save = sampleSave();
    for (const floor of [11, 12]) save.units = save.units.filter((u) => u.floor !== floor);
    save.units.push(unit({ id: 9_403, kind: "cinema", floor: 11, x: 100, width: 31, state: "gutted" }));
    const { bytes } = buildTDT(save);
    for (const floor of [11, 12]) {
      const paved = new Set<number>();
      for (const r of recordSpans(bytes, floor + TDT_FLOOR_OFFSET)) {
        if (r.type !== 0 && r.type !== 24) continue;
        for (let x = r.left; x < r.right; x++) paved.add(x);
      }
      for (let x = 100; x < 131; x++) expect(paved.has(x)).toBe(true);
    }
    expect(parseTdtBinary(bytes).warnings).toEqual([]);
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

// The 1994 game paves each floor with type-24 (lobby) and type-0 (empty floor)
// unit records; without them an exported tower shows the city backdrop through
// floor 1 and every sky lobby, and elevators cannot connect. These pin that the
// exporter now emits those records: one coalesced span per contiguous run, only
// where a tile is not under a room, matching a real save's bytes.
describe("buildTDT: lobby (type 24) and empty-floor (type 0) paving records", () => {
  const u16 = (b: Uint8Array, off: number) => b[off] | (b[off + 1] << 8);
  const i8 = (b: number) => (b << 24) >> 24;

  interface FloorTenant {
    left: number;
    right: number;
    type: number;
    status: number;
    rentClass: number;
    subtype: number;
  }
  /** Walk the 120-record floor map and return the tenant records at a TDT index. */
  function floorTenants(b: Uint8Array, tdtIndex: number): FloorTenant[] {
    let o = 0x230;
    for (let i = 0; i < 120; i++) {
      const count = u16(b, o);
      const recStart = o + 6;
      if (i === tdtIndex) {
        const out: FloorTenant[] = [];
        for (let r = 0; r < count; r++) {
          const rec = recStart + r * 18;
          out.push({
            left: u16(b, rec),
            right: u16(b, rec + 2),
            type: i8(b[rec + 4]),
            status: b[rec + 5],
            rentClass: b[rec + 16],
            subtype: b[rec + 17],
          });
        }
        return out;
      }
      o = recStart + count * 18 + 94 * 2;
    }
    return [];
  }

  const tower = (units: Unit[]): SerializedGame => ({
    version: SAVE_VERSION,
    seed: 1,
    money: 2_000_000,
    star: 2,
    minutes: 7 * 60,
    mode: "classic",
    units,
    transports: [],
    nextId: units.length + 1,
    towerName: "Paving",
    builtWeddingHall: false,
    evaluatedTower: false,
  });

  /** A tower whose paving mirrors an imported/real save: width-1 floor/lobby
   *  tiles across the full extent of every floor (INCLUDING under rooms), a
   *  ground lobby, a sky lobby on floor 15, and two rooms on floor 2 split by a
   *  two-tile empty paved gap. */
  function pavedTower(): SerializedGame {
    const units: Unit[] = [];
    let id = 1;
    const paveRow = (kind: "floor" | "lobby", floor: number, from: number, to: number) => {
      for (let x = from; x < to; x++) units.push(unit({ id: id++, kind, floor, x, width: 1 }));
    };
    // Ground lobby: contiguous lobby run [0, 10) on floor 1.
    paveRow("lobby", 1, 0, 10);
    // Sky lobby: contiguous lobby run [0, 10) on floor 15 (a lobby floor).
    paveRow("lobby", 15, 0, 10);
    // Floor 2: two office rooms [0,9) and [11,20) with an empty paved gap [9,11).
    // Paving spans the whole extent [0, 20), under the rooms too, exactly as a
    // re-imported tower is laid out.
    paveRow("floor", 2, 0, 20);
    units.push(unit({ id: id++, kind: "office", floor: 2, x: 0, width: 9, state: "occupied" }));
    units.push(unit({ id: id++, kind: "office", floor: 2, x: 11, width: 9, state: "occupied" }));
    return tower(units);
  }

  it("emits a single type-24 span for the ground lobby run (status 0, rentClass 4)", () => {
    const { bytes } = buildTDT(pavedTower());
    const ground = floorTenants(bytes, 1 + 9); // our floor 1 -> TDT index 10
    expect(ground).toEqual([{ left: 0, right: 10, type: 24, status: 0, rentClass: 4, subtype: 0 }]);
  });

  it("emits a type-24 span for the sky lobby on floor 15", () => {
    const { bytes } = buildTDT(pavedTower());
    const sky = floorTenants(bytes, 15 + 9); // our floor 15 -> TDT index 24
    const lobbies = sky.filter((t) => t.type === 24);
    expect(lobbies).toEqual([{ left: 0, right: 10, type: 24, status: 0, rentClass: 4, subtype: 0 }]);
  });

  it("emits a type-0 span for each empty paved gap, and none under a room", () => {
    const { bytes } = buildTDT(pavedTower());
    const floor2 = floorTenants(bytes, 2 + 9); // our floor 2 -> TDT index 11
    const floorGaps = floor2.filter((t) => t.type === 0);
    // Exactly one gap record spanning [9, 11); no type-0 under either office.
    expect(floorGaps).toEqual([{ left: 9, right: 11, type: 0, status: 2, rentClass: 4, subtype: 0 }]);
    // The two office ROOM records use the same exclusive-`right` (x + width)
    // convention as the paving spans: [0, 9) and [11, 20).
    const offices = floor2.filter((t) => t.type === 7).map((t) => [t.left, t.right]);
    expect(offices).toEqual([
      [0, 9],
      [11, 20],
    ]);
  });

  it("raises zero importer warnings and re-exports byte-identically", () => {
    const first = buildTDT(pavedTower()).bytes;
    expect(parseTdtBinary(first).warnings).toEqual([]);
    const again = buildTDT(parseTDT(first.buffer as ArrayBuffer, "P.TDT").save).bytes;
    expect(again).toEqual(first);
  });

  it("splits a lobby run broken by a room into one type-24 span per sub-run", () => {
    // A room sits mid-lobby on floor 1: the lobby paving [0, 20) is split into
    // [0, 6) and [10, 20) around the room's footprint [6, 10).
    const units: Unit[] = [];
    let id = 1;
    for (let x = 0; x < 20; x++) units.push(unit({ id: id++, kind: "lobby", floor: 1, x, width: 1 }));
    units.push(unit({ id: id++, kind: "security", floor: 1, x: 6, width: 4 }));
    const { bytes } = buildTDT(tower(units));
    const ground = floorTenants(bytes, 1 + 9).filter((t) => t.type === 24);
    expect(ground).toEqual([
      { left: 0, right: 6, type: 24, status: 0, rentClass: 4, subtype: 0 },
      { left: 10, right: 20, type: 24, status: 0, rentClass: 4, subtype: 0 },
    ]);
  });

  it("paves a gutted/burning lobby tile as an ordinary type-24 lobby (state drops on the round trip)", () => {
    // A gutted lobby cannot occur in real play: EventSystem.flammableUnits
    // excludes floor and lobby, so fire never touches a lobby. This only guards
    // hand-forged input, which buildTDT accepts. The importer paves the whole
    // extent and rebuilds each tile's kind from the floor (isLobbyFloor), with no
    // notion of a gutted tile: the gutted STATE is lost on the paving round trip,
    // like every state. So the run is NOT split, and re-export must be byte-identical.
    const units: Unit[] = [];
    let id = 1;
    for (let x = 0; x < 10; x++) {
      const state = x === 4 || x === 5 ? "gutted" : "empty";
      units.push(unit({ id: id++, kind: "lobby", floor: 1, x, width: 1, state }));
    }
    const first = buildTDT(tower(units)).bytes;
    const ground = floorTenants(first, 1 + 9).filter((t) => t.type === 24);
    expect(ground).toEqual([{ left: 0, right: 10, type: 24, status: 0, rentClass: 4, subtype: 0 }]);
    // The gutted-tile save still round-trips byte-identically and warning-free.
    expect(parseTdtBinary(first).warnings).toEqual([]);
    const again = buildTDT(parseTDT(first.buffer as ArrayBuffer, "G.TDT").save).bytes;
    expect(again).toEqual(first);
  });

  // The regression the adversarial review hit: earlier code coalesced the
  // ACTUAL paved tiles (with gaps) and derived kind from each unit, so a tower
  // with an unpaved corridor gap, a laterally-separated room, or a lobby tile
  // on the "wrong" floor failed byte-identity, because the importer paves the
  // WHOLE extent as one block and reconstructs kind from isLobbyFloor. A
  // hand-built (non-import-normalized) save is the only thing that exposes it:
  // an import-normalized fixture is already a fixed point.
  it("a non-normalized tower (unpaved gaps, separated runs) round-trips byte-identically", () => {
    const units: Unit[] = [];
    let id = 1;
    // Floor 3: floor paving only on [0, 5), plus an office at [20, 29). The
    // extent is [0, 29); the importer bridges the unpaved [5, 20) into one block
    // and re-export must coalesce the same [0, 20) span (minus the room).
    for (let x = 0; x < 5; x++) units.push(unit({ id: id++, kind: "floor", floor: 3, x, width: 1 }));
    units.push(unit({ id: id++, kind: "office", floor: 3, x: 20, width: 9, state: "occupied" }));
    // Floor 4: two laterally-separated corridor runs [0, 5) and [10, 15). The
    // importer paves the whole extent [0, 15) as one block.
    for (let x = 0; x < 5; x++) units.push(unit({ id: id++, kind: "floor", floor: 4, x, width: 1 }));
    for (let x = 10; x < 15; x++) units.push(unit({ id: id++, kind: "floor", floor: 4, x, width: 1 }));
    // A sky lobby confirms type-24 paving survives the same round trip.
    for (let x = 0; x < 8; x++) units.push(unit({ id: id++, kind: "lobby", floor: 15, x, width: 1 }));
    const save = tower(units);

    const first = buildTDT(save).bytes;
    expect(parseTdtBinary(first).warnings).toEqual([]);
    const reimported = parseTDT(first.buffer as ArrayBuffer, "N.TDT").save;
    const again = buildTDT(reimported).bytes;
    expect(again).toEqual(first);

    // After the round trip the type-0 spans match the importer's post-import
    // shape: the whole extent minus the room footprint, not the original tiles.
    const floor3 = floorTenants(first, 3 + 9);
    expect(floor3.filter((t) => t.type === 0)).toEqual([
      { left: 0, right: 20, type: 0, status: 2, rentClass: 4, subtype: 0 },
    ]);
    expect(floor3.filter((t) => t.type === 7).map((t) => [t.left, t.right])).toEqual([[20, 29]]);
    const floor4 = floorTenants(first, 4 + 9);
    expect(floor4.filter((t) => t.type === 0)).toEqual([
      { left: 0, right: 15, type: 0, status: 2, rentClass: 4, subtype: 0 },
    ]);
    const sky = floorTenants(first, 15 + 9);
    expect(sky.filter((t) => t.type === 24)).toEqual([
      { left: 0, right: 8, type: 24, status: 0, rentClass: 4, subtype: 0 },
    ]);
  });

  it("a forged floor width (Infinity) can't hang the export, and paving stays within the grid", () => {
    // floor/lobby units arrive unclamped from serialized input; a forged width
    // widens the extent to Infinity. The paving loop must clamp to finite tiles
    // in [0, GRID.width] and return promptly, not spin forever.
    const started = Date.now();
    const { bytes } = buildTDT(
      tower([
        unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
        unit({ id: 2, kind: "floor", floor: 2, x: 0, width: Number.POSITIVE_INFINITY }),
      ]),
    );
    expect(Date.now() - started).toBeLessThan(2000);
    // No emitted record on any floor extends past the grid's right edge.
    for (let idx = 0; idx < 120; idx++) {
      for (const t of floorTenants(bytes, idx)) {
        expect(t.right).toBeLessThanOrEqual(GRID.width);
        expect(t.left).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("a multi-story unit's part records are never overlapped by a paving span", () => {
    // A Wedding Hall crowns floor 100 as a 5-part cathedral (PART_STACKS emits
    // types 36..40 DOWNWARD onto floors 96-100), yet facilityFloors(weddingHall)
    // is 1. So the old input-footprint coverage marked only floor 100 and let a
    // paving span overlap the parts on floors 96-99. Coverage is now rebuilt
    // from the EMITTED records, so no type-0/24 span overlaps a part on ANY of
    // the five floors, and the tower round-trips byte-identically.
    const units: Unit[] = [];
    let id = 1;
    // Full-extent paving on floors 96-100 (under the cathedral too), plus gaps.
    for (let fl = 96; fl <= 100; fl++) {
      for (let x = 0; x < 40; x++) units.push(unit({ id: id++, kind: "floor", floor: fl, x, width: 1 }));
    }
    units.push(unit({ id: id++, kind: "weddingHall", floor: 100, x: 5, width: 16 })); // parts cover [5, 21)
    const save = tower(units);
    const { bytes } = buildTDT(save);

    // Each of floors 96-100 carries one cathedral part (types 36..40); assert no
    // type-0 span overlaps the part's [5, 21) footprint on any of them.
    const cathedralIds = new Set([36, 37, 38, 39, 40]);
    for (let ourFloor = 96; ourFloor <= 100; ourFloor++) {
      const recs = floorTenants(bytes, ourFloor + 9);
      const parts = recs.filter((t) => cathedralIds.has(Math.abs(t.type)));
      expect(parts.length, `cathedral part on floor ${ourFloor}`).toBe(1);
      const paving = recs.filter((t) => t.type === 0 || t.type === 24);
      for (const p of parts) {
        for (const s of paving) {
          const overlaps = s.left < p.right && p.left < s.right;
          expect(
            overlaps,
            `span [${s.left},${s.right}) overlaps part [${p.left},${p.right}) on floor ${ourFloor}`,
          ).toBe(false);
        }
      }
    }

    expect(parseTdtBinary(bytes).warnings).toEqual([]);
    const again = buildTDT(parseTDT(bytes.buffer as ArrayBuffer, "C.TDT").save).bytes;
    expect(again).toEqual(bytes);
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
    expect(classFromRent("security", 123)).toBe(4); // unpriced kind = No Rate (class 4), per real saves
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

  it("vacant commercial units contribute 0 to the census (the honest occupied count)", () => {
    // Vacant units (state: empty) are not present; residentCount is never called
    // for them. The census is the ACTUAL occupied population, so an all-vacant
    // tower writes 0, NOT the catalog population and NOT a room-count floor (an
    // earlier version floored at counts.rooms on the disproven belief a zero
    // people block faults; a truly-empty tower loads fine at Pop 0). Such an
    // all-vacant-rooms tower still renders black in the real game, but that is a
    // separate game-side limitation (#510), independent of this count.
    const { bytes } = buildTDT(
      tower([
        unit({ id: 1, kind: "lobby", floor: 1, x: 0, width: 1 }),
        unit({ id: 2, kind: "shop", floor: 2, x: 0, width: 12, state: "empty" }),
        unit({ id: 3, kind: "restaurant", floor: 3, x: 0, width: 24, state: "empty" }),
      ]),
    );
    expect(u32(bytes, peopleOffset(bytes))).toBe(0);
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
