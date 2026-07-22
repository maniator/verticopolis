import type { Tower } from "../Tower";
import { BUILD_CAPS, FACILITIES, GRID, POOLED_CAPS, facilityFloors, isFixedSpanTransport, maxSpanFor } from "../facilities";
import type { FacilityKind, PlaceResult, Unit } from "../types";
import { isStructural, isLobbyFloor, isSkyLobbyFloor, coversGroundFloor, NO_BASEMENT_KINDS } from "./towerTopology";

/** Placement + support/bridging validation for the Tower, as friend functions
 * taking the {@link Tower} instance. Extracted from `Tower.ts`; the class keeps
 * thin delegations. */

/**
 * Enforce the 1994 hard build caps (single kinds via {@link BUILD_CAPS},
 * pooled groups like elevator shafts / walkways via {@link POOLED_CAPS}).
 * Returns a failure reason if the cap is reached, else undefined.
 */
export function capReason(tower: Tower, kind: FacilityKind): string | undefined {
  const single = BUILD_CAPS[kind];
  if (single !== undefined && tower.countKind(kind) >= single) {
    return `Only ${single} ${FACILITIES[kind].name}${single === 1 ? "" : "s"} allowed per tower.`;
  }
  for (const pool of POOLED_CAPS) {
    if (!pool.kinds.includes(kind)) continue;
    const total = pool.kinds.reduce((sum, k) => sum + tower.countKind(k), 0);
    if (total >= pool.cap) return `Only ${pool.cap} ${pool.label} allowed per tower.`;
  }
  return undefined;
}

/**
 * Shared room-placement validation for {@link canPlace} and
 * {@link canPlaceRoomIgnoringFloor}, the single source of truth for the rules
 * that govern where a room may sit. Returns a failure reason, or undefined if
 * placement is allowed. `requireFloor` demands existing floor structure under
 * every story (false when a room auto-lays its own floor on placement).
 */
export function roomPlacementReason(tower: Tower, 
  kind: FacilityKind,
  floor: number,
  x: number,
  requireFloor: boolean,
): string | undefined {
  const f = FACILITIES[kind];
  if (floor < GRID.minFloor || floor > GRID.maxFloor) return "Outside the buildable range.";
  if (x < 0 || x + f.width > GRID.width) return "Off the edge of the lot.";
  if (kind === "weddingHall" && floor !== GRID.maxFloor) {
    return "The wedding hall can only crown floor 100.";
  }
  const cap = tower.capReason(kind);
  if (cap) return cap;
  // Multi-story facilities (e.g. the cinema) occupy several floors upward.
  const hgt = facilityFloors(kind);
  if (floor + hgt - 1 > GRID.maxFloor) return "Not enough floors above for this facility.";
  // Basement-only facilities must sit entirely underground (floors below 1).
  if (f.basement && floor + hgt - 1 >= 1) return `${f.name} can only be built in the basement.`;
  // The ground floor (level 1) is the tower's entrance concourse, a lobby,
  // never a room floor, exactly as in the original.
  if (coversGroundFloor(floor, hgt)) {
    return "The ground floor is a lobby concourse. Build rooms on floor 2 and up.";
  }
  // Offices, condos and hotels need daylight; only commercial/service go below.
  if (floor < 1 && NO_BASEMENT_KINDS.has(kind)) return `${f.name} can't be built in the basement.`;
  for (let fl = floor; fl < floor + hgt; fl++) {
    if (!tower.roomSpanFree(fl, x, f.width)) return "Something is already here.";
    if (requireFloor && !tower.spanHasFloor(fl, x, f.width)) return "Build floors on every story first.";
    // Lobbies are transit concourses, no rooms may sit on them, exactly as in
    // the original, where the ground/sky lobby floors stay clear.
    if (tower.spanHasLobby(fl, x, f.width)) return "Lobbies are transit-only. Build rooms on a standard floor.";
    // Sky-lobby canon: once a sky-lobby floor is claimed (any lobby on it),
    // the WHOLE story is a concourse, so a room on any tile of that story is
    // refused, not just one overlapping a lobby tile. Fires after spanHasLobby
    // so a room straddling a lobby tile keeps the more specific "transit-only"
    // reason, while a room on a non-lobby tile of a claimed sky-lobby gets the
    // "sky lobby" reason.
    if (isSkyLobbyFloor(fl) && tower.floorHasLobby(fl)) {
      return "This room would sit on a sky lobby. Move it up or down a story.";
    }
  }
  return undefined;
}

