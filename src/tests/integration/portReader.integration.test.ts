import { describe, expect, it } from "vitest";
import { catalogOn } from "../../catalog/towerCatalog";
import { newViewReader } from "../../game/portAccess";
import type { FacilityKind } from "../../shared/types";
import { unitPrice } from "../../ui/catalogPricing";
import { Cards } from "../../simport/cards";
import type { EnginePort } from "../../simport/enginePort";
import { PortCodes } from "../../simport/portCodes";
import { scheduleSlots } from "../../simport/scheduleSlots";
import type { ViewReader } from "../../simport/viewReader";
import { engineFromSave, look, must, noEngine, smallTower } from "../portKit/rustEngine";

/**
 * The shared reader and the card decoders on the Rust engine, checked against
 * the engine's own save and lookups (the tooling tower's record views and
 * geometry queries). Their unit tests (`src/simport/`) run on mock ports.
 */

const STRUCTURE = new Set(["floor", "lobby"]);

/** The reader's tower: offices, a fast food and a hotel room on the small tower. */
function readerTower(): EnginePort {
  const d = smallTower((t) => {
    must(t.build("office", 2, 170), "office");
    must(t.build("fastFood", 2, 190), "fast food");
    must(t.build("hotelSingle", 3, 170), "hotel room");
    must(t.buildTransport("elevatorStandard", 162, 1, 3), "elevator");
  });
  return engineFromSave(d.saveText());
}

/** The cards' tower: an office, a cinema, an elevator and stairs. */
function cardTower(): EnginePort {
  const d = smallTower((t) => {
    must(t.build("office", 2, 170), "office");
    must(t.build("cinema", 2, 200), "cinema");
    must(t.buildTransport("elevatorStandard", 162, 1, 3), "elevator");
    must(t.buildTransport("stairs", 230, 1, 2), "stairs");
  });
  return engineFromSave(d.saveText());
}

const roomsOf = (e: EnginePort) => look(e).tower.units.filter((u) => !STRUCTURE.has(u.kind as string));

const plain = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

function cardsOf(e: EnginePort): { cards: Cards; reader: ViewReader } {
  const reader = newViewReader(e);
  return { cards: new Cards(e, reader), reader };
}

const unitOf = (e: EnginePort, kind: string) => look(e).tower.units.find((u) => u.kind === kind)!;
const shaftOf = (e: EnginePort, kind: string) => look(e).tower.transports.find((t) => t.kind === kind)!;

