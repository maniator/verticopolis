import type { FacilityKind } from "./types";
import { FACILITIES, GRID } from "./facilitiesData";

/** Passengers a single car of each transport type holds per trip. The three
 *  elevator values are the per-car capacities the .TDT save stores in each
 *  elevator's header (docs/canon/tdt-format.md §8): express 42, standard 21,
 *  service 10. Escalator/stairs are our own throughput figures; the save's
 *  separate walkway table stores occupant counts, not a capacity. */
export const TRANSPORT_CAPACITY: Partial<Record<FacilityKind, number>> = {
  elevatorStandard: 21,
  elevatorService: 10, // canon: the smallest cab (staff-only)
  elevatorExpress: 42, // canon: PC 1.0 express car carries 42 (standard 21)
  escalator: 30, // continuous flow, treated as per-shaft
  stairs: 8,
};

/**
 * Per-car passenger capacity for a transport kind. The single source of truth
 * for the whole engine, dispatch load-clamping, the simulation's capacity /
 * congestion math, and the renderer's rider-fill / FULL indicator all route
 * through here, so they can never disagree on the number (an unknown kind
 * conservatively carries nobody). Distinct from `Simulation.transportCapacity`,
 * which is the whole shaft's total: cars × this per-car number.
 */
export function transportCarCapacity(kind: FacilityKind): number {
  return TRANSPORT_CAPACITY[kind] ?? 0;
}

/** Maximum cars allowed per shaft, by elevator type. Canon: every elevator kind
 *  supports up to 8 cars per shaft in the 1994 original, service is not an
 *  exception (it is a staff-only standard elevator: same 8 cars, same 30-floor
 *  span). */
export const MAX_CARS: Partial<Record<FacilityKind, number>> = {
  elevatorStandard: 8,
  elevatorService: 8,
  elevatorExpress: 8,
};

/** Max cars for a shaft kind. The single home for the missing-kind fallback,
 *  so the editor's guards and the engine's clamp can't drift apart. */
export function maxCarsFor(kind: FacilityKind): number {
  return MAX_CARS[kind] ?? 8;
}

/**
 * Hard per-tower build limits, mirroring the 1994 original's caps. A kind absent
 * here is uncapped. Elevator shafts (all three kinds) share a single 24-shaft
 * pool; stairs and escalators share a 64-link pool, see {@link POOLED_CAPS}.
 */
export const BUILD_CAPS: Partial<Record<FacilityKind, number>> = {
  metro: 1,
  weddingHall: 1,
  security: 10,
  medical: 10,
  cinema: 16,
  partyHall: 16,
  aquaticCenter: 8,
};

/** Pooled caps shared across several kinds (elevators, walkways). */
export const POOLED_CAPS: { kinds: FacilityKind[]; cap: number; label: string }[] = [
  { kinds: ["elevatorStandard", "elevatorService", "elevatorExpress"], cap: 24, label: "elevator shafts" },
  { kinds: ["stairs", "escalator"], cap: 64, label: "stairs/escalators" },
];

/** Maximum floors a transport may span (a span is the gap between bottom and top,
 * so floors served is span + 1). Stairs/escalators link one floor; standard and
 * service elevators cap at 30; express has **no effective limit** in the original,
 * so it may span the entire buildable height of the tower (derived from GRID, not
 * a magic number). */
export function maxSpanFor(kind: FacilityKind): number {
  if (kind === "stairs" || kind === "escalator") return 1;
  if (kind === "elevatorExpress") return GRID.maxFloor - GRID.minFloor; // whole tower height
  return 30;
}

/** True for transports that are a FIXED two-floor unit (stairs, escalators):
 *  placed with one tap, never dragged to size, never extended. The single
 *  home for the concept, placement, gestures, ghosts, editor buttons and
 *  span messages all key off this, so a new kind can't flip half of them.
 *
 *  Canon (#323, party ruling 2026-07-19): the 1994 game only ever BUILDS single
 *  flights (each links two adjacent floors); no source shows the shipped editor
 *  placing a multi-story stair/escalator, so we hold walkways to single flights.
 *  The TDT format has type bytes for 2- and 3-story variants; our exporter still
 *  collapses stacked flights into those records (`src/storage/tdtEncoder.ts`), and whether
 *  the real game ever WRITES a multi-story record itself is an open harness
 *  question (#323), so this comment does not claim it. */
export function isFixedSpanTransport(kind: FacilityKind): boolean {
  return FACILITIES[kind]?.transport === true && maxSpanFor(kind) === 1;
}

/**
 * Canon cumulative-walk willingness: the most CONTIGUOUS flights of each walkway
 * kind a person will chain on one trip before refusing in the 1994 original, an
 * elevator ride resetting the count. **Stairs 4, escalators 7** (roadwolf "4 sets
 * of stairs per trip"; relentlessoptimizer "maximum of four flights"; GameFAQs;
 * the "5 levels" some guides cite counts the origin floor). Ratified by the
 * design party 2026-07-19 (#384).
 *
 * Canon VALUE only: nothing consumes it yet. Enforcing it is a mode-split
 * gameplay change (Classic refuses past the threshold, Modern applies a comfort
 * penalty at the same knee) that loosens today's passenger stair reach. Enforcement is the #384 story
 * (its design lives in the parity GDD), not shipped here.
 */
export const WALKWAY_WILLINGNESS: Record<"stairs" | "escalator", number> = {
  stairs: 4,
  escalator: 7,
};
