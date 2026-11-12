import { describe, expect, it, vi } from "vitest";
import { Cards } from "./cards";
import { scheduleSlots } from "./scheduleSlots";
import type { ViewReader } from "./viewReader";
import { LAYOUT, code, mockPort, record } from "../tests/portKit/mockPort";

/**
 * The card decoders over a mock port: the reads each card asks for, what it
 * decodes from records encoded from the engine's layout, and when a shaft card
 * is asked for again. The cards on the Rust engine run in
 * `portReader.integration.test.ts`.
 */

const HOURS = 24;

/** The reader fields the shaft card's cache keys on. */
function readerAt(revision: number, minuteOfDay: number) {
  return { tower: { revision }, header: { minuteOfDay } } as unknown as Pick<ViewReader, "tower" | "header"> & {
    tower: { revision: number };
    header: { minuteOfDay: number };
  };
}

const OFFICE = record("unitCard", {
  id: 10,
  kindCode: code("kinds", "office"),
  floor: 2,
  x: 170,
  width: 9,
  stateCode: code("unitStates", "vacating"),
  satisfaction: 0.4,
  occupants: 3,
  customersIn: NaN,
  residents: NaN,
  everOccupied: 1,
  noRate: 0,
  rent: 10_000,
  price: 40_000,
  vacateReason: code("vacateReasons", "noise"),
  filmPolicy: NaN,
  served: 1,
  reachable: 1,
  floorHasLobby: 0,
  blockbuster: NaN,
  filmDays: NaN,
  filmTier: NaN,
});

const CINEMA = record("unitCard", { id: 12, kindCode: code("kinds", "cinema"), rent: NaN, vacateReason: NaN, filmPolicy: code("filmPolicies", "blockbuster"), blockbuster: 1, filmDays: 4, filmTier: code("filmTiers", "classic") });

/** A stop row: floor, then the served, lobby and endpoint flags. */
const stop = (floor: number, served: number, lobby: number, endpoint: number) => [floor, served, lobby, endpoint];

describe("Cards.unit", () => {
  it("decodes the unit card, reading its label and subtype", () => {
    const port = mockPort({ unitCard: () => OFFICE, unitLabel: () => "Corner", unitSubtype: () => undefined });
    const card = new Cards(port, readerAt(1, 0)).unit(10)!;
    expect(card).toEqual({
      id: 10,
      kind: "office",
      floor: 2,
      x: 170,
      width: 9,
      state: "vacating",
      satisfaction: 0.4,
      occupants: 3,
      customersIn: null,
      residents: null,
      everOccupied: true,
      noRate: false,
      rent: 10_000,
      price: 40_000,
      label: "Corner",
      subtype: null,
      vacateReason: "noise",
      filmPolicy: null,
      served: true,
      reachable: true,
      floorHasLobby: false,
      blockbuster: null,
      filmDays: null,
      filmTier: null,
    });
    expect(vi.mocked(port.unitCard).mock.calls).toEqual([[10]]);
    expect(vi.mocked(port.unitLabel).mock.calls).toEqual([[10]]);
    expect(vi.mocked(port.unitSubtype).mock.calls).toEqual([[10]]);
  });

  it("carries a cinema's film policy, booking and film, and an empty label when the engine has none", () => {
    const port = mockPort({ unitCard: () => CINEMA, unitLabel: () => undefined, unitSubtype: () => "art house" });
    const card = new Cards(port, readerAt(1, 0)).unit(12)!;
    expect([card.filmPolicy, card.blockbuster, card.rent, card.vacateReason, card.label, card.subtype]).toEqual(["blockbuster", true, null, null, "", "art house"]);
    expect([card.filmDays, card.filmTier]).toEqual([4, "classic"]);
  });

  it("answers undefined for an id the engine has no card for, reading no text", () => {
    const port = mockPort({ unitCard: () => new Float64Array(0) });
    expect(new Cards(port, readerAt(1, 0)).unit(99_999)).toBeUndefined();
    expect(port.unitCard).toHaveBeenCalledOnce();
  });
});

