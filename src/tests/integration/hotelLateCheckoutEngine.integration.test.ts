import { expect, it } from "vitest";
import { FACILITIES } from "../../engine/facilities";
import { HK_CHECKOUT_HOUR, HK_LATE_CHECKOUT_HOUR } from "../../engine/EconomySystem";
import { PortSim, describeEngines, type Leg, draftTower } from "../portKit/portSim";

/**
 * #304 understaffed housekeeping (AC8) on both engines: a Modern late-checkout
 * room with no maid stays dirty for the rest of the day and is never re-let,
 * like a morning-dirtied room. The other late-checkout cases stay in
 * `hotelLateCheckout.integration.test.ts`; `hotelTower` mirrors that file's
 * copy (change both together). It builds the same tower, with the mode fixed
 * to Modern, and hands back a `PortSim` built from the draft.
 *
 * The original called `economy.hotelCheckout()` and `hotelLateCheckout()` on a
 * TypeScript instance. Here the engine runs them itself, from its hourly
 * dispatch: the clock is put one minute before the checkout hour and then the
 * late-checkout hour, and one tick crosses into each.
 */

const HOTEL_KIND = "hotelSingle";
const ROOMS = 10;
/** The first hour of the evening window in which an empty hotel room can be
 *  let (`Clock.isEvening`: the hours 17 to 20). */
const EVENING_FILL_HOUR = 17;
/** The last hour both tests step into, as the original's run did. */
const LAST_HOUR = 22;

/** A hotel wing of `rooms` asleep rooms on floors 2 and 3, a lunch restaurant on
 *  4 and one elevator, as the original's fixture builds it (no housekeeping). */
function hotelTower(leg: Leg, rooms: number, seed = 2024): PortSim {
  const draft = draftTower(seed, "modern", "realWorld");
  draft.money = 1_000_000;
  draft.star = 3;
  for (let x = 0; x < 40; x++) expect(draft.tower.place("lobby", 1, x).ok).toBe(true);
  for (let f = 2; f <= 4; f++) {
    for (let x = 0; x < 40; x++) expect(draft.tower.place("floor", f, x).ok).toBe(true);
  }
  expect(draft.tower.placeTransport("elevatorStandard", 38, 1, 4).ok).toBe(true);
  const rest = draft.tower.place("restaurant", 4, 0);
  expect(rest.ok, `restaurant placed: ${rest.reason}`).toBe(true);
  draft.tower.units.find((u) => u.id === rest.unitId)!.state = "occupied";
  const HOTEL_W = FACILITIES[HOTEL_KIND].width;
  let placed = 0;
  for (let f = 2; f <= 3 && placed < rooms; f++) {
    for (let x = 10; x + HOTEL_W <= 40 && placed < rooms; x += HOTEL_W) {
      const r = draft.tower.place(HOTEL_KIND, f, x);
      expect(r.ok, `hotel room placed: ${r.reason}`).toBe(true);
      draft.tower.units.find((u) => u.id === r.unitId)!.state = "asleep";
      placed++;
    }
  }
  expect(placed).toBe(rooms);
  return new PortSim(leg, draft);
}

function hotelRoomsIn(sim: PortSim, state: "asleep" | "dirty"): number {
  return sim.state.tower.units.filter((u) => u.kind === HOTEL_KIND && u.state === state).length;
}

/** Cross into `hour` with one tick from the minute before it, so the engine's
 *  own hourly dispatch runs that hour's work. */
function enterHour(sim: PortSim, hour: number): void {
  sim.setClock(hour * 60 - 1); // throws if the engine refuses
  sim.tick(1);
  expect(sim.state.clock.minutes, `the tick crossed into ${hour}:00`).toBe(hour * 60);
}

/** Each hotel room's state by id, to show nothing changed across a stretch. */
function hotelStates(sim: PortSim): Map<number, string> {
  return new Map(sim.state.tower.units.filter((u) => u.kind === HOTEL_KIND).map((u) => [u.id, u.state]));
}

describeEngines("understaffed housekeeping: late-checkout rooms behave like ordinary dirty rooms (AC8)", (leg: Leg) => {
  it("without a maid the afternoon-dirtied rooms stay dirty and are not re-let", () => {
    const sim = hotelTower(leg, ROOMS); // no housekeeping unit placed
    enterHour(sim, HK_CHECKOUT_HOUR);
    const deferred = hotelRoomsIn(sim, "asleep");
    expect(deferred, "some guests took a late checkout").toBeGreaterThan(0);
    expect(deferred, "and the rest checked out this morning").toBeLessThan(ROOMS);
    expect(hotelRoomsIn(sim, "dirty"), "each morning checkout left its room dirty").toBe(ROOMS - deferred);
    enterHour(sim, HK_LATE_CHECKOUT_HOUR);
    expect(hotelRoomsIn(sim, "dirty")).toBe(ROOMS); // every room now dirty
    const afterLateCheckout = hotelStates(sim);
    // Run the day through 22:00 with no housekeeping: dirty rooms cannot
    // self-clean and a dirty room cannot be re-let, like a morning-dirtied room.
    for (let h = HK_LATE_CHECKOUT_HOUR + 1; h <= LAST_HOUR; h++) {
      enterHour(sim, h);
      // Checked every hour, so a room cleaned and re-dirtied in between still trips.
      expect(hotelStates(sim), `no hotel room changed state by ${h}:00`).toEqual(afterLateCheckout);
    }
    // The original's closing asserts, kept as they were.
    expect(hotelRoomsIn(sim, "dirty")).toBe(ROOMS); // still dirty, none turned over or re-let
    expect(hotelRoomsIn(sim, "asleep")).toBe(0); // and none re-filled (dirty blocks evening fill)
  });

  it("control: on the same stepping, at least one clean room is re-let in the evening", () => {
    const sim = hotelTower(leg, ROOMS);
    enterHour(sim, HK_CHECKOUT_HOUR);
    enterHour(sim, HK_LATE_CHECKOUT_HOUR);
    expect(hotelRoomsIn(sim, "dirty"), "every room is dirty before the writes").toBe(ROOMS);
    // Four clean rooms: each rolls 0.5 × demand (1.0 at the default rent) once
    // per evening hour, 17 to 20 (`churn.ts:267`), so a seed or RNG-stream change
    // is unlikely to leave all four unlet.
    const CLEANED = 4;
    const ids = sim.state.tower.units.filter((u) => u.kind === HOTEL_KIND).slice(0, CLEANED).map((u) => u.id);
    const allEmpty = ids.map(() => "empty");
    for (const id of ids) sim.setUnitState(id, "empty");
    const cleanedStates = () => ids.map((id) => hotelStates(sim).get(id));
    expect(cleanedStates(), "the writes took").toEqual(allEmpty);
    for (let h = HK_LATE_CHECKOUT_HOUR + 1; h <= LAST_HOUR; h++) {
      enterHour(sim, h);
      if (h < EVENING_FILL_HOUR) expect(cleanedStates(), `no cleaned room is let by ${h}:00`).toEqual(allEmpty);
    }
    // The evening fill runs on this stepping, so in the case above it is the dirt
    // that keeps the rooms from being re-let.
    const states = hotelStates(sim);
    expect(ids.some((id) => states.get(id) === "asleep"), "a clean room was re-let").toBe(true);
    const others = [...states].filter(([id]) => !ids.includes(id)).map(([, state]) => state);
    expect(others, "every room left dirty is still dirty").toEqual(others.map(() => "dirty"));
    expect(others).toHaveLength(ROOMS - CLEANED);
  });
});