describe.skipIf(noEngine)("ViewReader on the engine", () => {
  it("decodes the rooms, the structure and the header the engine holds", () => {
    const e = readerTower();
    const r = newViewReader(e);
    const rooms = roomsOf(e);
    expect(r.rooms.map((u) => [u.id, u.kind, u.floor, u.x, u.width])).toEqual(rooms.map((u) => [u.id, u.kind, u.floor, u.x, u.width]));
    // A save leaves a default name out; the frame carries the name shown.
    expect(r.rooms.map((u) => u.label)).toEqual(["Office", "Fast Food", "Single Room"]);
    expect(r.structure.map((s) => [s.kind, s.floor, s.x, s.count])).toEqual([
      ["lobby", 1, 160, 120],
      ["floor", 2, 160, 120],
      ["floor", 3, 160, 120],
    ]);
    expect([r.header.money, r.header.star, r.header.mode, r.header.pendingChoice]).toEqual([look(e).money, 3, "modern", null]);
    expect(r.tower.transports.map((t) => [t.kind, t.bottom, t.top, t.cars])).toEqual([["elevatorStandard", 1, 3, 1]]);
    for (let i = 0; i < 6; i++) {
      e.tick(60);
      r.update();
    }
    expect(r.header.minutes).toBe(look(e).clock.minutes);
    expect(r.crowd.people.length).toBe(look(e).crowd.people.length);
    expect(plain(r.rooms.map((u) => [u.state, u.occupants]))).toEqual(plain(roomsOf(e).map((u) => [u.state, u.occupants])));
  });

  it("finds the nearest structure tile on each side, where a bridge scan stops", () => {
    // The lobby and floors 2 and 3 span 160..279, the floor tiles under rooms
    // in runs of their own; floor 4 holds 160..169 and 180..189.
    const e = readerTower();
    const codes = new PortCodes(e);
    expect(e.chooseAutoBridge(false)[0]).toBe(1);
    const tiles = Float64Array.from([...Array(10).keys()].flatMap((i) => [160 + i, 180 + i]));
    expect(codes.slot(e.paintTiles(codes.kind("floor"), 4, tiles), "paintTiles", "placed")).toBe(20);
    const r = newViewReader(e);
    expect([r.structureBeside(4, 175, -1), r.structureBeside(4, 175, 1)]).toEqual([{ x: 169, kind: "floor" }, { x: 180, kind: "floor" }]);
    expect([r.structureBeside(2, 169, 1), r.structureBeside(2, 171, -1)]).toEqual([{ x: 170, kind: "floor" }, { x: 170, kind: "floor" }]);
    expect([r.structureBeside(1, 0, -1), r.structureBeside(1, 374, 1)]).toEqual([undefined, undefined]);
    expect([r.structureBeside(1, 100, 1), r.structureBeside(1, 100, -1)]).toEqual([{ x: 160, kind: "lobby" }, undefined]);
    expect([r.structureBeside(1, 200, -1), r.structureBeside(1, 200, 1)]).toEqual([{ x: 199, kind: "lobby" }, { x: 201, kind: "lobby" }]);
    expect([r.structureBeside(3, 300, -1), r.structureBeside(3, 300, 1)]).toEqual([{ x: 279, kind: "floor" }, undefined]);
    expect([r.structureBeside(2, 160, -1), r.structureBeside(2, 279, 1), r.structureBeside(9, 200, 1)]).toEqual([undefined, undefined, undefined]);
  });

  it("answers the point lookups and the expanded units", () => {
    const e = readerTower();
    const r = newViewReader(e);
    const office = r.rooms.find((u) => u.kind === "office")!;
    expect(r.tower.getUnit(office.id)).toBe(office);
    expect(r.tower.unitAt(2, office.x + 1)).toBe(office);
    const tile = r.tower.unitAt(2, 250)!;
    expect([tile.kind, tile.x, Number.isNaN(tile.id)]).toEqual(["floor", 250, true]);
    expect(r.tower.unitAt(2, 400)).toBeUndefined();
    expect(r.tower.unitAt(9, 200)).toBeUndefined();
    expect([r.tower.hasStructure(1, 200), r.tower.structureKindAt(1, 200), r.tower.hasStructure(5, 200)]).toEqual([true, "lobby", false]);
    expect(r.tower.getTransport(r.tower.transports[0].id)).toBe(r.tower.transports[0]);
    expect(r.tower.units.length).toBe(look(e).tower.units.length);
    expect(r.tower.units).toBe(r.tower.units);
    expect([r.tower.highestFloor, r.tower.lowestFloor]).toEqual([look(e).tower.highestFloor, 1]);
  });

  it("keeps rooms across a rebuild and reads the meta log's edits", () => {
    const e = readerTower();
    const codes = new PortCodes(e);
    const r = newViewReader(e);
    const kept = r.rooms;
    const office = kept.find((u) => u.kind === "office")!;
    e.labelUnit(office.id, "Corner");
    r.update();
    expect(r.rooms).toBe(kept);
    expect(office.label).toBe("Corner");
    expect(e.buildAt(codes.kind("office"), 3, 220)[0]).toBe(1);
    r.update();
    expect(r.rooms).not.toBe(kept);
    expect(r.tower.getUnit(office.id)).toBe(office);
    expect(r.rooms.length).toBe(kept.length + 1);
    e.nameTower("Spire");
    expect(r.tower.towerName).toBe("Spire");
  });

  it("starts again on a swap, with the camera the save carries", () => {
    const e = readerTower();
    e.setCamera(200, 2, 1.5);
    const save = e.serialize();
    const r = newViewReader(e);
    const person = () => r.crowd.people[0];
    e.tick(480);
    r.update();
    const before = r.rooms;
    const first = person();
    expect(e.loadSave(save)[0]).toBe(1);
    r.update();
    expect(r.rooms).not.toBe(before);
    expect(r.header.camera).toEqual({ tile: 200, floor: 2, zoom: 1.5 });
    e.tick(480);
    r.update();
    if (first) expect(person()).not.toBe(first);
  });

  it("takes a full frame after another caller took one", () => {
    const e = readerTower();
    const r = newViewReader(e);
    for (let i = 0; i < 4; i++) {
      e.tick(45);
      e.viewFrame(false);
      r.update();
      expect(plain(r.rooms.map((u) => [u.state, u.occupants]))).toEqual(plain(roomsOf(e).map((u) => [u.state, u.occupants])));
    }
  });

});