export function canPlace(tower: Tower, kind: FacilityKind, floor: number, x: number): PlaceResult {
  const f = FACILITIES[kind];
  if (floor < GRID.minFloor || floor > GRID.maxFloor) {
    return { ok: false, reason: "Outside the buildable range." };
  }
  if (x < 0 || x + f.width > GRID.width) {
    return { ok: false, reason: "Off the edge of the lot." };
  }
  if (f.transport) {
    return { ok: false, reason: "Use placeTransport for vertical transport." };
  }
  // Founding is lobby-first, as in 1994: an empty tower's first placement must
  // be the ground lobby (reachable since Classic founds canon-zero; see
  // spec-starter-lobby-mode-split). isSupported then pins it to floor 1.
  if (tower.units.length === 0 && kind !== "lobby") {
    return { ok: false, reason: "Lay a lobby on the ground line first to open your tower." };
  }

  if (isStructural(kind)) {
    if (kind === "lobby" && !isLobbyFloor(floor)) {
      return { ok: false, reason: "Lobbies only go on the ground floor and every 15th floor (15, 30, 45…)." };
    }
    // Sky-lobby canon (floors 15/30/45/60/75/90): a floor becomes lobby-only
    // the moment the player commits a lobby to it. Refuse plain floor tiles
    // there, and refuse a lobby on a sky-lobby floor that already carries
    // non-lobby content (which would leave the concourse mixed). Ground floor
    // 1 is out of scope for THIS PLACEMENT RULE only (rooms are already
    // blocked by coversGroundFloor, and the ground concourse keeps its
    // in-place floor-to-lobby upgrade). Lobby permanence in removalReason is
    // a separate rule and covers every floor including ground.
    if (kind === "floor" && isSkyLobbyFloor(floor) && tower.floorHasLobby(floor)) {
      return { ok: false, reason: "Sky lobbies are concourses. Only lobby tiles go here." };
    }
    if (kind === "lobby" && isSkyLobbyFloor(floor) && tower.floorHasNonLobbyContent(floor)) {
      return { ok: false, reason: "Clear the floor tiles or rooms here first, then place your sky lobby." };
    }
    if (!tower.structureSpanFree(floor, x, f.width)) {
      // A lobby may upgrade plain floor tiles in place (the sky-lobby
      // conversion): the lobby is structural too, so support for the story
      // above is preserved without ever passing through a hanging state.
      if (kind !== "lobby" || !tower.spanUpgradeableToLobby(floor, x, f.width)) {
        return { ok: false, reason: "Structure already here." };
      }
      if (!tower.roomSpanFree(floor, x, f.width)) {
        return { ok: false, reason: "Lobbies are transit-only. Clear the rooms here first." };
      }
    }
    if (!tower.isSupported(floor, x, f.width)) {
      return {
        ok: false,
        reason:
          floor >= 2
            ? "Floors and lobbies must sit on the story below: no floating overhangs."
            : "Floors and lobbies must connect to the existing tower.",
      };
    }
    return { ok: true };
  }

  const reason = tower.roomPlacementReason(kind, floor, x, true);
  return reason ? { ok: false, reason } : { ok: true };
}

/**
 * Like {@link canPlace} for a room, but does NOT require the floor to already
 * exist, used when a room auto-lays its own floor on placement.
 */
export function canPlaceRoomIgnoringFloor(tower: Tower, kind: FacilityKind, floor: number, x: number): PlaceResult {
  if (isStructural(kind) || FACILITIES[kind].transport) return { ok: false, reason: "Not a room." };
  const reason = tower.roomPlacementReason(kind, floor, x, false);
  return reason ? { ok: false, reason } : { ok: true };
}

/**
 * Like {@link canPlace} for a floor/lobby, but does NOT require the tile to be
 * supported/connected yet. Used to tell a lobby that only fails because it
 * isn't connected (a detached ground concourse tile) from one that fails for a
 * real reason (off-lot, wrong floor, overlap), so the auto-lobby bridge can
 * rescue the former: lay the bridge first and the tile lands connected. Mirrors
 * {@link canPlaceRoomIgnoringFloor} for the structural side.
 */
