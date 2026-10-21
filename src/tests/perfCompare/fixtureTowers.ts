import { Simulation } from "../../engine/Simulation";
import { FACILITIES, GRID } from "../../engine/facilities";
import { isSkyLobbyFloor } from "../../engine/tower/towerTopology";
import type { FacilityKind, Unit } from "../../engine/types";

/**
 * Towers for the size-threshold run and the unit-count rows (issue #1270).
 * The comparison's three towers are all sized by people (small 729, medium
 * 3,240, large 17,322), but several costs scale with units: the engine reads
 * that walk every unit, the per-move scans, the host sending every unit every
 * frame, the hourly merge and the restore point (save size), the structural
 * snapshot and the load peak. A tower with many units and few people would pass
 * a population gate onto the slowest path, so these two kinds of tower sit
 * beside the three:
 *
 *  - two bracket towers between small and medium, so the size threshold can be
 *    read off a measured curve instead of guessed between two points;
 *  - a tower with the large tower's unit count and a population in the hundreds.
 *
 * Every placement goes through the engine's own `Tower` commands and is
 * asserted, so a rule or cap change that refuses one fails here instead of
 * quietly benchmarking a smaller tower than described.
 */

export const must = (label: string, r: { ok: boolean; reason?: string }): void => {
  if (!r.ok) throw new Error(`${label} refused: ${r.reason}`);
};

/** A person-bearing room kind. */
const isRoom = (u: Unit): boolean => u.kind === "office" || u.kind === "condo";

const occupy = (u: Unit): void => {
  u.state = "occupied";
  u.everOccupied = true;
  u.satisfaction = 1;
};

/** Mark rooms occupied, spread evenly through the tower, until the population
 *  reaches `target` (it lands within one room's worth above it). The rest stay
 *  vacant. Deterministic: the same tower and target give the same rooms. */
function occupyToward(sim: Simulation, target: number): void {
  const rooms = sim.tower.units.filter(isRoom);
  if (rooms.length === 0) throw new Error("no rooms to occupy");
  const step = Math.max(1, Math.floor(rooms.length / Math.max(1, Math.round(target / 5))));
  // Pass 1 takes every `step`th room; later passes fill the gaps until the target.
  for (let offset = 0; offset < step && sim.population < target; offset++) {
    for (let i = offset; i < rooms.length && sim.population < target; i += step) occupy(rooms[i]);
  }
  if (sim.population < target) throw new Error(`population ${sim.population} is short of ${target} with every room occupied`);
}

export interface BracketSpec {
  seed: number;
  /** Top floor; floors 2 to here are full-width. */
  floors: number;
  /** The population to occupy toward. */
  population: number;
}

/** A layered office-and-condo tower like the small one, taller and with a pair
 *  of standard shafts per 30-floor band, occupied to a chosen population. */
export function buildBracketTower(spec: BracketSpec): Simulation {
  const sim = Simulation.newGame(spec.seed, "classic");
  const t = sim.tower;
  sim.money = 1_000_000_000;
  const left = 120;
  const right = 260;
  for (let x = left; x < right; x++) must(`bracket: lobby at ${x}`, t.place("lobby", 1, x));
  for (let f = 2; f <= spec.floors; f++) for (let x = left; x < right; x++) must(`bracket: floor ${f} at ${x}`, t.place("floor", f, x));
  const w = FACILITIES.elevatorStandard.width;
  // Bands share their boundary floor, so each band's pair sits one shaft width
  // further in, or the shafts would overlap there.
  for (let bottom = 1, band = 0; bottom < spec.floors; bottom += 29, band++) {
    const top = Math.min(bottom + 29, spec.floors);
    for (const x of [left + band * w, right - w - band * w]) must(`bracket: elevator ${bottom}-${top} at ${x}`, t.placeTransport("elevatorStandard", x, bottom, top));
  }
  for (let f = 3; f <= spec.floors; f++) {
    const kind: FacilityKind = f % 3 === 0 ? "condo" : "office";
    const kw = FACILITIES[kind].width;
    for (let x = left + 8; x + kw <= right - 8; x += kw) must(`bracket: ${kind} at ${f}, ${x}`, t.place(kind, f, x));
  }
  occupyToward(sim, spec.population);
  sim.evaluateStar();
  return sim;
}

