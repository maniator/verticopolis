import { describe, expect, it } from "vitest";
import type { EnginePort } from "../../simport/enginePort";
import { PortCodes } from "../../simport/portCodes";
import type { SimView } from "../../simport/view";
import type { ViewReader } from "../../simport/viewReader";
import { newViewReader } from "../../game/portAccess";
import { portOf } from "../../game/cardKit.fixture";
import { draftTower } from "../portKit/drafts";
import { noEngine } from "../portKit/rustEngine";
import { catalogFor } from "../catalogFixture";
import { catalogFacility } from "../../catalog/catalogTypes";
import type { FacilityKind } from "../../shared/types";

/**
 * The shared reader (contract section 5) over the Rust `Engine`: a reader
 * kept up to date frame by frame decodes the same `SimView` as a new reader
 * taking one full frame, and its rooms and header match the engine's own
 * save and stats, through play, builds, label and subtype changes and a
 * swap. The reader keeps its objects while their revision stands.
 */

function built(): EnginePort {
  const draft = draftTower(5, "modern");
  draft.money = 1e8;
  draft.star = 3;
  for (let x = 160; x < 280; x++) expect(draft.build("lobby", 1, x).ok).toBe(true);
  for (const floor of [2, 3]) for (let x = 160; x < 280; x++) expect(draft.build("floor", floor, x).ok).toBe(true);
  for (const x of [170, 180]) expect(draft.build("office", 2, x).ok).toBe(true);
  for (const floor of [2, 3]) expect(draft.build("fastFood", floor, 190).ok).toBe(true);
  expect(draft.build("hotelSingle", 3, 170).ok).toBe(true);
  expect(draft.build("cinema", 2, 220).ok).toBe(true);
  expect(draft.buildTransport("elevatorStandard", 162, 1, 3).ok).toBe(true);
  expect(draft.buildTransport("stairs", 275, 1, 2).ok).toBe(true);
  draft.settle();
  (draft.tower.unitAt(2, 170) as { label?: string }).label = "Corner Office";
  return portOf(draft);
}

/** What a painter or the HUD reads, as plain data. */
function snapshot(v: SimView) {
  const h = v.header;
  return {
    header: { ...h, fx: JSON.parse(JSON.stringify(h.fx)) as unknown, camera: h.camera && { ...h.camera } },
    rooms: v.rooms.map((u) => ({ ...u })),
    structure: v.structure.map((r) => ({ kind: r.kind, floor: r.floor, x: r.x, width: r.width, count: r.count })),
    transports: v.tower.transports.map((t) => ({ ...t, carPositions: [...t.carPositions], carLoad: [...(t.carLoad ?? [])], carDir: [...t.carDir] })),
    people: v.crowd.people.map((p) => ({ ...p })),
    bounds: [v.tower.highestFloor, v.tower.lowestFloor, v.tower.revision, v.tower.towerName],
    lookups: [170, 175, 190, 200, 230, 260, 290].flatMap((x) =>
      [1, 2, 3, 4].map((fl) => [v.tower.unitAt(fl, x)?.kind, v.tower.hasStructure(fl, x), v.tower.structureKindAt(fl, x)]),
    ),
  };
}

/** The engine's own answers for the fields the view carries: its save's
 *  rooms (every unit but the floor and lobby runs; a room with no name of
 *  its own reads as its facility's, and one with no state saved is empty),
 *  its money and its population. */
function truth(engine: EnginePort) {
  const save = JSON.parse(engine.serialize()) as { money: number; units: Record<string, unknown>[] };
  const cat = catalogFor("modern");
  return {
    rooms: save.units
      .filter((u) => u.kind !== "floor" && u.kind !== "lobby")
      .map((u) => ({ id: u.id, kind: u.kind, floor: u.floor, x: u.x, width: u.width, state: u.state ?? "empty", label: u.label ?? catalogFacility(cat, u.kind as FacilityKind).name, subtype: u.subtype })),
    money: save.money,
    population: new PortCodes(engine).slot(engine.statsStrip(), "statsStrip", "population"),
  };
}

