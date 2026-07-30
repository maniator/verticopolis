import type { FacilityKind } from "../types";
import { GRID } from "../facilities";
/**
 * Pure topology predicates and shared refusal strings for the Tower spatial
 * model. Extracted from `Tower.ts` so placement/transport/routing siblings and
 * the class share one definition. Every function here is stateless.
 */

/** Structural kinds form the floor/corridor layer that rooms sit upon. */
export function isStructural(kind: FacilityKind): boolean {
  return kind === "floor" || kind === "lobby";
}

/** The ground floor (1) and every 15th floor above host a (sky) lobby. */
export function isLobbyFloor(floor: number): boolean {
  return floor === 1 || (floor > 1 && floor % GRID.lobbyInterval === 0);
}

/** Sky-lobby floors are every 15th story above the ground concourse (15, 30,
 *  45, 60, 75, 90). Distinct from `isLobbyFloor` because floor 1 (the concourse)
 *  has its own set of rules (`coversGroundFloor`, unremovable-lobby, etc.) and
 *  is out of scope for the "sky-lobby-claimed" behavior. */
export function isSkyLobbyFloor(floor: number): boolean {
  return floor >= 2 && floor % GRID.lobbyInterval === 0;
}

/**
 * The 1994 rule that the ground floor (level 1) is lobby-only, expressed as a
 * placement COERCION: the Floor tool used on floor 1 lays a LOBBY, not a bare
 * floor tile, so a player never leaves a non-lobby ground concourse (which the
 * retail game never produces; docs/canon/tdt-format.md, Wine-harness confirmed).
 * Floor 1 is UNCONDITIONALLY a lobby in the original, so it coerces here; the
 * sky-lobby stories are only CONDITIONALLY lobby-only (a claimed sky lobby
 * refuses plain floor via a separate rule in placement.ts) and are deliberately
 * NOT coerced. Applied at the Simulation build boundary (sim/build.ts) so the
 * player build path, its cost, and its preview agree; the low-level Tower
 * primitive stays permissive so save-load and internal callers are untouched.
 */
export function groundFloorStructureKind(kind: FacilityKind, floor: number): FacilityKind {
  return kind === "floor" && floor === 1 ? "lobby" : kind;
}

/**
 * Rooms that need daylight and can't sit in a windowless basement. Commercial
 * (shop/fast food/restaurant), entertainment, and service facilities may go
 * underground; people don't live or work down there.
 */
export const NO_BASEMENT_KINDS: ReadonlySet<FacilityKind> = new Set<FacilityKind>([
  "office",
  "condo",
  "hotelSingle",
  "hotelDouble",
  "hotelSuite",
]);

/** True if a facility footprint (floor..floor+hgt-1) covers the ground concourse. */
export function coversGroundFloor(floor: number, hgt: number): boolean {
  return floor <= 1 && floor + hgt - 1 >= 1;
}

/** Shared placement/resize refusal, one string so the two paths can't drift. */
export const NEEDS_FLOORS = "Transport must run through built floors. Lay floors first.";
/** Shared "a shaft is already here" refusal, used by both the placement
 *  ({@link Tower.validateTransport}) and the extend ({@link Tower.resizeTransport})
 *  paths so the toast copy is identical however the collision is reached. */
export const SHAFT_OVERLAP = "Transport shafts cannot overlap.";
