import { Simulation } from "../../engine/Simulation";
import { FACILITIES } from "../../engine/facilities";
import type { FacilityKind, Unit } from "../../engine/types";
import { must } from "./fixtureTowers";

/**
 * A hotel-heavy Modern tower for the housekeeping dispatch (issue #1279, the
 * Rust step hotspots lane's item 6). The large tower has no housekeeping units
 * at all, so nothing in the comparison exercises the morning checkout, the
 * dispatch of maids to dirty rooms, or a staff network that does not reach
 * every floor. This one does:
 *
 *  - several hundred hotel rooms (single, double and suite in a repeating run),
 *    all occupied overnight, so the 8:00 checkout makes them dirty at once;
 *  - 24 housekeeping units, in two of three service-elevator zones;
 *  - the third zone, and the stories between zones, have no crew and no staff
 *    link, so `staffConnected` fails for a third of the dirty rooms on every
 *    dispatch and those rooms stay dirty through the shift;
 *  - a low wing beside the tower, joined to it only along the lobby row and
 *    cut from the tower's floors by a gap. Its stories are in a crewed zone, so
 *    `staffConnected` (which is per story) says yes, but the staff route is per
 *    floor segment and the wing has no staff transport, so every dispatch to its
 *    rooms ends in `no-route`.
 *
 * Guests ride the standard elevators, which serve every floor; only the staff
 * network is split. Built through the engine's own commands and asserted, like
 * the other fixture towers.
 */

export interface HotelSpec {
  seed: number;
  /** Top story; the hotel runs on stories 2 to here. */
  floors: number;
  /** Housekeeping units to place, split between the first two zones. */
  crews: number;
}

const LEFT = 120;
const RIGHT = 260;
/** Rooms start clear of the passenger and service shaft columns. */
const ROOMS_FROM = LEFT + 32;
/** The run of rooms on a story, then the slot a housekeeping unit takes. */
const RUN: readonly FacilityKind[] = ["hotelSingle", "hotelDouble", "hotelSuite"];
const RUNS_PER_FLOOR = 4;
/** The wing stands past a gap at the tower's right edge, on stories 2 to
 *  `WING_TOP`, which all lie in the first service zone. */
const WING_FROM = RIGHT + 10;
const WING_TO = WING_FROM + RUNS_PER_FLOOR * 20;
const WING_TOP = 11;

/** The three staff zones: a service shaft each, a story apart so they never link. */
function zonesOf(floors: number): [number, number][] {
  const span = Math.floor((floors - 2) / 3) - 1;
  return [0, 1, 2].map((i): [number, number] => {
    const bottom = 2 + i * (span + 1);
    return [bottom, bottom + span - 1];
  });
}

export function buildHotelTower(spec: HotelSpec): Simulation {
  const sim = Simulation.newGame(spec.seed, "modern");
  const t = sim.tower;
  sim.money = 1_000_000_000;
  // Hotel suites and the service elevator need stars the tower does not earn
  // by being empty; the harness measures cost, not the unlock path.
  sim.star = 5;
  for (let x = LEFT; x < RIGHT; x++) must(`hotel: lobby at ${x}`, t.place("lobby", 1, x));
  for (let f = 2; f <= spec.floors; f++) for (let x = LEFT; x < RIGHT; x++) must(`hotel: floor ${f} at ${x}`, t.place("floor", f, x));
  const w = FACILITIES.elevatorStandard.width;
  for (let bottom = 1, band = 0; bottom < spec.floors; bottom += 29, band++) {
    const top = Math.min(bottom + 29, spec.floors);
    for (const x of [LEFT + band * w, RIGHT - w - band * w]) must(`hotel: elevator ${bottom}-${top} at ${x}`, t.placeTransport("elevatorStandard", x, bottom, top));
  }
  const zones = zonesOf(spec.floors);
  // The lobby row runs on under the wing, which is all that joins the two.
  for (let x = RIGHT; x < WING_TO; x++) must(`hotel: lobby at ${x}`, t.place("lobby", 1, x));
  for (let f = 2; f <= WING_TOP; f++) for (let x = WING_FROM; x < WING_TO; x++) must(`hotel: wing floor ${f} at ${x}`, t.place("floor", f, x));
  for (const [bottom, top] of zones) must(`hotel: service ${bottom}-${top}`, t.placeTransport("elevatorService", LEFT + 16, bottom, top));

  // Crews sit on the first two zones' stories, spread evenly; the last zone has none.
  const crewFloors = new Set<number>();
  const perZone = [Math.ceil(spec.crews / 2), Math.floor(spec.crews / 2)];
  zones.slice(0, 2).forEach(([bottom, top], z) => {
    const n = perZone[z];
    for (let i = 0; i < n; i++) crewFloors.add(bottom + Math.floor(((top - bottom) * (i + 0.5)) / n));
  });
  /** A story's run of rooms from `from`; returns the x just past it. */
  const placeRun = (f: number, from: number): number => {
    let cx = from;
    for (let r = 0; r < RUNS_PER_FLOOR; r++) {
      for (const kind of RUN) {
        must(`hotel: ${kind} at ${f}, ${cx}`, t.place(kind, f, cx));
        cx += FACILITIES[kind].width;
      }
    }
    return cx;
  };
  let placed = 0;
  for (let f = 2; f <= spec.floors; f++) {
    const cx = placeRun(f, ROOMS_FROM);
    if (f <= WING_TOP) placeRun(f, WING_FROM);
    if (crewFloors.has(f)) {
      must(`hotel: housekeeping at ${f}, ${cx}`, t.place("housekeeping", f, cx));
      placed++;
    }
  }
  if (placed !== spec.crews) throw new Error(`hotel: placed ${placed} housekeeping units, wanted ${spec.crews}`);

  // Every guest room is booked: asleep at the start, so the checkout is the
  // first thing the day does.
  for (const u of t.units) {
    if (u.kind === "hotelSingle" || u.kind === "hotelDouble" || u.kind === "hotelSuite") sleep(u);
  }
  sim.evaluateStar();
  return sim;
}

const sleep = (u: Unit): void => {
  u.state = "asleep";
  u.occupants = FACILITIES[u.kind].population;
  u.everOccupied = true;
  u.satisfaction = 1;
};