const plain = (rooms: object[]) => rooms.map((r) => JSON.parse(JSON.stringify(r)) as unknown);
const pick = (rooms: SimView["rooms"]) =>
  plain(rooms.map((u) => ({ id: u.id, kind: u.kind, floor: u.floor, x: u.x, width: u.width, state: u.state, label: u.label, subtype: u.subtype })));

/** Check the kept reader against the engine. `fresh` also decodes one full
 *  frame with a new reader and compares the two; that frame makes the kept
 *  reader take a full one next, so a check of the kept objects skips it. */
function check(reader: ViewReader, engine: EnginePort, fresh = true): void {
  reader.update();
  // The saved camera is read on a new tower only, so a kept reader keeps the
  // one it read then; the new reader's camera is checked where it is set.
  const frame = (v: SimView) => ({ ...snapshot(v), header: { ...snapshot(v).header, camera: undefined } });
  if (fresh) expect(frame(reader), "the kept reader decodes what one full frame says").toEqual(frame(newViewReader(engine)));
  const t = truth(engine);
  expect(pick(reader.rooms).sort((x, y) => (x as { id: number }).id - (y as { id: number }).id)).toEqual(plain(t.rooms).sort((x, y) => (x as { id: number }).id - (y as { id: number }).id));
  expect([reader.header.money, reader.header.population]).toEqual([t.money, t.population]);
}

describe.skipIf(noEngine)("ViewReader over the Rust engine", () => {
  it("decodes what one full frame says, and what the engine holds", () => {
    const rust = built();
    const r = newViewReader(rust);
    check(r, rust);
    r.update(); // the full frame the check's new reader left it
    const kept = r.rooms;
    for (let i = 0; i < 8; i++) {
      rust.tick(45);
      check(r, rust, false);
    }
    expect(r.rooms, "no rebuild without a revision move").toBe(kept);
    const office = r.rooms.find((u) => u.kind === "office")!.id;
    const food = r.rooms.find((u) => u.kind === "fastFood")!.id;
    const codes = new PortCodes(rust);
    expect(rust.labelUnit(office, "Big Office")[0]).toBe(1);
    expect(rust.rerollUnit(food)[0]).toBe(1);
    expect(rust.buildAt(codes.code("kinds", "office"), 2, 255)[0]).toBe(1);
    expect(rust.paintTiles(codes.code("kinds", "floor"), 4, Float64Array.of(160, 161, 162))[0]).toBe(1);
    rust.setCamera(200, 2, 1.5);
    expect(newViewReader(rust).header.camera, "a new tower's reader reads the saved camera").toEqual({ tile: 200, floor: 2, zoom: 1.5 });
    check(r, rust);
    expect(r.rooms).not.toBe(kept);
    expect(r.tower.getUnit(office)).toBe(kept.find((u) => u.id === office));
    expect(r.tower.getUnit(office)?.label).toBe("Big Office");
    expect(rust.restore(rust.serialize())[0]).toBe(1);
    check(r, rust);
    rust.tick(600);
    check(r, rust);
  });

  it("takes a full frame after another caller took one", () => {
    const rust = built();
    const r = newViewReader(rust);
    for (let i = 0; i < 6; i++) {
      rust.tick(45);
      // This frame carries the rooms that changed, and the reader never sees it.
      rust.viewFrame(false);
      check(r, rust);
    }
  });

  it("keeps a person's object by id, for one generation", () => {
    const rust = built();
    const r = newViewReader(rust);
    rust.tick(480);
    check(r, rust);
    const held = new Map(r.crowd.people.map((p) => [p.id, p]));
    let stayed = 0;
    let left = held.size;
    for (let i = 0; i < 4; i++) {
      rust.tick(30);
      check(r, rust);
    }
    for (const p of r.crowd.people) {
      const was = held.get(p.id);
      if (was === undefined) continue;
      expect(p).toBe(was);
      stayed++;
      left--;
    }
    expect([stayed > 0, left > 0], "some stayed and some left").toEqual([true, true]);
    expect(rust.restore(rust.serialize())[0]).toBe(1);
    check(r, rust);
    for (const p of r.crowd.people) expect(p, "a swap starts the pool again").not.toBe(held.get(p.id));
  });
});