export function canPlaceStructureIgnoringSupport(tower: Tower, kind: FacilityKind, floor: number, x: number): PlaceResult {
  if (!isStructural(kind)) return { ok: false, reason: "Not a structural tile." };
  const f = FACILITIES[kind];
  if (floor < GRID.minFloor || floor > GRID.maxFloor) {
    return { ok: false, reason: "Outside the buildable range." };
  }
  if (x < 0 || x + f.width > GRID.width) return { ok: false, reason: "Off the edge of the lot." };
  if (kind === "lobby" && !isLobbyFloor(floor)) {
    return { ok: false, reason: "Lobbies only go on the ground floor and every 15th floor (15, 30, 45…)." };
  }
  if (!tower.structureSpanFree(floor, x, f.width)) {
    // Same in-place floor→lobby upgrade allowance as canPlace: a lobby may sit
    // on plain floor tiles, anything else is a real collision.
    if (kind !== "lobby" || !tower.spanUpgradeableToLobby(floor, x, f.width)) {
      return { ok: false, reason: "Structure already here." };
    }
    if (!tower.roomSpanFree(floor, x, f.width)) {
      return { ok: false, reason: "Lobbies are transit-only. Clear the rooms here first." };
    }
  }
  return { ok: true };
}

/** How many floor tiles under a room's footprint don't yet exist. */
export function missingFloorCount(tower: Tower, floor: number, x: number, width: number, hgt: number): number {
  let n = 0;
  for (let fl = floor; fl < floor + hgt; fl++) {
    for (let i = 0; i < width; i++) if (!tower.structure.has(tower.key(fl, x + i))) n++;
  }
  return n;
}

/** The shared "no floating overhangs" rule: every tile of an above-ground
 *  span must rest on structure directly below it. */
export function restsOnStoryBelow(tower: Tower, floor: number, x: number, width: number): boolean {
  return tower.spanEvery(floor - 1, x, width, (k) => tower.structure.has(k));
}

/**
 * True if a room may be supported here. Above ground a room must sit fully on
 * the floor directly below it (no floating overhangs / diagonal stacking).
 * The ground floor rests on the earth, and basements hang off the level above,
 * so those connect by simply touching the existing tower.
 */
export function spanConnects(tower: Tower, floor: number, x: number, width: number, hgt: number): boolean {
  if (tower.units.length === 0) return false;
  if (floor >= 2) return tower.restsOnStoryBelow(floor, x, width);
  for (let fl = floor; fl < floor + hgt; fl++) {
    for (let i = -1; i <= width; i++) if (tower.structure.has(tower.key(fl, x + i))) return true;
  }
  for (let i = 0; i < width; i++) {
    if (tower.structure.has(tower.key(floor - 1, x + i)) || tower.structure.has(tower.key(floor + hgt, x + i))) return true;
  }
  return false;
}

/**
 * Place a set of structural `kind` tiles with a support-ordered retry loop: a
 * tile that can't rest yet is retried after its neighbors land, so a run
 * drains in whatever order support becomes available (a grow bottom-up, a
 * basement top-down, a flanked ground/basement run outward from the neighbor).
 * Returns the ids placed and any `stuck` tiles that could never be supported.
 * Does NOT roll back; the caller decides (a hard rollback for the room and
 * shaft auto-flooring, best-effort for the bridge, whose plan is exact). The
 * single home for this loop so room, bridge, and shaft auto-flooring can never
 * drift apart on the support or retry rules.
 */
export function placeStructureRun(tower: Tower, 
  tiles: { fl: number; x: number }[],
  kind: "floor" | "lobby",
): { placed: number[]; stuck: { fl: number; x: number }[] } {
  let remaining = tiles;
  const placed: number[] = [];
  let progress = true;
  while (remaining.length > 0 && progress) {
    progress = false;
    const still: { fl: number; x: number }[] = [];
    for (const m of remaining) {
      const r = tower.place(kind, m.fl, m.x);
      if (r.ok && r.unitId !== undefined) {
        placed.push(r.unitId);
        progress = true;
      } else {
        still.push(m);
      }
    }
    remaining = still;
  }
  return { placed, stuck: remaining };
}

/**
 * Auto-lay the floor tiles under a room's footprint, building outward so each
 * new tile stays supported. Returns the number of tiles created, or fails
 * (rolling back) if the footprint can't be connected to the tower.
 */