export interface ManyUnitSpec {
  seed: number;
  /** The population to occupy toward; the rest of the rooms stay vacant. */
  population: number;
}

/** The elevator bands that chain service from the first basement to the roof,
 *  each at most the standard shaft's 30-floor span. */
const BANDS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 30],
  [30, 60],
  [60, 90],
  [90, 100],
];

/** The large tower's shell with almost nobody in it: full-width floors from the
 *  deepest basement to floor 100, sky-lobby rows every 15th story, offices and
 *  condos on every other story, the 24-shaft elevator pool and the 64-link
 *  stairs and escalator pool both full, and a population in the hundreds. It
 *  is the pathological case for a size gate that counts people: roughly the
 *  large tower's unit count on a few hundred. */
export function buildManyUnitTower(spec: ManyUnitSpec): Simulation {
  const sim = Simulation.newGame(spec.seed, "classic");
  const t = sim.tower;
  sim.money = 1_000_000_000;
  // The escalator unlocks at 3 stars, the service and express shafts at 2 and 3.
  sim.star = 5;
  const left = 4;
  const right = GRID.width - 4;
  for (let x = 0; x < GRID.width; x++) must(`many-unit: lobby at ${x}`, t.place("lobby", 1, x));
  for (let f = 2; f <= GRID.maxFloor; f++) {
    const kind: FacilityKind = isSkyLobbyFloor(f) ? "lobby" : "floor";
    for (let x = left; x < right; x++) must(`many-unit: ${kind} ${f} at ${x}`, t.place(kind, f, x));
  }
  for (let f = 0; f >= GRID.minFloor; f--) for (let x = 0; x < GRID.width; x++) must(`many-unit: basement ${f} at ${x}`, t.place("floor", f, x));

  // The 24-shaft pool: the five standard bands the large tower has, then
  // service and express shafts, each in a column of its own.
  const shafts: { kind: FacilityKind; bottom: number; top: number }[] = [];
  for (const [bottom, top] of BANDS) shafts.push({ kind: "elevatorStandard", bottom, top });
  for (const [bottom, top] of BANDS) shafts.push({ kind: "elevatorService", bottom, top });
  while (shafts.length < 24) shafts.push({ kind: "elevatorExpress", bottom: GRID.minFloor, top: GRID.maxFloor });
  let x = left;
  for (const s of shafts) {
    must(`many-unit: ${s.kind} ${s.bottom}-${s.top} at ${x}`, t.placeTransport(s.kind, x, s.bottom, s.top));
    x += FACILITIES[s.kind].width;
  }

  // The 64-link pool: stairs and escalators on single flights, side by side
  // along the rows above the shafts, alternating kinds.
  const walkW = FACILITIES.stairs.width;
  for (let i = 0; i < 64; i++) {
    const kind: FacilityKind = i % 2 === 0 ? "stairs" : "escalator";
    const floor = 2 + (i % 8) * 11;
    const col = x + 8 + Math.floor(i / 8) * walkW;
    must(`many-unit: ${kind} ${floor}-${floor + 1} at ${col}`, t.placeTransport(kind, col, floor, floor + 1));
  }

  // Rooms in a band across the middle of the lot, on the stories that are not
  // sky lobbies, clear of the shafts and walkways.
  const roomsFrom = x + 8 + 8 * walkW + 8;
  for (let f = 3; f <= GRID.maxFloor - 1; f++) {
    if (isSkyLobbyFloor(f)) continue;
    const kind: FacilityKind = f % 3 === 0 ? "condo" : "office";
    const kw = FACILITIES[kind].width;
    for (let cx = roomsFrom; cx + kw <= right; cx += kw) {
      // A room that does not fit (it would sit on a walkway) is skipped.
      t.place(kind, f, cx);
    }
  }
  occupyToward(sim, spec.population);
  sim.evaluateStar();
  return sim;
}
