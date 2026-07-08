import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
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

/** One tenant of the given type on TDT floor 20 (our floor 11). */
function oneTenant(type: number, left = 100, right = 109, status = 0): TdtSpec {
  return { floors: [{ index: 20, tenants: [{ left, right, type, status }] }] };
}

describe("tdtFormat — hostile-file hardening (typed errors, never hangs)", () => {
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

  it("a missing retail table is a warning, not a failure", () => {
    const tdt = parseTdtBinary(buildTdt({ includeRetail: false }));
    expect(tdt.retailRows).toBeNull();
    expect(tdt.warnings.length).toBeGreaterThan(0);
  });

  it("reads the retail table's occupied rows when present", () => {
    const tdt = parseTdtBinary(buildTdt({ retailRows: 7 }));
    expect(tdt.retailRows).toBe(7);
    expect(tdt.warnings).toEqual([]);
  });

  it("fuzz-lite: seeded random byte-flips either import or throw LegacyImportError", () => {
    const pristine = buildTdt(sampleTowerSpec());
    // Tiny deterministic LCG — no Math.random, so a failure reproduces exactly.
    let s = 0xc0ffee;
    const rnd = (n: number) => {
      s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
      return s % n;
    };
    for (let round = 0; round < 60; round++) {
      const bytes = pristine.slice();
      const flips = 1 + rnd(3);
      for (let f = 0; f < flips; f++) bytes[rnd(bytes.length)] ^= 1 << rnd(8);
      // Parse inside the try, deserialize OUTSIDE it — a deserialize failure
      // must surface its own error, not be re-asserted as a LegacyImportError.
      let save: SerializedGame | null = null;
      try {
        save = parseTDT(bytes.buffer as ArrayBuffer, "FUZZ.TDT").save;
      } catch (err) {
        expect(err).toBeInstanceOf(LegacyImportError);
      }
      // A surviving parse must still deserialize — the second hardening layer.
      if (save) Simulation.deserialize(save);
    }
  });
});

