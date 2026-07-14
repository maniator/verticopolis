import { describe, it, expect } from "vitest";
import { Tower } from "./Tower";
import { FACILITIES, GRID, facilityFloors } from "./facilities";
import { expandLegacyPartyHalls, migrationLooksValid, floatingStructureCount } from "./saveMigration";
import type { SerializedGame, Unit } from "./types";

/**
 * Party Hall is a two-story room (canon: TDT tile codes 29/30 "top/bottom half",
 * the SimTower wiki, and our own `FAMILY_STORIES.partyHall = 2`). This covers the
 * catalog height, the placement rules it drives, and the v5 -> v6 save migration
 * that grows every legacy one-story hall into its second story. The end-to-end
 * deserialize and TDT round-trip live in the integration suite.
 */

/** A minimal v5 SerializedGame carrying the given units. */
function v5Save(units: Partial<Unit>[], extra: Partial<SerializedGame> = {}): SerializedGame {
  return {
    version: 5,
    seed: 1,
    money: 1e9,
    star: 3,
    minutes: 0,
    mode: "classic",
    units: units.map((u, i) => ({
      id: i + 1,
      state: "occupied",
      occupants: 0,
      everOccupied: false,
      width: 1,
      floor: 1,
      x: 0,
      ...u,
    })) as Unit[],
    transports: [],
    nextId: units.length + 1,
    towerName: "Legacy",
    builtWeddingHall: false,
    evaluatedTower: false,
    ...extra,
  } as SerializedGame;
}

/** Paving tiles (floor/lobby) across [x0, x1) on a floor. */
function pave(kind: "floor" | "lobby", floor: number, x0: number, x1: number): Partial<Unit>[] {
  const out: Partial<Unit>[] = [];
  for (let x = x0; x < x1; x++) out.push({ kind, floor, x, width: 1 });
  return out;
}

const HALL_W = FACILITIES.partyHall.width; // 24

describe("Party Hall two-story catalog and placement", () => {
  it("is a two-story facility", () => {
    expect(facilityFloors("partyHall")).toBe(2);
    expect(FACILITIES.partyHall.floors).toBe(2);
  });

  it("requires both stories and blocks a room directly above it", () => {
    const tower = new Tower();
    // Assert every fixture placement so a silently-degraded tower can't pass.
    const layRow = (kind: "lobby" | "floor", floor: number) => {
      for (let i = 0; i < HALL_W + 4; i++) expect(tower.place(kind, floor, i).ok).toBe(true);
    };
    layRow("lobby", 1);
    // Only the lower story exists, so the hall cannot be placed.
    layRow("floor", 2);
    expect(tower.canPlace("partyHall", 2, 0).ok).toBe(false); // floor 3 missing
    layRow("floor", 3);
    expect(tower.canPlace("partyHall", 2, 0).ok).toBe(true);
    const r = tower.place("partyHall", 2, 0);
    expect(r.ok).toBe(true);
    // It occupies BOTH floors, so a room can't sit on the story above.
    expect(tower.roomAt(2, 1)?.id).toBe(r.unitId);
    expect(tower.roomAt(3, 1)?.id).toBe(r.unitId);
    expect(tower.canPlace("office", 3, 0).ok).toBe(false);
  });
});

