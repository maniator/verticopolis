import { describe, expect, it } from "vitest";
import type { SerializedGame, Unit } from "../engine/types";
import { SAVE_VERSION } from "../engine/saveMigration";
import { parseTdtBinary } from "../storage/tdtFormat";
import { LegacyExportError, buildTDT, classFromRent, legacyFilename } from "../storage/tdtExport";
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