describe("parseTDT — golden mappings", () => {
  it("money is stored ×1/100: balance 20000 → $2,000,000 (negative survives)", () => {
    expect(parse({ balance: 20000 }).save.money).toBe(2_000_000);
    expect(parse({ balance: -500 }).save.money).toBe(-50_000);
  });

  it("frame 0 lands on 7:00 AM of the header's day", () => {
    expect(parse({ frameTime: 0, currentDay: 0 }).save.minutes).toBe(7 * 60);
    expect(parse({ frameTime: 0, currentDay: 2 }).save.minutes).toBe(2 * 1440 + 7 * 60);
  });

  it("frame 2300 is midnight — the small hours belong to currentDay itself", () => {
    // The original changes the date AT frame 2300, so day 5 frame 2300 is
    // 00:00 of day 5, not day 6.
    expect(parse({ frameTime: 2300, currentDay: 5 }).save.minutes).toBe(5 * 1440);
    // The last night frame still sits before 7:00 of the same day.
    const lastFrame = parse({ frameTime: 2599, currentDay: 5 }).save.minutes;
    expect(lastFrame).toBeGreaterThan(5 * 1440);
    expect(lastFrame).toBeLessThan(5 * 1440 + 7 * 60);
  });

  it("a negative (signed) currentDay clamps to day 0 — and the report says so", () => {
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

  it("floor offsets: TDT 0→B10, 9→B1, 10→ground, 109→100F; ≥110 dropped with a report", () => {
    const at = (index: number) =>
      rooms({ floors: [{ index, tenants: [{ left: 100, right: 109, type: 7 }] }] });
    expect(at(0)[0].floor).toBe(-9);
    expect(at(9)[0].floor).toBe(0);
    expect(at(10)[0].floor).toBe(1);
    expect(at(109)[0].floor).toBe(100);

    const dropped = parse({ floors: [{ index: 110, tenants: [{ left: 100, right: 109, type: 7 }] }] });
    expect(dropped.save.units).toHaveLength(0);
    expect(dropped.report.couldNotBring.join(" ")).toMatch(/above floor 100/);
  });

  const MAPPINGS: [number, FacilityKind][] = [
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
    [18, "cinema"],
    [34, "cinema"],
    [20, "recycling"],
    [29, "partyHall"],
    [31, "metro"],
    [36, "weddingHall"],
    [45, "parkingRamp"],
  ];
  it.each(MAPPINGS)("tenant ID %i imports as %s", (id, kind) => {
    const got = rooms(oneTenant(id));
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe(kind);
  });

  it("type 0 (floor) and 24 (lobby) pave structure instead of making rooms", () => {
    const paveOnly = parse({ floors: [{ index: 15, tenants: [{ left: 100, right: 120, type: 0 }] }] });
    expect(paveOnly.save.units.every((u) => u.kind === "floor")).toBe(true);
    expect(paveOnly.save.units).toHaveLength(20); // width-1 tiles, like in-game placement

    const ground = parse({ floors: [{ index: 10, tenants: [{ left: 100, right: 120, type: 24 }] }] });
    expect(ground.save.units.every((u) => u.kind === "lobby")).toBe(true); // ground is a lobby floor
  });

  it("sky-lobby floors pave as lobby; ordinary floors pave as floor", () => {
    // TDT 24 = our floor 15 — a sky-lobby floor.
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
    const { save, report } = parse(oneTenant(40));
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

  it("occupancy heuristic: tenanted offices/condos import occupied; hotels start empty", () => {
    const office = rooms(oneTenant(7, 100, 109, 1))[0];
    expect(office.state).toBe("occupied");
    expect(office.everOccupied).toBe(true);
    const vacantOffice = rooms(oneTenant(7, 100, 109, 0))[0];
    expect(vacantOffice.state).toBe("empty");
    expect(vacantOffice.everOccupied).toBe(false);
    const hotel = rooms(oneTenant(3, 100, 104, 5))[0];
    expect(hotel.state).toBe("empty"); // fresh day — guests arrive tonight
    expect(hotel.everOccupied).toBe(false);
    expect(office.satisfaction).toBe(1);
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
            { left: 105, right: 114, type: 7 }, // overlaps the first — corrupt
            { left: 114, right: 123, type: 7 }, // disjoint — kept
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

  it("a Cathedral arrives as the Wedding Hall, sets the flag, and is reported as a divergence", () => {
    const { save, report } = parse(oneTenant(36, 100, 116));
    expect(save.units.some((u) => u.kind === "weddingHall")).toBe(true);
    expect(save.builtWeddingHall).toBe(true);
    expect(report.couldNotBring.join(" ")).toMatch(/Wedding Hall/);
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
    expect(report.couldNotBring.join(" ")).toMatch(/shaft data isn't decoded/);
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

  it("recognizes .tdt by extension and the 0x2400 magic by sniff — nothing else", () => {
    expect(looksLikeLegacyTower("TOWER.TDT")).toBe(true);
    expect(looksLikeLegacyTower("tower.vctower")).toBe(false);
    // No other extension is special-cased; only real save bytes route here.
    expect(looksLikeLegacyTower("tower.sav")).toBe(false);
    expect(looksLikeLegacyTower("tower.sav", buildTdt())).toBe(true); // magic wins
    expect(looksLikeLegacyTower("mystery.bin", buildTdt())).toBe(true);
    expect(looksLikeLegacyTower("mystery.bin", new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("transport synthesis — deterministic, canon-capped", () => {
  it("the same floor map always yields byte-identical shafts (no RNG)", () => {
    const a = parse(sampleTowerSpec()).save.transports;
    const b = parse(sampleTowerSpec()).save.transports;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
  });

  it("a service elevator exists iff the tower has hotels", () => {
    const withHotels = parse(sampleTowerSpec()).save.transports;
    expect(withHotels.some((t) => t.kind === "elevatorService")).toBe(true);
    const noHotels = parse(oneTenant(7)).save.transports;
    expect(noHotels.some((t) => t.kind === "elevatorService")).toBe(false);
  });

  it("an express shaft appears once the tower tops ~30 floors, stopping lobby-to-lobby", () => {
    const short = parse(oneTenant(7)).save.transports;
    expect(short.some((t) => t.kind === "elevatorExpress")).toBe(false);
    // Floors up to TDT 59 = our floor 50.
    const tallSpec: TdtSpec = {
      floors: Array.from({ length: 50 }, (_, i) => ({ index: 10 + i, leftEdge: 100, rightEdge: 150 })),
    };
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
    const tallSpec: TdtSpec = {
      level: 3,
      floors: [
        // A full-height tower with hotels near the top and a deep basement.
        ...Array.from({ length: 110 }, (_, i) => ({ index: i, leftEdge: 50, rightEdge: 350 })),
      ],
    };
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
    const floating: TdtSpec = {
      floors: Array.from({ length: 41 }, (_, i) => ({ index: 49 + i, leftEdge: 100, rightEdge: 200 })),
    };
    const ts = parse(floating).save.transports;
    expect(ts.length).toBeGreaterThan(0);
    for (const t of ts) expect(t.bottom).toBeGreaterThanOrEqual(40);
    // A single built floor has nothing to connect — no zero-height shafts.
    const single: TdtSpec = { floors: [{ index: 50, leftEdge: 100, rightEdge: 200 }] };
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
    // The sold condo and tenanted office survived the trust boundary.
    expect(sim.tower.units.some((u) => u.kind === "condo" && u.everOccupied)).toBe(true);
    expect(sim.tower.units.some((u) => u.kind === "office" && u.state === "occupied")).toBe(true);
    // Six game-hours, minute ticks — crosses the morning rush and lunch.
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
