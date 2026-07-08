import { describe, expect, it } from "vitest";
import type { SerializedGame } from "../engine/types";
import { SAVE_VERSION } from "../engine/saveMigration";
import { parseTdtBinary } from "../storage/tdtFormat";
import { LegacyExportError, buildTDT, classFromRent, legacyFilename } from "../storage/tdtExport";
import { parseTDT } from "../storage/tdtImport";
import { buildTdt, sampleTowerSpec } from "./fixtures/tdtBuilder";

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
    // The 2,600-tick clock has finer grain than minutes; allow the one-tick seam.
    expect(Math.abs(back.minutes - save.minutes)).toBeLessThanOrEqual(1);
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

describe("classFromRent / legacyFilename", () => {
  it("maps band anchors to the four 1994 classes; unset stays Average", () => {
    expect(classFromRent("office", 2_000)).toBe(0); // band.min
    expect(classFromRent("office", 10_000)).toBe(2); // band.default
    expect(classFromRent("office", 20_000)).toBe(3); // band.max
    expect(classFromRent("office", undefined)).toBe(2);
    expect(classFromRent("security", 123)).toBe(2); // unpriced kind
  });

  it("filenames are DOS-safe: A-Z0-9, upper, max 8 chars, never empty", () => {
    expect(legacyFilename("My Tower!")).toBe("MYTOWER.TDT");
    expect(legacyFilename("verticopolis prime")).toBe("VERTICOP.TDT");
    expect(legacyFilename("---")).toBe("TOWER1.TDT");
  });
});
