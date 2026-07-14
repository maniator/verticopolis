import { describe, it, expect } from "vitest";
import { Simulation } from "../../engine/Simulation";
import { FACILITIES, facilityFloors } from "../../engine/facilities";
import { SAVE_VERSION } from "../../engine/saveMigration";
import { buildTDT } from "../../storage/tdtExport";
import { parseTDT } from "../../storage/tdtImport";
import type { SerializedGame, Unit } from "../../engine/types";

/**
 * Sim-driven and storage round-trip coverage for the two-story Party Hall: a
 * legacy save loads end-to-end through `Simulation.deserialize` with the hall
 * indexed across both stories, and a built hall survives an export/import trip as
 * a single two-story room. The pure catalog/placement/migration unit tests live
 * in `src/tests/partyHallTwoFloor.test.ts`.
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

describe("Party Hall two-story load and round trip", () => {
  it("loads end-to-end through deserialize, stamping the current version", () => {
    const save = v5Save([
      ...pave("lobby", 1, 0, 60),
      ...pave("floor", 2, 0, 60),
      { kind: "partyHall", floor: 2, x: 10, width: HALL_W },
    ]);
    const sim = Simulation.deserialize(save);
    expect(sim.serialize().version).toBe(SAVE_VERSION);
    const hall = sim.tower.units.find((u) => u.kind === "partyHall")!;
    // The engine indexes the hall across both stories.
    expect(sim.tower.roomAt(hall.floor, hall.x)?.id).toBe(hall.id);
    expect(sim.tower.roomAt(hall.floor + 1, hall.x)?.id).toBe(hall.id);
  });

  it("exports and re-imports a built hall as a single two-story room", () => {
    // A minimal exportable tower: ground lobby, two paved stories, and a hall.
    const save = v5Save(
      [
        ...pave("lobby", 1, 0, 80),
        ...pave("floor", 2, 0, 80),
        ...pave("floor", 3, 0, 80),
        { kind: "partyHall", floor: 2, x: 40, width: HALL_W },
      ],
      { version: SAVE_VERSION, star: 5 },
    );
    const built = buildTDT(save);
    const round = parseTDT(
      built.bytes.buffer.slice(built.bytes.byteOffset, built.bytes.byteOffset + built.bytes.byteLength) as ArrayBuffer,
      "RT.TDT",
    ).save;
    const halls = round.units.filter((u) => u.kind === "partyHall");
    // Exactly one hall comes back, merged from the 30/29 (bottom/top) parts, at
    // its bottom story and canon width.
    expect(halls).toHaveLength(1);
    expect(halls[0].floor).toBe(2);
    expect(halls[0].x).toBe(40);
    expect(halls[0].width).toBe(HALL_W);
    // Its two-story height comes from the catalog on both sides of the trip.
    expect(facilityFloors(halls[0].kind)).toBe(2);
  });
});