export function ensureFloorUnder(tower: Tower, floor: number, x: number, width: number, hgt: number): { ok: boolean; reason?: string; count: number } {
  const tiles: { fl: number; x: number }[] = [];
  for (let fl = floor; fl < floor + hgt; fl++) {
    for (let i = 0; i < width; i++) if (!tower.structure.has(tower.key(fl, x + i))) tiles.push({ fl, x: x + i });
  }
  if (tiles.length === 0) return { ok: true, count: 0 };
  const { placed, stuck } = tower.placeStructureRun(tiles, "floor");
  if (stuck.length > 0) {
    for (const id of placed) tower.removeUnit(id);
    return { ok: false, reason: "Build next to the tower. You can't build in midair.", count: 0 };
  }
  return { ok: true, count: placed.length };
}

/**
 * Tiles to auto-fill so a newly placed room or lobby joins up with its
 * nearest same-substrate neighbor on each of its own stories: the empty
 * horizontal gap between the footprint and that neighbor is bridged, a room
 * with plain floor and a lobby with lobby. This is the 1994 quality-of-life
 * behavior where dropping a second module a few tiles from the first fills
 * the walkway between them instead of forcing a manual floor run (backlog
 * `auto-floor-build`).
 *
 * The fill kind follows what is being placed: a lobby bridges to a
 * neighboring lobby with lobby tiles, every room (and the plain floor tool)
 * bridges to a neighboring floor with plain floor. A substrate mismatch never
 * stitches (a floor won't join a lobby, or the reverse), so a floor dropped
 * beside the ground concourse lobby does not fill into it. Only empty,
 * supportable tiles are returned: above ground each bridge tile needs
 * structure directly below (no floating overhangs), while the ground and
 * basement rest on a run that is flanked by structure on both ends and so
 * always fills. A multi-story facility's upper story may rest on the bridge
 * its own lower story will lay, so the stories are scanned bottom-up and lower
 * planned tiles count as support for the one above (both walkways of a stacked
 * pair of cinemas fill, not just the base).
 *
 * The plan is exactly the set {@link fillBridge} lays: the scan reads only
 * columns outside the footprint, so laying the footprint (before or after)
 * can't change it, and a caller can size the charge from its length.
 * Non-mutating.
 */
export function bridgeFillPlan(tower: Tower, kind: FacilityKind, floor: number, x: number, width: number, hgt: number): { fl: number; x: number }[] {
  // Rooms, lobbies, and the plain floor tool all bridge to a same-substrate
  // neighbor (owner-requested: dropping a floor tile a few cells from another
  // floor fills the gap, exactly like the room/lobby behavior). Transports
  // (elevators/stairs) never carry a horizontal substrate, so they never
  // bridge.
  if (FACILITIES[kind].transport) return [];
  const substrate: "floor" | "lobby" = kind === "lobby" ? "lobby" : "floor";
  // Columns this plan will floor on each story, so a story can rest on the
  // bridge the story below it lays (see the stacked-cinema note above).
  const plannedByFloor = new Map<number, Set<number>>();
  // Above ground a bridge tile must rest on the story below: existing
  // structure, or a lower bridge tile this same plan will lay. On the ground
  // and in the basement a gap flanked by structure builds outward, so every
  // empty tile in it is reachable.
  const supportable = (fl: number, tx: number): boolean => {
    if (fl < 2) return true;
    return tower.structure.has(tower.key(fl - 1, tx)) || (plannedByFloor.get(fl - 1)?.has(tx) ?? false);
  };
  const tiles: { fl: number; x: number }[] = [];
  // Bottom-up so a lower story's planned tiles are known when the story above
  // is evaluated.
  for (let fl = floor; fl < floor + hgt; fl++) {
    const planned = new Set<number>();
    plannedByFloor.set(fl, planned);
    const add = (g: number): void => {
      if (supportable(fl, g)) {
        tiles.push({ fl, x: g });
        planned.add(g);
      }
    };
    // Nearest structure before the footprint on this story: bridge only when
    // it matches the substrate (a room won't stitch itself to a lobby, or a
    // lobby to a plain floor), and only across the empty run up to it.
    for (let tx = x - 1; tx >= 0; tx--) {
      const k = tower.structKind.get(tower.key(fl, tx));
      if (k === undefined) continue; // still scanning the gap
      if (k === substrate) for (let g = tx + 1; g < x; g++) add(g);
      break; // first structure hit ends the scan, whether or not it matched
    }
    // Nearest structure after the footprint, mirror of the above. Emit
    // right-side tiles from the neighbor INWARD (descending x) so the ground
    // and basement outward-fill drains in a single pass instead of walking
    // support back tile by tile through retries.
    for (let tx = x + width; tx < GRID.width; tx++) {
      const k = tower.structKind.get(tower.key(fl, tx));
      if (k === undefined) continue;
      if (k === substrate) for (let g = tx - 1; g >= x + width; g--) add(g);
      break;
    }
  }
  return tiles;
}