describe.skipIf(noEngine)("Cards.unit on the engine", () => {
  it("decodes the unit the engine holds", () => {
    const e = cardTower();
    const { cards } = cardsOf(e);
    const office = unitOf(e, "office");
    const card = cards.unit(office.id as number)!;
    expect([card.id, card.kind, card.floor, card.x, card.width, card.state]).toEqual([office.id, "office", 2, 170, office.width, office.state]);
    expect([card.label, card.subtype, card.noRate, card.everOccupied, card.filmPolicy, card.blockbuster]).toEqual(["Office", null, false, false, null, null]);
    expect([card.served, card.reachable, card.floorHasLobby]).toEqual([look(e).tower.isFloorServed(2), true, look(e).tower.floorHasLobby(2)]);
    expect(card.price).toBe(unitPrice(catalogOn(e, "modern"), { kind: "office" as FacilityKind }));
  });

  it("carries a cinema's film policy and booking, and a renamed unit's label", () => {
    const e = cardTower();
    const { cards } = cardsOf(e);
    const codes = new PortCodes(e);
    const cinema = unitOf(e, "cinema") as { id: number };
    expect(cards.unit(cinema.id)!.blockbuster).toBe(false);
    expect(e.setFilm(cinema.id, codes.code("filmPolicies", "blockbuster"))[0]).toBe(1);
    expect(cards.unit(cinema.id)!.filmPolicy).toBe("blockbuster");
    expect(e.labelUnit(cinema.id, "Odeon")[0]).toBe(1);
    expect(cards.unit(cinema.id)!.label).toBe("Odeon");
  });

  it("answers undefined for an id that names no unit", () => {
    const { cards } = cardsOf(cardTower());
    expect(cards.unit(99_999)).toBeUndefined();
    expect(cards.unit(NaN)).toBeUndefined();
  });
});