describe("Cards.shaft", () => {
  const head = { id: 20, kindCode: code("kinds", "elevatorStandard"), x: 162, width: 4, bottom: 1, top: 3, cars: 2, capacity: 42, utilization: 0.5, nearCapacity: 1 };
  const weekday = Array.from({ length: HOURS }, (_, h) => h / HOURS);
  const weekend = weekday.map((v) => 1 - v);

  it("decodes the head, the hourly load, the stop rows and the origin pairs", () => {
    // Weekday hour 8 holds two origin pairs, weekend hour 20 one, the rest none.
    // Each ring is its pair count, then the pairs.
    const filled = new Map([
      [8, [2, 1, 5, 2, 3]],
      [HOURS + 20, [1, 3, 7]],
    ]);
    const rings = Array.from({ length: 2 * HOURS }, (_, ring) => filled.get(ring) ?? [0]).flat();
    const tail = [...weekday, ...weekend, ...stop(3, 1, 0, 1), ...stop(2, 0, 0, 0), ...stop(1, 1, 1, 1), ...rings];
    const port = mockPort({ generation: () => 1, shaftCard: () => record("shaftCard", { ...head, hourly: 1, stops: 3, origins: 1 }, tail) });
    const card = new Cards(port, readerAt(1, 0)).shaft(20)!;
    expect([card.id, card.kind, card.x, card.width, card.bottom, card.top, card.cars, card.capacity, card.utilization, card.nearCapacity]).toEqual([20, "elevatorStandard", 162, 4, 1, 3, 2, 42, 0.5, true]);
    expect(card.hourly).toEqual({ weekday, weekend });
    expect(card.stops).toEqual([
      { floor: 3, served: true, lobby: false, endpoint: true },
      { floor: 2, served: false, lobby: false, endpoint: false },
      { floor: 1, served: true, lobby: true, endpoint: true },
    ]);
    expect([card.origins!.weekday[8], card.origins!.weekend[20], card.origins!.weekday[0]]).toEqual([[[1, 5], [2, 3]], [[3, 7]], []]);
    expect([card.origins!.weekday.length, card.origins!.weekend.length]).toEqual([HOURS, HOURS]);
    expect(vi.mocked(port.shaftCard).mock.calls).toEqual([[20]]);
  });

  it("answers null sections the engine does not hold, and undefined for an unknown shaft", () => {
    const port = mockPort({
      generation: () => 1,
      shaftCard: (id) => (id === 21 ? record("shaftCard", { ...head, id: 21, kindCode: code("kinds", "stairs"), utilization: NaN, nearCapacity: 0, hourly: 0, stops: 0, origins: 0 }) : new Float64Array(0)),
    });
    const cards = new Cards(port, readerAt(1, 0));
    const stairs = cards.shaft(21)!;
    expect([stairs.kind, stairs.utilization, stairs.nearCapacity, stairs.hourly, stairs.origins, stairs.stops]).toEqual(["stairs", null, false, null, null, []]);
    // An unknown shaft is not kept: each ask goes to the engine.
    expect([cards.shaft(99_999), cards.shaft(99_999)]).toEqual([undefined, undefined]);
    expect(vi.mocked(port.shaftCard).mock.calls).toEqual([[21], [99_999], [99_999]]);
  });

  it("keeps a card until a command says it changed, the tower swaps, the revision moves or the hour turns", () => {
    let gen = 1;
    const port = mockPort({ generation: () => gen, shaftCard: () => record("shaftCard", { ...head, hourly: 0, stops: 0, origins: 0 }) });
    const reader = readerAt(1, 60 * 7);
    const cards = new Cards(port, reader);
    const asks = () => vi.mocked(port.shaftCard).mock.calls.length;
    const first = cards.shaft(20)!;
    expect(cards.shaft(20)).toBe(first);
    reader.header.minuteOfDay = 60 * 7 + 59;
    expect([cards.shaft(20) === first, asks()]).toEqual([true, 1]);
    cards.forget();
    const second = cards.shaft(20)!;
    expect([second === first, asks()]).toEqual([false, 2]);
    reader.tower.revision = 2;
    const third = cards.shaft(20)!;
    expect([third === second, asks()]).toEqual([false, 3]);
    reader.header.minuteOfDay = 60 * 8;
    const fourth = cards.shaft(20)!;
    expect([fourth === third, asks()]).toEqual([false, 4]);
    gen = 2;
    expect([cards.shaft(20) === fourth, asks()]).toEqual([false, 5]);
  });
});

describe("scheduleSlots", () => {
  it("fills the layout's slot count", () => {
    const slots = scheduleSlots({ activeCars: { weekday: Array(24).fill(2), weekend: Array(24).fill(1) }, waitingCarResponse: 6, standardFloorDeparture: 40, homeFloors: [1, 2] });
    expect(slots).toHaveLength(LAYOUT.scheduleSlots);
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
