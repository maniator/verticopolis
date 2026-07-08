import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { ECON } from "../engine/econConfig";
import { FACILITIES, GRID, MAX_CARS, maxSpanFor } from "../engine/facilities";
import { SAVE_VERSION } from "../engine/saveMigration";
import type { FacilityKind, SerializedGame, Transport } from "../engine/types";
import {
  TDT_HEADER_SIZE,
  TDT_MAX_FILE_BYTES,
  parseTdtBinary,
} from "../storage/tdtFormat";
import {
  LegacyImportError,
  looksLikeLegacyTower,
  parseTDT,
  rentFromClass,
  synthesizeTransports,
  towerNameFromFilename,
} from "../storage/tdtImport";
import type { TdtSpec } from "./fixtures/tdtBuilder";
import { buildTdt, sampleTowerSpec } from "./fixtures/tdtBuilder";

/** Parse a spec through the whole importer (builder → parseTDT). */
function parse(spec: TdtSpec = {}, filename = "TOWER.TDT") {
  const bytes = buildTdt(spec);
  return parseTDT(bytes.buffer as ArrayBuffer, filename);
}

/** The room units of a parse (paving and structure filtered out). */
function rooms(spec: TdtSpec) {
  return parse(spec).save.units.filter((u) => u.kind !== "floor" && u.kind !== "lobby");
}

/** Tenant IDs whose kinds are basement-only in our engine (and the original):
 *  parking stall/ramp, recycling parts, metro parts. */
const BASEMENT_ONLY_IDS = new Set([11, 44, 20, 21, 31, 32, 33]);

/** Cathedral part IDs: their stand-in Wedding Hall must crown floor 100. */
const CATHEDRAL_IDS = new Set([36, 37, 38, 39, 40]);

/** One tenant of the given type on TDT floor 20 (our floor 11); basement-only
 *  kinds go to TDT floor 6 (our floor B4, so even the metro's three stories
 *  stay below ground) and Cathedral parts to TDT 109 (our floor 100, the
 *  crown). */
function oneTenant(type: number, left = 100, right = 109, status = 0): TdtSpec {
  const id = Math.abs(type);
  const index = BASEMENT_ONLY_IDS.has(id) ? 6 : CATHEDRAL_IDS.has(id) ? 109 : 20;
  return { floors: [{ index, tenants: [{ left, right, type, status }] }] };
}

describe("tdtFormat: hostile-file hardening (typed errors, never hangs)", () => {
  it("rejects a wrong magic word as not-a-SimTower-save", () => {
    expect(() => parse({ magic: 0x1234 })).toThrow(LegacyImportError);
    expect(() => parse({ magic: 0x1234 })).toThrow(/doesn't look like a SimTower save/);
  });

  it("rejects too-small and too-large files with player-readable messages", () => {
    expect(() => parseTDT(new ArrayBuffer(8), "TOWER.TDT")).toThrow(/too small/);
    expect(() => parseTdtBinary(new Uint8Array(TDT_MAX_FILE_BYTES + 1))).toThrow(/too large/);
  });

  it("truncation mid-floor-map throws a typed 'cut short' error", () => {
    const spec = { ...sampleTowerSpec(), truncateAt: TDT_HEADER_SIZE + 194 * 3 + 10 };
    expect(() => parse(spec)).toThrow(LegacyImportError);
    expect(() => parse(spec)).toThrow(/cut short/);
  });

  it("an absurd per-floor tenant count fails BEFORE any loop", () => {
    expect(() => parse({ floors: [{ index: 10, forgeTenantCount: 257 }] })).toThrow(/corrupt/);
    // A count under the cap but past the file's end is a truncation, not a hang.
    expect(() =>
      parse({ floors: [{ index: 119, forgeTenantCount: 250 }], peopleCount: 0, includeRetail: false }),
    ).toThrow(/cut short/);
  });

  it("an absurd people count downgrades to a warning (the tail is tolerant)", () => {
    const bytes = buildTdt({ includeRetail: false });
    bytes.set([0xff, 0xff, 0xff, 0xff], bytes.length - 4); // forge people = 4 billion
    const tdt = parseTdtBinary(bytes);
    expect(tdt.peopleCount).toBeNull();
    expect(tdt.warnings.join(" ")).toMatch(/head count/);
  });

  it("a missing retail table is a warning, not a failure; and transports go unread", () => {
    const tdt = parseTdtBinary(buildTdt({ includeRetail: false }));
    expect(tdt.retailRows).toBeNull();
    expect(tdt.elevators).toBeNull();
    expect(tdt.stairs).toBeNull();
    expect(tdt.warnings.length).toBeGreaterThan(0);
  });

  it("reads the retail table's occupied rows when present", () => {
    const tdt = parseTdtBinary(buildTdt({ retailRows: 7 }));
    expect(tdt.retailRows).toBe(7);
    expect(tdt.warnings).toEqual([]);
  });

  it("a malformed elevator entry abandons the decode instead of misaligning", () => {
    const spec = sampleTowerSpec();
    spec.elevators = [{ type: 1, cars: 2, x: 150, bottomFloor: 9, topFloor: 14 }];
    const bytes = buildTdt(spec);
    // Corrupt the shaft's car count to 200: the payload size becomes a guess,
    // so the walker must bail to the synthesis fallback, not read garbage.
    const tdt = parseTdtBinary(bytes);
    expect(tdt.elevators).toHaveLength(1); // sanity: pristine file decodes
    const carCountOffset = findElevatorTableOffset(bytes) + 3;
    bytes[carCountOffset] = 200;
    const corrupt = parseTdtBinary(bytes);
    expect(corrupt.elevators).toBeNull();
    expect(corrupt.warnings.join(" ")).toMatch(/elevator table/);
  });

  it("fuzz-lite: seeded random byte-flips either import or throw LegacyImportError", () => {
    const pristine = buildTdt(sampleTowerSpec());
    // Tiny deterministic LCG; no Math.random, so a failure reproduces exactly.
    let s = 0xc0ffee;
    const rnd = (n: number) => {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      return s % n;
    };
    for (let round = 0; round < 60; round++) {
      const bytes = pristine.slice();
      const flips = 1 + rnd(3);
      for (let f = 0; f < flips; f++) bytes[rnd(bytes.length)] ^= 1 << rnd(8);
      // Parse inside the try, deserialize OUTSIDE it; a deserialize failure
      // must surface its own error, not be re-asserted as a LegacyImportError.
      let save: SerializedGame | null = null;
      try {
        save = parseTDT(bytes.buffer as ArrayBuffer, "FUZZ.TDT").save;
      } catch (err) {
        expect(err).toBeInstanceOf(LegacyImportError);
      }
      // A surviving parse must still deserialize; the second hardening layer.
      if (save) Simulation.deserialize(save);
    }
  });
});

/** Byte offset of the elevator table in a built buffer (header + floor map +
 *  people + retail), derived from the same builder spec conventions. */
function findElevatorTableOffset(bytes: Uint8Array): number {
  // Walk the same structure the parser does, minimally.
  let pos = TDT_HEADER_SIZE;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let f = 0; f < 120; f++) {
    const count = view.getUint16(pos, true);
    pos += 6 + count * 18 + 188;
  }
  const people = view.getUint32(pos, true);
  pos += 4 + people * 16;
  pos += 512 * 18;
  return pos;
}