describe.skipIf(noEngine)("Cards.shaft on the engine", () => {
  it("decodes the shaft, its stop rows top first, and the demand it holds", () => {
    const e = cardTower();
    const { cards } = cardsOf(e);
    const lift = shaftOf(e, "elevatorStandard") as { id: number; cars: number };
    const card = cards.shaft(lift.id)!;
    expect([card.kind, card.x, card.bottom, card.top, card.cars]).toEqual(["elevatorStandard", 162, 1, 3, lift.cars]);
    expect(card.capacity).toBeGreaterThan(0);
    expect(card.stops.map((s) => s.floor)).toEqual([3, 2, 1]);
    expect(card.stops.map((s) => [s.served, s.lobby, s.endpoint])).toEqual([
      [true, false, true],
      [true, false, false],
      [true, true, true],
    ]);
    expect([card.hourly, card.origins]).toEqual([null, null]);
  });

  it("decodes the hourly load and the origin pairs once the engine has them", () => {
    const e = cardTower();
    const { cards } = cardsOf(e);
    const lift = shaftOf(e, "elevatorStandard") as { id: number };
    const weekday = Array.from({ length: 24 }, (_, h) => h / 24);
    const ring = (): [number, number][][] => Array.from({ length: 24 }, () => []);
    const origins = { weekday: ring(), weekend: ring() };
    origins.weekday[8] = [[1, 5], [2, 3]];
    origins.weekend[20] = [[3, 7]];
    const telemetry = e as unknown as { elevatorTelemetry(): string; seedElevatorTelemetry(json: string): void };
    const doc = JSON.parse(telemetry.elevatorTelemetry()) as Record<string, unknown>;
    telemetry.seedElevatorTelemetry(JSON.stringify({ ...doc, hourly: [[lift.id, { weekday, weekend: weekday.map((v) => 1 - v) }]], origins: [[lift.id, origins]] }));
    const card = cards.shaft(lift.id)!;
    expect(card.hourly).toEqual({ weekday, weekend: weekday.map((v) => 1 - v) });
    expect(card.origins!.weekday[8]).toEqual([[1, 5], [2, 3]]);
    expect(card.origins!.weekend[20]).toEqual([[3, 7]]);
    expect(card.origins!.weekday[0]).toEqual([]);
    expect(card.origins!.weekday).toHaveLength(24);
    expect(card.origins!.weekend).toHaveLength(24);
  });

  it("lists no stops for stairs and answers undefined for an unknown shaft", () => {
    const e = cardTower();
    const { cards } = cardsOf(e);
    const stairs = shaftOf(e, "stairs") as { id: number };
    expect(cards.shaft(stairs.id)!.stops).toEqual([]);
    expect(cards.shaft(99_999)).toBeUndefined();
  });

  it("keeps a card until a command says it changed, the revision moves or the hour turns", () => {
    const e = cardTower();
    const { cards, reader } = cardsOf(e);
    const codes = new PortCodes(e);
    const lift = shaftOf(e, "elevatorStandard") as { id: number };
    const first = cards.shaft(lift.id)!;
    expect(cards.shaft(lift.id)).toBe(first);
    expect(e.changeCars(lift.id, true)[0]).toBe(1);
    expect(cards.shaft(lift.id)).toBe(first); // still the kept card
    cards.forget();
    const second = cards.shaft(lift.id)!;
    expect(second).not.toBe(first);
    expect(second.cars).toBe(first.cars + 1);
    expect(second.capacity).toBeGreaterThan(first.capacity);
    // The reader seeing a new revision drops the kept card.
    expect(e.buildAt(codes.kind("office"), 3, 190)[0]).toBe(1);
    reader.update();
    expect(cards.shaft(lift.id)).not.toBe(second);
    // So does the hour turning.
    const third = cards.shaft(lift.id)!;
    e.tick(61);
    reader.update();
    expect(cards.shaft(lift.id)).not.toBe(third);
  });

  it("follows a mark and a clear of the stops", () => {
    const e = cardTower();
    const { cards } = cardsOf(e);
    const lift = shaftOf(e, "elevatorStandard") as { id: number };
    expect(e.markStop(lift.id, 2, false)[0]).toBe(1);
    cards.forget();
    expect(cards.shaft(lift.id)!.stops.map((s) => s.served)).toEqual([true, false, true]);
    expect(e.dropStops(lift.id)[0]).toBe(1);
    cards.forget();
    expect(cards.shaft(lift.id)!.stops.every((s) => s.served)).toBe(true);
  });
});

describe.skipIf(noEngine)("scheduleSlots on the engine", () => {
  it("fills the layout's slots and the engine stores the schedule it reads back", () => {
    const e = cardTower();
    const lift = shaftOf(e, "elevatorStandard") as { id: number };
    for (let i = 0; i < 2; i++) expect(e.changeCars(lift.id, true)[0]).toBe(1); // 3 cars, so the hours are not clamped
    const slots = scheduleSlots({
      activeCars: { weekday: Array(24).fill(2), weekend: Array(24).fill(1) },
      waitingCarResponse: 6,
      standardFloorDeparture: 40,
      homeFloors: [1, 2],
    });
    expect(slots).toHaveLength(JSON.parse(e.viewLayout()).scheduleSlots);
    expect(e.scheduleShaft(lift.id, slots)[0]).toBe(1);
    expect(look(e).tower.getTransport(lift.id)!.schedule).toMatchObject({
      activeCars: { weekday: Array(24).fill(2), weekend: Array(24).fill(1) },
      waitingCarResponse: 6,
      standardFloorDeparture: 40,
      homeFloors: [1, 2],
    });
  });
});