/**
 * Lay the {@link bridgeFillPlan} tiles for a room or lobby being placed,
 * building outward from the existing neighbor so a ground or basement run (and
 * a multi-story facility's upper walkway) stays supported as it fills. Runs
 * BEFORE the primary is placed, so a detached ground concourse lobby is
 * connected by the time it lands; rooms and sky lobbies rest on the story
 * below regardless, so the order is harmless for them. Returns the ids of the
 * placed tiles: `.length` is the tile count for charging, and the ids let a
 * caller roll the bridge back if a later placement fails. The plan is exact,
 * so the retry loop always drains; a tile only sits out a pass while the
 * lower/adjacent tile it rests on is being laid, never permanently.
 */
export function fillBridge(tower: Tower, kind: FacilityKind, floor: number, x: number, width: number, hgt: number): number[] {
  const substrate: "floor" | "lobby" = kind === "lobby" ? "lobby" : "floor";
  // The plan is exact (every tile is reachable in support order), so the
  // shared retry loop always drains and `stuck` is empty; the bridge is
  // best-effort by contract, so we take the placed ids and let the caller
  // (`Simulation.build`) roll them back if the primary still fails.
  return tower.placeStructureRun(tower.bridgeFillPlan(kind, floor, x, width, hgt), substrate).placed;
}

/**
 * Whether a new floor span is structurally supported. Above ground every
 * tile must rest on structure directly below, extending sideways past the
 * story underneath would leave the floor hanging in midair. The ground
 * floor rests on the earth and basements are embedded in it, so those
 * connect by simply touching the existing tower (side, above, or below).
 */
export function isSupported(tower: Tower, floor: number, x: number, width: number): boolean {
  if (tower.units.length === 0) {
    return floor === 1; // the founding strip must be the ground floor
  }
  if (floor >= 2) return tower.restsOnStoryBelow(floor, x, width);
  for (let i = -1; i <= width; i++) {
    if (tower.structure.has(tower.key(floor, x + i))) return true;
  }
  for (let i = 0; i < width; i++) {
    if (
      tower.structure.has(tower.key(floor - 1, x + i)) ||
      tower.structure.has(tower.key(floor + 1, x + i))
    ) {
      return true;
    }
  }
  return false;
}

export function place(tower: Tower, kind: FacilityKind, floor: number, x: number): PlaceResult {
  const check = tower.canPlace(kind, floor, x);
  if (!check.ok) return check;
  const f = FACILITIES[kind];
  // In-place floor→lobby upgrade: clear the plain floor tiles being replaced
  // before registering the lobby, so the structure index never goes stale.
  // (canPlace guaranteed any structure in the span is plain floor.)
  if (kind === "lobby") {
    for (let i = 0; i < f.width; i++) {
      const sid = tower.structure.get(tower.key(floor, x + i));
      if (sid !== undefined) tower.removeUnit(sid);
    }
  }
  const unit: Unit = {
    id: tower.nextId++,
    kind,
    floor,
    x,
    width: f.width,
    state: "empty",
    satisfaction: 1,
    occupants: 0,
    everOccupied: false,
    pendingIncome: 0,
    label: f.name,
  };
  tower.units.push(unit);
  tower.register(unit);
  if (kind === "weddingHall") tower.builtWeddingHall = true;
  // First lobby tile on this floor → it just became a (sky) lobby, so bring any
  // express spanning it into line (it now stops here).
  if (kind === "lobby" && tower.lobbyTiles.get(floor) === unit.width) {
    tower.syncExpressStopsForFloor(floor);
  }
  tower.revision++;
  return { ok: true, unitId: unit.id };
}

/** The ONE span rule (and its message) shared by placement and resize, so
 *  the two paths can never drift apart again. Undefined when the span is
 *  legal for this kind. */
export function spanReason(_tower: Tower, kind: FacilityKind, bottom: number, top: number): string | undefined {
  const maxSpan = maxSpanFor(kind);
  if (top - bottom <= maxSpan) return undefined;
  return isFixedSpanTransport(kind)
    ? `${FACILITIES[kind].name} links exactly two floors.`
    : `This elevator can span at most ${maxSpan} floors (${maxSpan + 1} stops).`;
}