describe("Party Hall v5 to v6 migration", () => {
  it("expands a hall in place when the story above is clear, paving the upper floor", () => {
    const save = v5Save([
      ...pave("lobby", 1, 0, 60),
      ...pave("floor", 2, 0, 60), // hall's own (lower) floor is built
      { kind: "partyHall", floor: 2, x: 10, width: HALL_W },
    ]);
    const out = expandLegacyPartyHalls(save);
    const hall = out.units.find((u) => u.kind === "partyHall")!;
    expect(hall.floor).toBe(2); // unmoved
    expect(hall.x).toBe(10);
    // Upper story (floor 3) is now fully paved under the hall.
    for (let x = 10; x < 10 + HALL_W; x++)
      expect(out.units.some((u) => u.kind === "floor" && u.floor === 3 && u.x === x)).toBe(true);
    expect(migrationLooksValid(out)).toBe(true);
    expect(floatingStructureCount(out)).toBeLessThanOrEqual(floatingStructureCount(save));
    expect(out.version).toBe(6);
  });

  it("relocates a boxed-in hall to the nearest two-story fit, keeping neighbors intact", () => {
    // Hall on floor 2; the whole story above (floor 3) is packed with offices, so
    // it cannot grow up in place. A clear, paved two-story gap sits to the right.
    const save = v5Save([
      ...pave("floor", 2, 0, 200),
      ...pave("floor", 3, 0, 60), // paved AND filled above the hall
      { kind: "partyHall", floor: 2, x: 10, width: HALL_W },
      { kind: "office", floor: 3, x: 0, width: 9 },
      { kind: "office", floor: 3, x: 9, width: 9 },
      { kind: "office", floor: 3, x: 18, width: 9 },
      { kind: "office", floor: 3, x: 27, width: 9 },
      // A clear paved two-story slot further right (floors 2 & 3 both paved, no rooms).
      ...pave("floor", 3, 100, 160),
    ]);
    const out = expandLegacyPartyHalls(save);
    const hall = out.units.find((u) => u.kind === "partyHall")!;
    // Moved off its blocked column (x=10, whose upper story held offices).
    expect(hall.x).not.toBe(10);
    // The hall's upper story no longer overlaps any surviving office.
    const offices = out.units.filter((u) => u.kind === "office");
    expect(offices.length).toBe(4); // all neighbors intact
    for (const o of offices) {
      const sharesUpper = o.floor === hall.floor + 1 && o.x < hall.x + hall.width! && hall.x < o.x + o.width!;
      expect(sharesUpper).toBe(false);
    }
    expect(migrationLooksValid(out)).toBe(true);
    expect(floatingStructureCount(out)).toBeLessThanOrEqual(floatingStructureCount(save));
  });

  it("drops a hall (with a log line) when no supported two-story slot exists", () => {
    // The last-resort safety net: a degenerate save whose party hall has lost the
    // structure it sat on. With no built floor anywhere, no two-story footprint
    // can attach to the tower, so the hall cannot be placed and is removed rather
    // than left floating.
    const save = v5Save([{ kind: "partyHall", floor: 50, x: 0, width: HALL_W }], { minutes: 4242 });
    const out = expandLegacyPartyHalls(save);
    expect(out.units.some((u) => u.kind === "partyHall")).toBe(false); // dropped
    const log = out.log ?? [];
    expect(log.some((e) => e.kind === "bad" && /party hall/i.test(e.text))).toBe(true);
    expect(log[log.length - 1]?.minute).toBe(4242);
    expect(migrationLooksValid(out)).toBe(true);
  });

  it("indexes forged unit geometry at its clamped position, so a hall never lands where a room will load", () => {
    // A forged office with width 0 (deserialize clamps it to width 1 at column
    // 30) and another with an off-lot x of -5 (clamps to column 0, width 9). The
    // migration must index both at those clamped columns, or it would treat floor
    // 3 as clear and expand the hall's upper story straight onto them.
    const save = v5Save([
      ...pave("floor", 2, 0, 60),
      ...pave("floor", 3, 0, 60),
      { kind: "office", floor: 3, x: 30, width: 0 as unknown as number },
      { kind: "office", floor: 3, x: -5 as unknown as number, width: 9 },
      { kind: "partyHall", floor: 2, x: 24, width: HALL_W }, // upper span 24..48 covers clamped office 30
    ]);
    const out = expandLegacyPartyHalls(save);
    const hall = out.units.find((u) => u.kind === "partyHall")!;
    // The clamped office footprints deserialize will produce: column 30, and 0..8.
    const clampedOfficeCols = new Set<number>([30, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // The hall's two-story footprint (on floor 3, the offices' floor) shares none
    // of those columns.
    if (hall.floor + 1 === 3 || hall.floor === 3) {
      for (let x = hall.x; x < hall.x + hall.width!; x++) expect(clampedOfficeCols.has(x)).toBe(false);
    }
  });

  it("never lets a hall's footprint straddle the ground concourse (floor 0 to 1)", () => {
    // A legacy basement hall at floor 0 would grow up onto the ground lobby
    // (floor 1). A room may not sit on the concourse, so the migration relocates
    // it into the basement instead.
    const save = v5Save([
      ...pave("lobby", 1, 0, 80),
      ...pave("floor", 0, 0, 80),
      ...pave("floor", -1, 0, 80),
      { kind: "partyHall", floor: 0, x: 10, width: HALL_W },
    ]);
    const out = expandLegacyPartyHalls(save);
    const hall = out.units.find((u) => u.kind === "partyHall")!;
    // Neither of its two stories is the ground floor (1), and neither lands on a lobby tile.
    for (const f of [hall.floor, hall.floor + 1]) {
      expect(f).not.toBe(1);
      const lobbyHere = out.units.some(
        (u) => u.kind === "lobby" && u.floor === f && u.x < hall.x + hall.width! && hall.x < u.x + (u.width ?? 1),
      );
      expect(lobbyHere).toBe(false);
    }
    expect(migrationLooksValid(out)).toBe(true);
  });

  it("never grows a hall's upper story onto a sky-lobby concourse", () => {
    // A hall at floor 14 would reach up into a sky lobby at floor 15. A room may
    // not sit on a sky lobby, so the migration relocates it clear.
    const save = v5Save([
      ...pave("lobby", 1, 0, 80),
      ...pave("floor", 2, 0, 80),
      ...pave("floor", 3, 0, 80),
      ...Array.from({ length: 11 }, (_, i) => pave("floor", 4 + i, 0, 80)).flat(), // floors 4..14
      ...pave("lobby", 15, 0, 80), // the sky lobby
      { kind: "partyHall", floor: 14, x: 10, width: HALL_W },
    ]);
    const out = expandLegacyPartyHalls(save);
    const hall = out.units.find((u) => u.kind === "partyHall")!;
    // Its footprint never includes the sky-lobby floor.
    expect(hall.floor).not.toBe(15);
    expect(hall.floor + 1).not.toBe(15);
    expect(migrationLooksValid(out)).toBe(true);
  });

  it("is idempotent: a migrated hall re-expands in place with no further change", () => {
    const save = v5Save([
      ...pave("floor", 2, 0, 60),
      { kind: "partyHall", floor: 2, x: 10, width: HALL_W },
    ]);
    const once = expandLegacyPartyHalls(save);
    const twice = expandLegacyPartyHalls({ ...once, version: 5 });
    const h1 = once.units.find((u) => u.kind === "partyHall")!;
    const h2 = twice.units.find((u) => u.kind === "partyHall")!;
    expect({ floor: h2.floor, x: h2.x }).toEqual({ floor: h1.floor, x: h1.x });
    // No extra paving on the second pass (upper story already built).
    expect(twice.units.filter((u) => u.kind === "floor").length).toBe(
      once.units.filter((u) => u.kind === "floor").length,
    );
  });

  it("keeps a hall at the top of the tower placeable (clamped below the roof)", () => {
    // A hall saved at the very top floor would reach past the roof at two stories;
    // the loader clamps it so both stories fit.
    const save = v5Save([
      ...pave("floor", GRID.maxFloor - 1, 0, 60),
      ...pave("floor", GRID.maxFloor, 0, 60),
      { kind: "partyHall", floor: GRID.maxFloor, x: 10, width: HALL_W },
    ]);
    const out = expandLegacyPartyHalls(save);
    const hall = out.units.find((u) => u.kind === "partyHall");
    if (hall) {
      expect(hall.floor + facilityFloors("partyHall") - 1).toBeLessThanOrEqual(GRID.maxFloor);
    }
    expect(migrationLooksValid(out)).toBe(true);
  });
});