describe("parseTDT: golden mappings", () => {
  it("money is stored ×1/100: balance 20000 → $2,000,000 (negative survives)", () => {
    expect(parse({ balance: 20000 }).save.money).toBe(2_000_000);
    expect(parse({ balance: -500 }).save.money).toBe(-50_000);
  });

  it("the report writes negative funds minus-first, matching the stats panel", () => {
    expect(parse({ balance: -500 }).report.broughtOver.join(" ")).toContain("-$50,000 in funds");
    expect(parse({ balance: 20000 }).report.broughtOver.join(" ")).toContain(
      "$2,000,000 in funds",
    );
  });

  it("tick 0 lands on 7:00 AM of the header's day", () => {
    expect(parse({ frameTime: 0, currentDay: 0 }).save.minutes).toBe(7 * 60);
    expect(parse({ frameTime: 0, currentDay: 2 }).save.minutes).toBe(2 * 1440 + 7 * 60);
  });

  it("tick 2300 is midnight; the small hours belong to currentDay itself", () => {
    // The original changes the date AT tick 2300, so day 5 tick 2300 is
    // 00:00 of day 5, not day 6.
    expect(parse({ frameTime: 2300, currentDay: 5 }).save.minutes).toBe(5 * 1440);
    // The last night tick still sits before 7:00 of the same day.
    const lastFrame = parse({ frameTime: 2599, currentDay: 5 }).save.minutes;
    expect(lastFrame).toBeGreaterThan(5 * 1440);
    expect(lastFrame).toBeLessThan(5 * 1440 + 7 * 60);
  });

  it("a negative (signed) currentDay clamps to day 0; and the report says so", () => {
    const { save, report } = parse({ currentDay: -12 });
    expect(save.minutes).toBe(7 * 60);
    expect(report.couldNotBring.join(" ")).toMatch(/day counter was negative/);
  });

  it("out-of-range header fields are clamped WITH a report line, never silently", () => {
    const clock = parse({ frameTime: 60_000 });
    expect(Number.isFinite(clock.save.minutes)).toBe(true);
    expect(clock.report.couldNotBring.join(" ")).toMatch(/clock was out of range/);
    expect(parse({ level: 0 }).report.couldNotBring.join(" ")).toMatch(/star rating \(0\)/);
    // In-range values earn no such note.
    expect(parse({ frameTime: 2599, level: 3, currentDay: 4 }).report.couldNotBring.join(" ")).not.toMatch(
      /out of range|was negative/,
    );
  });

  it("floor offsets: TDT 0→B10, 9→B1, 10→ground, 109→100F; reserved rows ≥110 dropped with a report", () => {
    // Shops carry the basement rows (offices can't exist underground) and an
    // office carries the top; the ground concourse hosts lobby paving only.
    const at = (index: number, type: number) =>
      rooms({ floors: [{ index, tenants: [{ left: 100, right: 109, type }] }] });
    expect(at(0, 10)[0].floor).toBe(-9);
    expect(at(9, 10)[0].floor).toBe(0);
    const ground = parse({ floors: [{ index: 10, tenants: [{ left: 100, right: 109, type: 24 }] }] });
    expect(ground.save.units.some((u) => u.kind === "lobby" && u.floor === 1)).toBe(true);
    expect(at(109, 7)[0].floor).toBe(100);

    const dropped = parse({ floors: [{ index: 110, tenants: [{ left: 100, right: 109, type: 7 }] }] });
    expect(dropped.save.units).toHaveLength(0);
    expect(dropped.report.couldNotBring.join(" ")).toMatch(/reserved floor row/);
  });

  const SINGLE_MAPPINGS: [number, FacilityKind][] = [
    [3, "hotelSingle"],
    [4, "hotelDouble"],
    [5, "hotelSuite"],
    [6, "restaurant"],
    [7, "office"],
    [9, "condo"],
    [10, "shop"],
    [11, "parking"],
    [12, "fastFood"],
    [13, "medical"],
    [14, "security"],
    [15, "housekeeping"],
    [17, "security"],
    [44, "parkingRamp"],
  ];
  it.each(SINGLE_MAPPINGS)("tenant ID %i imports as %s", (id, kind) => {
    const got = rooms(oneTenant(id));
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe(kind);
  });

  const PART_MAPPINGS: [number, FacilityKind][] = [
    [18, "cinema"],
    [19, "cinema"],
    [34, "cinema"],
    [35, "cinema"],
    [20, "recycling"],
    [21, "recycling"],
    [29, "partyHall"],
    [30, "partyHall"],
    [31, "metro"],
    [32, "metro"],
    [33, "metro"],
    [36, "weddingHall"],
    [40, "weddingHall"],
  ];
  it.each(PART_MAPPINGS)("multi-story part ID %i imports (merged) as %s", (id, kind) => {
    const got = rooms(oneTenant(id));
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe(kind);
  });

  it("a metro tunnel (ID 45) alone is scenery: paved, never a unit", () => {
    const { save } = parse(oneTenant(45));
    expect(save.units.every((u) => u.kind === "floor")).toBe(true);
  });

  it("a whole theatre (halves + screen halves) merges into ONE cinema", () => {
    const { save } = parse({
      floors: [
        // Bottom story: hall + adjacent screen; top story: their upper halves.
        { index: 20, tenants: [{ left: 100, right: 127, type: 19 }, { left: 127, right: 131, type: 35 }] },
        { index: 21, tenants: [{ left: 100, right: 127, type: 18 }, { left: 127, right: 131, type: 34 }] },
      ],
    });
    const cinemas = save.units.filter((u) => u.kind === "cinema");
    expect(cinemas).toHaveLength(1);
    expect(cinemas[0].floor).toBe(11); // anchored at the bottom story
    expect(cinemas[0].x).toBe(100);
    expect(cinemas[0].width).toBe(31); // the horizontal union, the catalog width
  });

  it("the Cathedral's five stacked parts merge into ONE Wedding Hall at the base", () => {
    const { save, report } = parse({
      floors: Array.from({ length: 5 }, (_, i) => ({
        index: 105 + i, // ours 96..100
        tenants: [{ left: 180, right: 196, type: 36 + i }],
      })),
    });
    const halls = save.units.filter((u) => u.kind === "weddingHall");
    expect(halls).toHaveLength(1);
    expect(halls[0].floor).toBe(100); // the hall CROWNS the cathedral, canon floor 100
    expect(save.builtWeddingHall).toBe(true);
    expect(report.couldNotBring.join(" ")).toMatch(/Wedding Hall/);
  });

  it("two same-kind buildings on far-apart floors stay TWO units (merge is floor-aware)", () => {
    const { save } = parse({
      floors: [
        { index: 3, tenants: [{ left: 100, right: 120, type: 21 }] }, // recycling bottom, ours B7
        { index: 4, tenants: [{ left: 100, right: 120, type: 20 }] }, // its top, ours B6
        { index: 6, tenants: [{ left: 100, right: 120, type: 21 }] }, // a second center, ours B4
        { index: 7, tenants: [{ left: 100, right: 120, type: 20 }] },
      ],
    });
    const centers = save.units.filter((u) => u.kind === "recycling");
    expect(centers).toHaveLength(2);
    expect(centers.map((u) => u.floor).sort((a, b) => a - b)).toEqual([-6, -3]);
  });

  it("two same-kind buildings built flush on the same floor stay TWO units (touch never merges)", () => {
    const { save } = parse({
      floors: [
        {
          index: 5,
          tenants: [
            { left: 100, right: 120, type: 21 },
            { left: 120, right: 140, type: 21 }, // flush neighbor, half-open touch
          ],
        },
      ],
    });
    const centers = save.units.filter((u) => u.kind === "recycling");
    expect(centers).toHaveLength(2);
    expect(centers.map((u) => u.x).sort((a, b) => a - b)).toEqual([100, 120]);
  });

  it("a merged unit claims EVERY story: a room on its upper floor blocks it", () => {
    const { save, report } = parse({
      floors: [
        { index: 20, tenants: [{ left: 100, right: 131, type: 19 }] }, // cinema bottom, ours 11
        { index: 21, tenants: [{ left: 100, right: 109, type: 7 }] }, // office on ours 12, same tiles
      ],
    });
    expect(save.units.filter((u) => u.kind === "office")).toHaveLength(1); // walked first, kept
    expect(save.units.filter((u) => u.kind === "cinema")).toHaveLength(0); // upper story collides
    expect(report.couldNotBring.join(" ")).toMatch(/overlapped another room/);
  });

  it("a multi-story footprint poking past floor 100 is rejected, not clamped onto a neighbor", () => {
    const { save } = parse({
      floors: [
        // Cinema bottom part at ours 100: its second story would sit at 101,
        // and deserialize would clamp the unit down onto floor 99.
        { index: 109, tenants: [{ left: 100, right: 131, type: 19 }] },
        // A legitimate office on floor 99 at the same tiles must stay safe.
        { index: 108, tenants: [{ left: 100, right: 109, type: 7 }] },
      ],
    });
    expect(save.units.filter((u) => u.kind === "cinema")).toHaveLength(0);
    expect(save.units.filter((u) => u.kind === "office")).toHaveLength(1);
  });

  it("basement-only kinds on above-ground floors are dropped with a report line", () => {
    // Parking stall + ramp forged onto our floor 11: functional above-ground
    // parking would bypass Tower.roomPlacementReason's basement rule.
    const { save, report } = parse({
      floors: [{ index: 20, tenants: [{ left: 100, right: 116, type: 44 }, { left: 116, right: 120, type: 11 }] }],
    });
    expect(save.units.filter((u) => u.kind === "parking" || u.kind === "parkingRamp")).toHaveLength(0);
    expect(report.couldNotBring.join(" ")).toMatch(/floor its kind can't occupy/);
    // Same guard on the merged path: recycling forged above ground.
    const merged = parse({
      floors: [
        { index: 20, tenants: [{ left: 100, right: 120, type: 21 }] },
        { index: 21, tenants: [{ left: 100, right: 120, type: 20 }] },
      ],
    });
    expect(merged.save.units.filter((u) => u.kind === "recycling")).toHaveLength(0);
  });

  it("an off-crown Cathedral cluster is dropped: the Wedding Hall crowns floor 100 only", () => {
    // Parts ending at ours 95 (TDT 100..104): corrupt or hand-edited data;
    // a real winning save's Cathedral always tops out at floor 100.
    const { save, report } = parse({
      floors: Array.from({ length: 5 }, (_, i) => ({
        index: 100 + i,
        tenants: [{ left: 180, right: 196, type: 36 + i }],
      })),
    });
    expect(save.units.filter((u) => u.kind === "weddingHall")).toHaveLength(0);
    expect(save.builtWeddingHall).toBe(false);
    expect(save.vipVisitDay).toBe(-1);
    expect(report.couldNotBring.join(" ")).toMatch(/floor its kind can't occupy/);
  });

  it("imported basements seed the excavation history (no re-farmed treasure)", () => {
    const { save } = parse({
      // A stall on B1 (TDT 9 = ours 0) and an office upstairs.
      floors: [
        { index: 9, tenants: [{ left: 100, right: 104, type: 11 }] },
        { index: 20, tenants: [{ left: 100, right: 109, type: 7 }] },
      ],
    });
    expect(save.excavated).toContain("0:100");
    expect(save.excavated).toContain("0:103");
    // Above-ground tiles are never "excavated".
    expect(save.excavated!.every((k) => Number(k.split(":")[0]) <= 0)).toBe(true);
  });

  it("daylight kinds in the basement, and rooms covering the ground concourse, are dropped", () => {
    // Office forged onto B4 (TDT 6): people don't work underground.
    const office = parse({ floors: [{ index: 6, tenants: [{ left: 100, right: 109, type: 7 }] }] });
    expect(office.save.units.filter((u) => u.kind === "office")).toHaveLength(0);
    // Fast food forged onto the ground concourse (TDT 10 = our floor 1).
    const ground = parse({ floors: [{ index: 10, tenants: [{ left: 100, right: 116, type: 12 }] }] });
    expect(ground.save.units.filter((u) => u.kind === "fastFood")).toHaveLength(0);
    expect(ground.report.couldNotBring.join(" ")).toMatch(/floor its kind can't occupy/);
  });

  it("two same-kind buildings stacked on adjacent floor pairs stay TWO units", () => {
    const { save } = parse({
      floors: [
        { index: 3, tenants: [{ left: 100, right: 120, type: 21 }] }, // center A bottom, ours B7
        { index: 4, tenants: [{ left: 100, right: 120, type: 20 }] }, // center A top, ours B6
        { index: 5, tenants: [{ left: 100, right: 120, type: 21 }] }, // center B bottom, ours B5
        { index: 6, tenants: [{ left: 100, right: 120, type: 20 }] }, // center B top, ours B4
      ],
    });
    const centers = save.units.filter((u) => u.kind === "recycling");
    expect(centers).toHaveLength(2);
    expect(centers.map((u) => u.floor).sort((a, b) => a - b)).toEqual([-6, -4]);
  });

  it("an imported cathedral below TOWER seeds the pending VIP inspection", () => {
    const spec: TdtSpec = {
      level: 5,
      currentDay: 10,
      floors: Array.from({ length: 5 }, (_, i) => ({
        index: 105 + i,
        tenants: [{ left: 180, right: 196, type: 36 + i }],
      })),
    };
    const below = parse(spec).save;
    expect(below.builtWeddingHall).toBe(true);
    expect(below.vipVisitDay).toBe(13); // imported day + 3, like building the hall
    // A TOWER-rated save is already evaluated: no inspection to seed.
    const tower = parse({ ...spec, level: 6 }).save;
    expect(tower.vipVisitDay).toBe(-1);
    expect(tower.evaluatedTower).toBe(true);
    // No hall, no inspection.
    expect(parse({ level: 5 }).save.vipVisitDay).toBe(-1);
  });

  it("a metro station's three stories merge into ONE metro at the bottom", () => {
    const { save } = parse({
      floors: [
        { index: 0, tenants: [{ left: 0, right: 375, type: 33 }] },
        { index: 1, tenants: [{ left: 0, right: 375, type: 32 }] },
        { index: 2, tenants: [{ left: 0, right: 375, type: 31 }] },
      ],
    });
    const metros = save.units.filter((u) => u.kind === "metro");
    expect(metros).toHaveLength(1);
    expect(metros[0].floor).toBe(-9);
    expect(metros[0].width).toBe(375);
  });

  it("type 0 (floor) and 24 (lobby) pave structure instead of making rooms", () => {
    const paveOnly = parse({ floors: [{ index: 15, tenants: [{ left: 100, right: 120, type: 0 }] }] });
    expect(paveOnly.save.units.every((u) => u.kind === "floor")).toBe(true);
    expect(paveOnly.save.units).toHaveLength(20); // width-1 tiles, like in-game placement

    const ground = parse({ floors: [{ index: 10, tenants: [{ left: 100, right: 120, type: 24 }] }] });
    expect(ground.save.units.every((u) => u.kind === "lobby")).toBe(true); // ground is a lobby floor
  });

  it("sky-lobby floors pave as lobby; ordinary floors pave as floor", () => {
    // TDT 24 = our floor 15; a sky-lobby floor (the doc's lobby-table proof).
    const sky = parse({ floors: [{ index: 24, leftEdge: 100, rightEdge: 110 }] });
    expect(sky.save.units.every((u) => u.kind === "lobby")).toBe(true);
    const plain = parse({ floors: [{ index: 20, leftEdge: 100, rightEdge: 110 }] });
    expect(plain.save.units.every((u) => u.kind === "floor")).toBe(true);
  });

  it("type 48 (burned) clears to bare floor and reports it", () => {
    const { save, report } = parse({ floors: [{ index: 20, tenants: [{ left: 100, right: 110, type: 48 }] }] });
    expect(save.units.every((u) => u.kind === "floor")).toBe(true);
    expect(report.couldNotBring.join(" ")).toMatch(/burned/i);
  });

  it("unknown tenant types are dropped and counted in the report", () => {
    const { save, report } = parse(oneTenant(50));
    expect(save.units.filter((u) => u.kind !== "floor")).toHaveLength(0);
    expect(report.couldNotBring.join(" ")).toMatch(/don't recognize/);
  });

  it("a negative type imports as under-construction with a fresh finite completeAt", () => {
    const { save } = parse(oneTenant(-7));
    const office = save.units.find((u) => u.kind === "office")!;
    expect(office.state).toBe("construction");
    expect(Number.isFinite(office.completeAt)).toBe(true);
    expect(office.completeAt!).toBeGreaterThan(save.minutes);
  });

  it("occupancy heuristic: tenanted offices/condos import occupied", () => {
    const office = rooms(oneTenant(7, 100, 109, 1))[0];
    expect(office.state).toBe("occupied");
    expect(office.everOccupied).toBe(true);
    const vacantOffice = rooms(oneTenant(7, 100, 109, 0))[0];
    expect(vacantOffice.state).toBe("empty");
    expect(vacantOffice.everOccupied).toBe(false);
    expect(office.satisfaction).toBe(1);
  });

  it("hotel status flags: asleep guests, dirty rooms, and infested→dirty with a note", () => {
    // Default header clock is 7:00 AM (before checkout), so asleep survives.
    const asleep = rooms(oneTenant(3, 100, 104, 16 | 2))[0];
    expect(asleep.state).toBe("asleep");
    expect(asleep.occupants).toBe(2);
    expect(asleep.everOccupied).toBe(true);

    const dirty = rooms(oneTenant(3, 100, 104, 32))[0];
    expect(dirty.state).toBe("dirty");
    expect(dirty.everOccupied).toBe(true);

    const infested = parse(oneTenant(3, 100, 104, 64));
    expect(infested.save.units.find((u) => u.kind === "hotelSingle")!.state).toBe("dirty");
    expect(infested.report.couldNotBring.join(" ")).toMatch(/bug-infested/);

    const fresh = rooms(oneTenant(3, 100, 104, 0))[0];
    expect(fresh.state).toBe("empty");
    expect(fresh.everOccupied).toBe(false);
  });

  it("a booked room whose guests are out arrives empty but ever-booked, with a note", () => {
    const { save, report } = parse(oneTenant(3, 100, 104, 8));
    const room = save.units.find((u) => u.kind === "hotelSingle")!;
    expect(room.state).toBe("empty");
    expect(room.everOccupied).toBe(true);
    expect(report.couldNotBring.join(" ")).toMatch(/booked hotel room/);
  });

  it("guests asleep past the 8:00 checkout arrive as rooms awaiting housekeeping", () => {
    // Tick 800 is midday (12:30); the engine's next wake-up would be tomorrow.
    const { save, report } = parse({
      frameTime: 800,
      floors: [{ index: 20, tenants: [{ left: 100, right: 104, type: 3, status: 16 | 1 }] }],
    });
    const room = save.units.find((u) => u.kind === "hotelSingle")!;
    expect(room.state).toBe("dirty");
    expect(report.couldNotBring.join(" ")).toMatch(/asleep past checkout/);
  });

  it("rent classes map onto our price bands (min / low / default / max / no-rate)", () => {
    const band = ECON.rent.office;
    expect(rentFromClass("office", 0)).toBe(band.min);
    const low = rentFromClass("office", 1)!;
    expect(low).toBeGreaterThan(band.min);
    expect(low).toBeLessThan(band.default);
    expect((low - band.min) % band.step).toBe(0); // snapped to the band's grid
    expect(rentFromClass("office", 2)).toBeUndefined(); // Average = the default
    expect(rentFromClass("office", 3)).toBe(band.max);
    expect(rentFromClass("office", 4)).toBeUndefined(); // No Rate
    expect(rentFromClass("office", 99)).toBeUndefined(); // garbage
    expect(rentFromClass("shop", 3)).toBeUndefined(); // unpriced kind

    const highOffice = rooms({
      floors: [{ index: 20, tenants: [{ left: 100, right: 109, type: 7, rentRate: 3 }] }],
    })[0];
    expect(highOffice.rent).toBe(band.max);
  });

  it("geometry: x = left, width = right − left; recorded widths are kept and mismatches reported", () => {
    const odd = parse(oneTenant(7, 100, 112)); // 12 wide vs the catalog's 9
    const office = odd.save.units.find((u) => u.kind === "office")!;
    expect(office.x).toBe(100);
    expect(office.width).toBe(12);
    expect(odd.report.couldNotBring.join(" ")).toMatch(/original's size/);
  });

  it("overlapping tenant extents (corrupt file): the later room is dropped and reported", () => {
    const { save, report } = parse({
      floors: [
        {
          index: 20,
          tenants: [
            { left: 100, right: 109, type: 7 },
            { left: 105, right: 114, type: 7 }, // overlaps the first; corrupt
            { left: 114, right: 123, type: 7 }, // disjoint; kept
          ],
        },
      ],
    });
    const offices = save.units.filter((u) => u.kind === "office");
    expect(offices).toHaveLength(2);
    expect(offices.map((u) => u.x)).toEqual([100, 114]);
    expect(report.couldNotBring.join(" ")).toMatch(/overlapped another room/);
  });

  it("off-lot rooms: fully outside or degenerate → dropped; poking past the edge → clamped", () => {
    const { save, report } = parse({
      floors: [
        {
          index: 20,
          tenants: [
            { left: 400, right: 410, type: 7 }, // fully off the 375 lot
            { left: 110, right: 100, type: 7 }, // degenerate (right ≤ left)
            { left: 370, right: 380, type: 7 }, // pokes past → clamped to 370..375
          ],
        },
      ],
    });
    const offices = save.units.filter((u) => u.kind === "office");
    expect(offices).toHaveLength(1);
    expect(offices[0].x).toBe(370);
    expect(offices[0].width).toBe(5);
    expect(report.couldNotBring.join(" ")).toMatch(/outside the lot/);
    expect(report.couldNotBring.join(" ")).toMatch(/trimmed/);
  });

  it("star: level clamps to 1..6; TOWER (6) sets the evaluation and VIP flags", () => {
    expect(parse({ level: 0 }).save.star).toBe(1);
    expect(parse({ level: 9 }).save.star).toBe(6);
    const tower = parse({ level: 6 }).save;
    expect(tower.evaluatedTower).toBe(true);
    expect(tower.vipFavorable).toBe(true);
    const modest = parse({ level: 3 }).save;
    expect(modest.evaluatedTower).toBe(false);
    expect(modest.vipFavorable).toBe(false);
  });

  it("meta: classic mode, current schema version, filename-derived name, deterministic seed, sane nextId", () => {
    const a = parse(sampleTowerSpec(), "MY_TOWER.TDT");
    expect(a.save.mode).toBe("classic");
    expect(a.save.version).toBe(SAVE_VERSION);
    expect(a.save.towerName).toBe("MY TOWER");
    const b = parse(sampleTowerSpec(), "OTHER.TDT");
    expect(b.save.seed).toBe(a.save.seed); // same bytes → same seed
    expect(parse({ balance: 999 }).save.seed).not.toBe(a.save.seed);
    const maxId = Math.max(...a.save.units.map((u) => u.id), ...a.save.transports.map((t) => t.id));
    expect(a.save.nextId).toBe(maxId + 1);
  });

  it("report facts: name, star, funds, floors, day, and the always-present honesty lines", () => {
    const { report } = parse(sampleTowerSpec(), "GRAND.TDT");
    expect(report.towerName).toBe("GRAND");
    expect(report.star).toBe(2);
    expect(report.money).toBe(1_500_000);
    expect(report.floors).toBe(5);
    expect(report.basements).toBe(1);
    // 1-indexed, matching the "The clock: day N" line (currentDay 3 → day 4).
    expect(report.day).toBe(4);
    expect(report.broughtOver.join(" ")).toMatch(/day 4/);
    expect(report.unitsImported).toBeGreaterThan(0);
    expect(report.broughtOver.join(" ")).toMatch(/\$1,500,000/);
    // The transports came from the save; and the report says so.
    expect(report.broughtOver.join(" ")).toMatch(/straight from the save/);
    expect(report.couldNotBring.join(" ")).not.toMatch(/rebuilt from your floors/);
    expect(report.broughtOver.join(" ")).toMatch(/parking stall/);
    expect(report.broughtOver.join(" ")).toMatch(/Rent levels/);
    expect(report.couldNotBring.join(" ")).toMatch(/twin room/i);
    // The sample writes a 12-person roster; the report owns up to not carrying it.
    expect(report.couldNotBring.join(" ")).toMatch(/12 people on the save's roster/);
    expect(report.couldNotBring.join(" ")).toMatch(/aren't imported yet/);
  });
});

describe("towerNameFromFilename / looksLikeLegacyTower", () => {
  it("slugs the basename: separators to spaces, extension dropped, path stripped, capped", () => {
    expect(towerNameFromFilename("MY_TOWER.TDT")).toBe("MY TOWER");
    expect(towerNameFromFilename("C:\\GAMES\\SIM\\towers\\alpha-one.tdt")).toBe("alpha one");
    expect(towerNameFromFilename("§§§.tdt")).toBe("SimTower Import");
    expect(towerNameFromFilename("a-very-long-tower-name-that-keeps-going.tdt").length).toBeLessThanOrEqual(24);
  });

  it("recognizes .tdt by extension and the 0x2400 magic by sniff; nothing else", () => {
    expect(looksLikeLegacyTower("TOWER.TDT")).toBe(true);
    expect(looksLikeLegacyTower("tower.vctower")).toBe(false);
    // No other extension is special-cased; only real save bytes route here.
    expect(looksLikeLegacyTower("tower.sav")).toBe(false);
    expect(looksLikeLegacyTower("tower.sav", buildTdt())).toBe(true); // magic wins
    expect(looksLikeLegacyTower("mystery.bin", buildTdt())).toBe(true);
    expect(looksLikeLegacyTower("mystery.bin", new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("transport decode: the save's own shafts and flights", () => {
  it("a standard shaft decodes with position, extent, cars, and car homes", () => {
    const { save, report } = parse({
      floors: [{ index: 10, leftEdge: 100, rightEdge: 200 }],
      elevators: [{ type: 1, cars: 3, x: 150, bottomFloor: 9, topFloor: 39, carHomes: [10, 24, 39] }],
    });
    expect(save.transports).toHaveLength(1);
    const t = save.transports[0];
    expect(t.kind).toBe("elevatorStandard");
    expect(t.x).toBe(150);
    expect(t.bottom).toBe(0); // TDT 9 = B1
    expect(t.top).toBe(30);
    expect(t.cars).toBe(3);
    expect(t.carPositions).toEqual([1, 15, 30]); // homes 10/24/39 − 9
    expect(t.skipFloors).toEqual([]); // serviced everywhere by default
    expect(report.broughtOver.join(" ")).toMatch(/1 elevator shaft/);
  });

  it("the serviced-floors map becomes skipFloors (per-floor stop settings survive)", () => {
    const { save } = parse({
      floors: [{ index: 10, leftEdge: 100, rightEdge: 200 }],
      // An express serving only the ground and the sky lobbies.
      elevators: [{ type: 0, cars: 8, x: 150, bottomFloor: 10, topFloor: 69, serviced: [10, 24, 39, 54, 69] }],
    });
    const t = save.transports[0];
    expect(t.kind).toBe("elevatorExpress");
    expect(t.bottom).toBe(1);
    expect(t.top).toBe(60);
    expect(t.skipFloors).toContain(2); // an ordinary floor is skipped
    expect(t.skipFloors).not.toContain(15); // sky lobbies stop
    expect(t.skipFloors).not.toContain(30);
    expect(t.skipFloors).not.toContain(45);
  });

  it("service shafts decode as staff elevators; corrupt geometry is clamped or dropped", () => {
    const { save } = parse({
      elevators: [
        { type: 2, cars: 2, x: 100, bottomFloor: 10, topFloor: 20 },
        { type: 1, cars: 2, x: 500, bottomFloor: 10, topFloor: 20 }, // x off-lot → clamped
        { type: 1, cars: 2, x: 100, bottomFloor: 20, topFloor: 20 }, // zero height → dropped
      ],
    });
    const kinds = save.transports.map((t) => t.kind);
    expect(kinds).toContain("elevatorService");
    expect(save.transports).toHaveLength(2);
    for (const t of save.transports) {
      expect(t.x + t.width).toBeLessThanOrEqual(GRID.width);
      expect(t.top).toBeGreaterThan(t.bottom);
    }
  });

  it("stairs and escalators decode; multi-story variants become stacked flights", () => {
    const { save } = parse({
      stairs: [
        { type: 1, x: 100, floor: 10 }, // stairs, ours 1→2
        { type: 0, x: 120, floor: 10 }, // escalator
        { type: 3, x: 140, floor: 10 }, // two-story stairs → two flights
        { type: 4, x: 160, floor: 10 }, // three-story escalator → three flights
      ],
    });
    const flights = save.transports;
    const stairs = flights.filter((t) => t.kind === "stairs");
    const escalators = flights.filter((t) => t.kind === "escalator");
    expect(stairs).toHaveLength(3); // 1 + 2 stacked
    expect(escalators).toHaveLength(4); // 1 + 3 stacked
    const stacked = stairs.filter((t) => t.x === 140);
    expect(stacked.map((t) => [t.bottom, t.top])).toEqual([[1, 2], [2, 3]]); // exact-footprint stack
    for (const t of flights) expect(t.top - t.bottom).toBe(1);
  });

  it("corrupt shafts are dropped or trimmed, never invented, and the report counts them", () => {
    const { save, report } = parse({
      floors: [{ index: 10, leftEdge: 100, rightEdge: 200 }],
      elevators: [
        { type: 1, cars: 2, x: 100, bottomFloor: 115, topFloor: 118 }, // wholly in the reserved rows
        { type: 1, cars: 2, x: 200, bottomFloor: 10, topFloor: 119 }, // span far past the canon 30
      ],
    });
    // The out-of-range shaft must NOT fold into a phantom stub at the crown.
    expect(save.transports).toHaveLength(1);
    const trimmed = save.transports[0];
    expect(trimmed.x).toBe(200);
    expect(trimmed.top - trimmed.bottom).toBe(maxSpanFor("elevatorStandard"));
    expect(report.couldNotBring.join(" ")).toMatch(/corrupt \(impossible position\)/);
    expect(report.couldNotBring.join(" ")).toMatch(/trimmed to fit the buildable range/);
  });

  it("overlapping decoded transports keep the first and drop the rest, reported", () => {
    const { save, report } = parse({
      elevators: [
        { type: 1, cars: 2, x: 100, bottomFloor: 10, topFloor: 20 },
        { type: 1, cars: 2, x: 101, bottomFloor: 12, topFloor: 18 }, // buried inside the first
      ],
    });
    expect(save.transports).toHaveLength(1);
    expect(report.couldNotBring.join(" ")).toMatch(/corrupt \(impossible position\)/);
  });

  it("the 64-link walkway pool truncates WITH a report line, never silently", () => {
    const { save, report } = parse({
      // 30 three-story stair records at distinct columns = 90 flights wanted.
      stairs: Array.from({ length: 30 }, (_, i) => ({ type: 5, x: i * 12, floor: 10 })),
    });
    const flights = save.transports.filter((t) => t.kind === "stairs");
    expect(flights).toHaveLength(64);
    expect(report.couldNotBring.join(" ")).toMatch(/64-link limit/);
  });

  it("decode is deterministic: the same bytes always yield identical transports", () => {
    const a = parse(sampleTowerSpec()).save.transports;
    const b = parse(sampleTowerSpec()).save.transports;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.some((t) => t.kind === "elevatorStandard")).toBe(true);
    expect(a.some((t) => t.kind === "stairs")).toBe(true);
  });
});

describe("transport synthesis: the fallback when the save's blocks are unreadable", () => {
  /** A spec whose tail stops after retail: transports must be synthesized. */
  function fallback(spec: TdtSpec): TdtSpec {
    return { ...spec, includeTransports: false };
  }

  it("an unreadable transport block falls back to synthesis; and the report says so", () => {
    const { save, report } = parse(fallback(sampleTowerSpec()));
    expect(save.transports.length).toBeGreaterThan(0);
    expect(report.couldNotBring.join(" ")).toMatch(/rebuilt from your floors/);
    expect(report.broughtOver.join(" ")).not.toMatch(/straight from the save/);
  });

  it("the same floor map always yields byte-identical shafts (no RNG)", () => {
    const a = parse(fallback(sampleTowerSpec())).save.transports;
    const b = parse(fallback(sampleTowerSpec())).save.transports;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
  });

  it("a service elevator is synthesized iff the tower has hotels", () => {
    const withHotels = parse(fallback(sampleTowerSpec())).save.transports;
    expect(withHotels.some((t) => t.kind === "elevatorService")).toBe(true);
    const noHotels = parse(fallback(oneTenant(7))).save.transports;
    expect(noHotels.some((t) => t.kind === "elevatorService")).toBe(false);
  });

  it("an express shaft appears once the tower tops ~30 floors, stopping lobby-to-lobby", () => {
    const short = parse(fallback(oneTenant(7))).save.transports;
    expect(short.some((t) => t.kind === "elevatorExpress")).toBe(false);
    // Floors up to TDT 59 = our floor 50.
    const tallSpec: TdtSpec = fallback({
      floors: Array.from({ length: 50 }, (_, i) => ({ index: 10 + i, leftEdge: 100, rightEdge: 150 })),
    });
    const tall = parse(tallSpec).save.transports;
    const express = tall.find((t) => t.kind === "elevatorExpress")!;
    expect(express).toBeDefined();
    expect(express.bottom).toBe(1);
    expect(express.top).toBe(50);
    // Skips every non-lobby floor strictly inside the span.
    expect(express.skipFloors).toContain(2);
    expect(express.skipFloors).not.toContain(15);
    expect(express.skipFloors).not.toContain(30);
  });

  it("every synthesized shaft respects the canon pools, car caps, spans, and the lot", () => {
    const tallSpec: TdtSpec = fallback({
      level: 3,
      floors: [
        // A full-height tower with hotels near the top and a deep basement.
        ...Array.from({ length: 110 }, (_, i) => ({ index: i, leftEdge: 50, rightEdge: 350 })),
      ],
    });
    tallSpec.floors![95].tenants = [{ left: 100, right: 104, type: 3 }];
    tallSpec.floors![12].tenants = [{ left: 100, right: 108, type: 15 }];
    const ts: Transport[] = parse(tallSpec).save.transports;
    expect(ts.length).toBeLessThanOrEqual(24); // the shared elevator pool
    for (const t of ts) {
      expect(t.cars).toBeLessThanOrEqual(MAX_CARS[t.kind]);
      expect(t.top - t.bottom).toBeLessThanOrEqual(maxSpanFor(t.kind));
      expect(t.top).toBeGreaterThan(t.bottom);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x + t.width).toBeLessThanOrEqual(GRID.width);
      expect(t.width).toBe(FACILITIES[t.kind].width);
      expect(t.carPositions).toHaveLength(t.cars);
    }
    // Shafts never overlap each other spatially.
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) {
        const a = ts[i];
        const b = ts[j];
        const xOverlap = a.x < b.x + b.width && b.x < a.x + a.width;
        expect(xOverlap).toBe(false);
      }
    }
  });

  it("synthesizeTransports of an empty floor map is empty", () => {
    expect(synthesizeTransports(new Map(), [], [], 1)).toEqual([]);
  });

  it("shafts never hang below a floating tower's lowest built floor", () => {
    // Nothing built below our floor 40 (TDT 49): every band must clamp its
    // bottom into the built range instead of anchoring at 15/30 in thin air.
    const floating: TdtSpec = fallback({
      floors: Array.from({ length: 41 }, (_, i) => ({ index: 49 + i, leftEdge: 100, rightEdge: 200 })),
    });
    const ts = parse(floating).save.transports;
    expect(ts.length).toBeGreaterThan(0);
    for (const t of ts) expect(t.bottom).toBeGreaterThanOrEqual(40);
    // A single built floor has nothing to connect; no zero-height shafts.
    const single: TdtSpec = fallback({ floors: [{ index: 50, leftEdge: 100, rightEdge: 200 }] });
    expect(parse(single).save.transports).toEqual([]);
  });
});

describe("end-to-end: import → deserialize → live simulation", () => {
  it("the sample tower deserializes and ticks several game-hours without throwing", () => {
    const { save } = parse(sampleTowerSpec(), "ROUNDTRIP.TDT");
    const sim = Simulation.deserialize(save);
    expect(sim.money).toBe(1_500_000);
    expect(sim.star).toBe(2);
    expect(sim.tower.towerName).toBe("ROUNDTRIP");
    expect(sim.mode).toBe("classic");
    // The sold condo, tenanted office, decoded shaft, and hotel states all
    // survived the trust boundary.
    expect(sim.tower.units.some((u) => u.kind === "condo" && u.everOccupied)).toBe(true);
    expect(sim.tower.units.some((u) => u.kind === "office" && u.state === "occupied")).toBe(true);
    expect(sim.tower.transports.some((t) => t.kind === "elevatorStandard")).toBe(true);
    expect(sim.tower.transports.some((t) => t.kind === "stairs")).toBe(true);
    expect(sim.tower.units.some((u) => u.state === "asleep")).toBe(true);
    expect(sim.tower.units.some((u) => u.state === "dirty")).toBe(true);
    // An imported High rent survived onto the unit.
    expect(sim.tower.units.some((u) => u.kind === "office" && u.rent === ECON.rent.office.max)).toBe(true);
    // Six game-hours, minute ticks; crosses the morning rush and lunch.
    for (let i = 0; i < 6 * 60; i++) sim.tick(1);
    expect(Number.isFinite(sim.money)).toBe(true);
    expect(sim.population).toBeGreaterThanOrEqual(0);
  });

  it("under-construction rooms finish after import (the timer restarts honestly)", () => {
    const { save } = parse(oneTenant(-7));
    const sim = Simulation.deserialize(save);
    const office = () => sim.tower.units.find((u) => u.kind === "office")!;
    expect(office().state).toBe("construction");
    for (let i = 0; i < 12 * 60 && office().state === "construction"; i += 30) sim.tick(30);
    expect(office().state).not.toBe("construction");
  });
});
