import { describe, expect, it } from "vitest";
import { Simulation } from "../engine/Simulation";
import { TsEngine } from "../engine/port/tsEngine";
import { towerCatalog } from "../engine/towerCatalog";
import { unitPrice } from "../ui/catalogPricing";
import { Cards } from "./cards";
import { PortCodes } from "./portCodes";
import { scheduleSlots } from "./scheduleSlots";
import { ViewReader } from "./viewReader";

/**
 * The card decoders over `TsEngine` alone, in the `unit` project, so they are
 * covered where no WASM package is built.
 */

function engine(): TsEngine {
  const sim = Simulation.newGame(5, "modern");
  sim.money = 1e8;
  sim.star = 3;
  for (let x = 160; x < 280; x++) expect(sim.build("lobby", 1, x).ok).toBe(true);
  for (const floor of [2, 3]) for (let x = 160; x < 280; x++) expect(sim.build("floor", floor, x).ok).toBe(true);
  expect(sim.build("office", 2, 170).ok).toBe(true);
  expect(sim.build("cinema", 2, 200).ok).toBe(true);
  expect(sim.buildTransport("elevatorStandard", 162, 1, 3).ok).toBe(true);
  expect(sim.buildTransport("stairs", 230, 1, 2).ok).toBe(true);
  return new TsEngine(sim);
}

function cardsOf(e: TsEngine): { cards: Cards; reader: ViewReader } {
  const reader = new ViewReader(e);
  return { cards: new Cards(e, reader), reader };
}

describe("Cards.unit", () => {
  it("decodes the unit the simulation holds", () => {
    const e = engine();
    const { cards } = cardsOf(e);
    const office = e.sim.tower.units.find((u) => u.kind === "office")!;
    const card = cards.unit(office.id)!;
    expect([card.id, card.kind, card.floor, card.x, card.width, card.state]).toEqual([office.id, "office", 2, 170, office.width, office.state]);
    expect([card.label, card.subtype, card.noRate, card.everOccupied, card.filmPolicy, card.blockbuster]).toEqual([office.label, null, false, false, null, null]);
    expect([card.served, card.reachable, card.floorHasLobby]).toEqual([e.sim.tower.isFloorServed(2), e.sim.floorReachable(2), e.sim.tower.floorHasLobby(2)]);
    expect(card.price).toBe(unitPrice(towerCatalog(e.sim), office));
  });

  it("carries a cinema's film policy and booking, and a renamed unit's label", () => {
    const e = engine();
    const { cards } = cardsOf(e);
    const codes = new PortCodes(e);
    const cinema = e.sim.tower.units.find((u) => u.kind === "cinema")!;
    expect(cards.unit(cinema.id)!.blockbuster).toBe(e.sim.isShowingBlockbuster(cinema.id));
    expect(e.setFilm(cinema.id, codes.code("filmPolicies", "blockbuster"))[0]).toBe(1);
    expect(cards.unit(cinema.id)!.filmPolicy).toBe("blockbuster");
    expect(e.labelUnit(cinema.id, "Odeon")[0]).toBe(1);
    expect(cards.unit(cinema.id)!.label).toBe("Odeon");
  });

  it("answers undefined for an id that names no unit", () => {
    const { cards } = cardsOf(engine());
    expect(cards.unit(99_999)).toBeUndefined();
    expect(cards.unit(NaN)).toBeUndefined();
  });
});

describe("Cards.shaft", () => {
  it("decodes the shaft, its stop rows top first, and the demand it holds", () => {
    const e = engine();
    const { cards } = cardsOf(e);
    const lift = e.sim.tower.transports.find((t) => t.kind === "elevatorStandard")!;
    const card = cards.shaft(lift.id)!;
    expect([card.kind, card.x, card.bottom, card.top, card.cars, card.capacity]).toEqual(["elevatorStandard", 162, 1, 3, lift.cars, e.sim.transportCapacity(lift)]);
    expect(card.stops.map((s) => s.floor)).toEqual([3, 2, 1]);
    expect(card.stops.map((s) => [s.served, s.lobby, s.endpoint])).toEqual([
      [true, false, true],
      [true, false, false],
      [true, true, true],
    ]);
    expect([card.hourly, card.origins]).toEqual([null, null]);
  });

  it("decodes the hourly load and the origin pairs once the simulation has them", () => {
    const e = engine();
    const { cards } = cardsOf(e);
    const lift = e.sim.tower.transports.find((t) => t.kind === "elevatorStandard")!;
    const weekday = Array.from({ length: 24 }, (_, h) => h / 24);
    e.sim.elevatorHourly.set(lift.id, { weekday, weekend: weekday.map((v) => 1 - v) });
    const rings = { weekday: Array.from({ length: 24 }, () => new Map<number, number>()), weekend: Array.from({ length: 24 }, () => new Map<number, number>()) };
    rings.weekday[8].set(1, 5).set(2, 3);
    rings.weekend[20].set(3, 7);
    e.sim.elevatorOrigins.set(lift.id, rings);
    const card = cards.shaft(lift.id)!;
    expect(card.hourly).toEqual({ weekday, weekend: weekday.map((v) => 1 - v) });
    expect(card.origins!.weekday[8]).toEqual([[1, 5], [2, 3]]);
    expect(card.origins!.weekend[20]).toEqual([[3, 7]]);
    expect(card.origins!.weekday[0]).toEqual([]);
    expect(card.origins!.weekday).toHaveLength(24);
    expect(card.origins!.weekend).toHaveLength(24);
  });

  it("lists no stops for stairs and answers undefined for an unknown shaft", () => {
    const e = engine();
    const { cards } = cardsOf(e);
    const stairs = e.sim.tower.transports.find((t) => t.kind === "stairs")!;
    expect(cards.shaft(stairs.id)!.stops).toEqual([]);
    expect(cards.shaft(99_999)).toBeUndefined();
  });

  it("keeps a card until a command says it changed, the revision moves or the hour turns", () => {
    const e = engine();
    const { cards, reader } = cardsOf(e);
    const lift = e.sim.tower.transports.find((t) => t.kind === "elevatorStandard")!;
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
    expect(e.sim.build("office", 3, 190).ok).toBe(true);
    reader.update();
    expect(cards.shaft(lift.id)).not.toBe(second);
    // So does the hour turning.
    const third = cards.shaft(lift.id)!;
    e.tick(61);
    reader.update();
    expect(cards.shaft(lift.id)).not.toBe(third);
  });

  it("follows a mark and a clear of the stops", () => {
    const e = engine();
    const { cards } = cardsOf(e);
    const lift = e.sim.tower.transports.find((t) => t.kind === "elevatorStandard")!;
    expect(e.markStop(lift.id, 2, false)[0]).toBe(1);
    cards.forget();
    expect(cards.shaft(lift.id)!.stops.map((s) => s.served)).toEqual([true, false, true]);
    expect(e.dropStops(lift.id)[0]).toBe(1);
    cards.forget();
    expect(cards.shaft(lift.id)!.stops.every((s) => s.served)).toBe(true);
  });
});

describe("scheduleSlots", () => {
  it("fills the layout's slots and the engine stores the schedule it reads back", () => {
    const e = engine();
    const lift = e.sim.tower.transports.find((t) => t.kind === "elevatorStandard")!;
    for (let i = 0; i < 2; i++) expect(e.changeCars(lift.id, true)[0]).toBe(1); // 3 cars, so the hours are not clamped
    const slots = scheduleSlots({
      activeCars: { weekday: Array(24).fill(2), weekend: Array(24).fill(1) },
      waitingCarResponse: 6,
      standardFloorDeparture: 40,
      homeFloors: [1, 2],
    });
    expect(slots).toHaveLength(JSON.parse(e.viewLayout()).scheduleSlots);
    expect(e.scheduleShaft(lift.id, slots)[0]).toBe(1);
    expect(e.sim.tower.getTransport(lift.id)!.schedule).toMatchObject({
      activeCars: { weekday: Array(24).fill(2), weekend: Array(24).fill(1) },
      waitingCarResponse: 6,
      standardFloorDeparture: 40,
      homeFloors: [1, 2],
    });
  });

  it("marks an absent row, timing or home list, and pads a short row", () => {
    const slots = scheduleSlots({ activeCars: { weekday: [3] } });
    expect([slots[0], slots[1], slots[2]]).toEqual([1, 3, 8]);
    expect(slots[25]).toBe(0);
    expect([slots[50], slots[51]].every(Number.isNaN)).toBe(true);
    expect(slots[52]).toBe(0);
    const empty = scheduleSlots({});
    expect([empty[0], empty[25], empty[52]]).toEqual([0, 0, 0]);
  });
});
