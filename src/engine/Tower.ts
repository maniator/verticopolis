import { BUILD_CAPS, FACILITIES, GRID, POOLED_CAPS, facilityFloors, isElevatorKind, isFixedSpanTransport, isHotelKind, isStaffOnlyTransport, isStaffTransportKind, maxCarsFor, maxSpanFor, residentCount } from "./facilities";
import { isOperational, isPresent } from "./types";
import type {
  Facility,
  FacilityKind,
  PlaceResult,
  Transport,
  Unit,
} from "./types";

/** Structural kinds form the floor/corridor layer that rooms sit upon. */
function isStructural(kind: FacilityKind): boolean {
  return kind === "floor" || kind === "lobby";
}

/** The ground floor (1) and every 15th floor above host a (sky) lobby. */
function isLobbyFloor(floor: number): boolean {
  return floor === 1 || (floor > 1 && floor % GRID.lobbyInterval === 0);
}

/** Sky-lobby floors are every 15th story above the ground concourse (15, 30,
 *  45, 60, 75, 90). Distinct from `isLobbyFloor` because floor 1 (the concourse)
 *  has its own set of rules (`coversGroundFloor`, unremovable-lobby, etc.) and
 *  is out of scope for the "sky-lobby-claimed" behavior. */
function isSkyLobbyFloor(floor: number): boolean {
  return floor >= 2 && floor % GRID.lobbyInterval === 0;
}

/**
 * Rooms that need daylight and can't sit in a windowless basement. Commercial
 * (shop/fast food/restaurant), entertainment, and service facilities may go
 * underground; people don't live or work down there.
 */
const NO_BASEMENT_KINDS = new Set<FacilityKind>([
  "office",
  "condo",
  "hotelSingle",
  "hotelDouble",
  "hotelSuite",
]);

/** True if a facility footprint (floor..floor+hgt-1) covers the ground concourse. */
function coversGroundFloor(floor: number, hgt: number): boolean {
  return floor <= 1 && floor + hgt - 1 >= 1;
}

/** Shared placement/resize refusal — one string so the two paths can't drift. */
const NEEDS_FLOORS = "Transport must run through built floors. Lay floors first.";

/**
 * The Tower owns the spatial model. Cells have two layers: a structural layer
 * (floor / lobby tiles) and a room layer (offices, shops, …). A room is built
 * on top of existing structure, sharing the same cell — exactly like the
 * original game, where rooms line a corridor.
 */
export class Tower {
  units: Unit[] = [];
  transports: Transport[] = [];
  private nextId = 1;
  towerName = "Tower One";
  builtWeddingHall = false;
  /** Bumped whenever units/transports are added or removed (render caching). */
  revision = 0;
  /** Bumped whenever a room's transient meal overlay changes, so the renderer can
   *  repaint visible office/condo headcounts without treating it as a build edit. */
  mealOverlayRevision = 0;

  /** "floor:x" -> structural unit id (floor/lobby). */
  private structure = new Map<string, number>();
  /** "floor:x" -> which structural kind occupies it (floor vs lobby). */
  private structKind = new Map<string, "floor" | "lobby">();
  /** "floor:x" -> room unit id. */
  private rooms = new Map<string, number>();
  /** id → unit index, kept in lockstep with `units` via register/unregister, so
   *  tile lookups are O(1) rather than a linear scan (hot in the flood-fills and
   *  the per-frame congestion read). */
  private byId = new Map<number, Unit>();
  /** id → transport, kept in lockstep with `transports` (mirror of `byId`). */
  private transportsById = new Map<number, Transport>();
  /** floor → number of lobby structural tiles on it, so "is this a lobby floor?"
   *  is O(1). Used to keep express-elevator stops synced with sky lobbies as they
   *  are built or removed, regardless of the order relative to the elevator. */
  private lobbyTiles = new Map<number, number>();
  /** floor → number of NON-lobby tiles on it: plain floor tiles plus every
   *  tile a room's footprint covers on this story (a multi-story facility
   *  contributes to each of its stories). Mirror of `lobbyTiles`, kept live by
   *  register/unregister/reindex so `floorHasNonLobbyContent` is O(1) on every
   *  hover-preview frame. */
  private nonLobbyTiles = new Map<number, number>();

  private key(floor: number, x: number): string {
    return `${floor}:${x}`;
  }

  /** Room occupying a tile, else the structural tile, else undefined. */
  unitAt(floor: number, x: number): Unit | undefined {
    const k = this.key(floor, x);
    const rid = this.rooms.get(k);
    if (rid !== undefined) return this.byId.get(rid);
    const sid = this.structure.get(k);
    if (sid !== undefined) return this.byId.get(sid);
    return undefined;
  }

  /** The room (non-structural) at a tile, if any. */
  roomAt(floor: number, x: number): Unit | undefined {
    const rid = this.rooms.get(this.key(floor, x));
    return rid === undefined ? undefined : this.byId.get(rid);
  }

  hasStructure(floor: number, x: number): boolean {
    return this.structure.has(this.key(floor, x));
  }

  occupiedFloors(): number[] {
    const set = new Set<number>();
    for (const u of this.units) set.add(u.floor);
    return [...set].sort((a, b) => a - b);
  }

  get highestFloor(): number {
    let h = 1;
    for (const u of this.units) if (u.floor > h) h = u.floor;
    return h;
  }

  get lowestFloor(): number {
    let l = 1;
    for (const u of this.units) if (u.floor < l) l = u.floor;
    return l;
  }

  /** True if `pred` holds for EVERY tile key of the span (short-circuits). */
  private spanEvery(floor: number, x: number, width: number, pred: (k: string) => boolean): boolean {
    for (let i = 0; i < width; i++) {
      if (!pred(this.key(floor, x + i))) return false;
    }
    return true;
  }

  /** True if `pred` holds for SOME tile key of the span (short-circuits). */
  private spanSome(floor: number, x: number, width: number, pred: (k: string) => boolean): boolean {
    return !this.spanEvery(floor, x, width, (k) => !pred(k));
  }

  /** ANY-tile structure check for a shaft cell — a transport floor is valid
   *  when at least one tile under the shaft is built (distinct from
   *  {@link spanHasFloor}, which requires ALL tiles). */
  private shaftHasStructureAt(floor: number, x: number, width: number): boolean {
    return this.spanSome(floor, x, width, (k) => this.structure.has(k));
  }

  private transportById(id: number): Transport | undefined {
    return this.transportsById.get(id);
  }

  /** Look up a unit by id. */
  getUnit(id: number): Unit | undefined {
    return this.byId.get(id);
  }

  /** Mark a transient meal-overlay change that should repaint room sprites. */
  bumpMealOverlayRevision(): void {
    this.mealOverlayRevision++;
  }

  /** Look up a transport by id. */
  getTransport(id: number): Transport | undefined {
    return this.transportsById.get(id);
  }

  /** True if no room occupies any tile of the span. */
  private roomSpanFree(floor: number, x: number, width: number): boolean {
    return this.spanEvery(floor, x, width, (k) => !this.rooms.has(k));
  }

  /** True if no structure occupies any tile of the span. */
  private structureSpanFree(floor: number, x: number, width: number): boolean {
    return this.spanEvery(floor, x, width, (k) => !this.structure.has(k));
  }

  /** The structural kind occupying a tile ("floor" | "lobby"), if any. */
  structureKindAt(floor: number, x: number): "floor" | "lobby" | undefined {
    return this.structKind.get(this.key(floor, x));
  }

  /** True if every occupied tile of the span is a plain floor (no lobbies) —
   *  i.e. a lobby placed here is an in-place upgrade, not a collision. */
  private spanUpgradeableToLobby(floor: number, x: number, width: number): boolean {
    return this.spanEvery(floor, x, width, (k) => this.structKind.get(k) !== "lobby");
  }

  /** True if structural floor exists across the whole span. */
  spanHasFloor(floor: number, x: number, width: number): boolean {
    return this.spanEvery(floor, x, width, (k) => this.structure.has(k));
  }

  private register(unit: Unit): void {
    this.byId.set(unit.id, unit);
    const structural = isStructural(unit.kind);
    const map = structural ? this.structure : this.rooms;
    const hgt = facilityFloors(unit.kind);
    for (let fl = 0; fl < hgt; fl++) {
      for (let i = 0; i < unit.width; i++) {
        const k = this.key(unit.floor + fl, unit.x + i);
        map.set(k, unit.id);
        if (structural) this.structKind.set(k, unit.kind as "floor" | "lobby");
      }
      // Non-lobby tile counter (mirror of lobbyTiles). A plain floor tile is
      // non-lobby; a room's every-story footprint is non-lobby; a lobby is not.
      if (unit.kind !== "lobby") {
        const story = unit.floor + fl;
        this.nonLobbyTiles.set(story, (this.nonLobbyTiles.get(story) ?? 0) + unit.width);
      }
    }
    if (unit.kind === "lobby") {
      this.lobbyTiles.set(unit.floor, (this.lobbyTiles.get(unit.floor) ?? 0) + unit.width);
    }
  }

  private unregister(unit: Unit): void {
    this.byId.delete(unit.id);
    const structural = isStructural(unit.kind);
    const map = structural ? this.structure : this.rooms;
    const hgt = facilityFloors(unit.kind);
    for (let fl = 0; fl < hgt; fl++) {
      for (let i = 0; i < unit.width; i++) {
        const k = this.key(unit.floor + fl, unit.x + i);
        map.delete(k);
        if (structural) this.structKind.delete(k);
      }
      if (unit.kind !== "lobby") {
        const story = unit.floor + fl;
        const left = (this.nonLobbyTiles.get(story) ?? 0) - unit.width;
        if (left > 0) this.nonLobbyTiles.set(story, left);
        else this.nonLobbyTiles.delete(story);
      }
    }
    if (unit.kind === "lobby") {
      const left = (this.lobbyTiles.get(unit.floor) ?? 0) - unit.width;
      if (left > 0) this.lobbyTiles.set(unit.floor, left);
      else this.lobbyTiles.delete(unit.floor);
    }
  }

  reindex(): void {
    this.structure.clear();
    this.structKind.clear();
    this.rooms.clear();
    this.byId.clear();
    this.lobbyTiles.clear();
    this.nonLobbyTiles.clear();
    for (const u of this.units) this.register(u);
    // Deserialize bulk-assigns `this.transports` before calling reindex, so
    // rebuild the transport index (and drop any stale stop lists) here too.
    this.transportsById.clear();
    this.stopsCache.clear();
    for (const t of this.transports) this.transportsById.set(t.id, t);
    // Note: reindex intentionally does NOT re-run syncExpressStopsForFloor.
    // Every real edit (place / removeUnit) already keeps expresses in sync at
    // the time of the flip, so a save written after this fix is self-consistent.
    // A blanket resync on load would silently overwrite a player who deliberately
    // set `setStop(id, lobbyFloor, false)` to skip a sky lobby — so we deliberately
    // leave loaded skipFloors alone.
    this.revision++;
  }

  /** Count existing units/transports of a kind (across both layers). */
  private countKind(kind: FacilityKind): number {
    let n = 0;
    for (const u of this.units) if (u.kind === kind) n++;
    for (const t of this.transports) if (t.kind === kind) n++;
    return n;
  }

  /**
   * Enforce the 1994 hard build caps (single kinds via {@link BUILD_CAPS},
   * pooled groups like elevator shafts / walkways via {@link POOLED_CAPS}).
   * Returns a failure reason if the cap is reached, else undefined.
   */
  private capReason(kind: FacilityKind): string | undefined {
    const single = BUILD_CAPS[kind];
    if (single !== undefined && this.countKind(kind) >= single) {
      return `Only ${single} ${FACILITIES[kind].name}${single === 1 ? "" : "s"} allowed per tower.`;
    }
    for (const pool of POOLED_CAPS) {
      if (!pool.kinds.includes(kind)) continue;
      const total = pool.kinds.reduce((sum, k) => sum + this.countKind(k), 0);
      if (total >= pool.cap) return `Only ${pool.cap} ${pool.label} allowed per tower.`;
    }
    return undefined;
  }

  /** True if any tile of the span sits on a lobby (transit-only) concourse. */
  private spanHasLobby(floor: number, x: number, width: number): boolean {
    return this.spanSome(floor, x, width, (k) => this.structKind.get(k) === "lobby");
  }

  /**
   * Shared room-placement validation for {@link canPlace} and
   * {@link canPlaceRoomIgnoringFloor} — the single source of truth for the rules
   * that govern where a room may sit. Returns a failure reason, or undefined if
   * placement is allowed. `requireFloor` demands existing floor structure under
   * every story (false when a room auto-lays its own floor on placement).
   */
  private roomPlacementReason(
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
    const cap = this.capReason(kind);
    if (cap) return cap;
    // Multi-story facilities (e.g. the cinema) occupy several floors upward.
    const hgt = facilityFloors(kind);
    if (floor + hgt - 1 > GRID.maxFloor) return "Not enough floors above for this facility.";
    // Basement-only facilities must sit entirely underground (floors below 1).
    if (f.basement && floor + hgt - 1 >= 1) return `${f.name} can only be built in the basement.`;
    // The ground floor (level 1) is the tower's entrance concourse — a lobby,
    // never a room floor — exactly as in the original.
    if (coversGroundFloor(floor, hgt)) {
      return "The ground floor is a lobby concourse. Build rooms on floor 2 and up.";
    }
    // Offices, condos and hotels need daylight; only commercial/service go below.
    if (floor < 1 && NO_BASEMENT_KINDS.has(kind)) return `${f.name} can't be built in the basement.`;
    for (let fl = floor; fl < floor + hgt; fl++) {
      if (!this.roomSpanFree(fl, x, f.width)) return "Something is already here.";
      if (requireFloor && !this.spanHasFloor(fl, x, f.width)) return "Build floors on every story first.";
      // Lobbies are transit concourses — no rooms may sit on them, exactly as in
      // the original, where the ground/sky lobby floors stay clear.
      if (this.spanHasLobby(fl, x, f.width)) return "Lobbies are transit-only. Build rooms on a standard floor.";
      // Sky-lobby canon: once a sky-lobby floor is claimed (any lobby on it),
      // the WHOLE story is a concourse, so a room on any tile of that story is
      // refused, not just one overlapping a lobby tile. Fires after spanHasLobby
      // so a room straddling a lobby tile keeps the more specific "transit-only"
      // reason, while a room on a non-lobby tile of a claimed sky-lobby gets the
      // "sky lobby" reason.
      if (isSkyLobbyFloor(fl) && this.floorHasLobby(fl)) {
        return "This room would sit on a sky lobby. Move it up or down a story.";
      }
    }
    return undefined;
  }

  canPlace(kind: FacilityKind, floor: number, x: number): PlaceResult {
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
      if (kind === "floor" && isSkyLobbyFloor(floor) && this.floorHasLobby(floor)) {
        return { ok: false, reason: "Sky lobbies are concourses. Only lobby tiles go here." };
      }
      if (kind === "lobby" && isSkyLobbyFloor(floor) && this.floorHasNonLobbyContent(floor)) {
        return { ok: false, reason: "Clear the floor tiles or rooms here first, then place your sky lobby." };
      }
      if (!this.structureSpanFree(floor, x, f.width)) {
        // A lobby may upgrade plain floor tiles in place (the sky-lobby
        // conversion): the lobby is structural too, so support for the story
        // above is preserved without ever passing through a hanging state.
        if (kind !== "lobby" || !this.spanUpgradeableToLobby(floor, x, f.width)) {
          return { ok: false, reason: "Structure already here." };
        }
        if (!this.roomSpanFree(floor, x, f.width)) {
          return { ok: false, reason: "Lobbies are transit-only. Clear the rooms here first." };
        }
      }
      if (!this.isSupported(floor, x, f.width)) {
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

    const reason = this.roomPlacementReason(kind, floor, x, true);
    return reason ? { ok: false, reason } : { ok: true };
  }

  /**
   * Like {@link canPlace} for a room, but does NOT require the floor to already
   * exist — used when a room auto-lays its own floor on placement.
   */
  canPlaceRoomIgnoringFloor(kind: FacilityKind, floor: number, x: number): PlaceResult {
    if (isStructural(kind) || FACILITIES[kind].transport) return { ok: false, reason: "Not a room." };
    const reason = this.roomPlacementReason(kind, floor, x, false);
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
  canPlaceStructureIgnoringSupport(kind: FacilityKind, floor: number, x: number): PlaceResult {
    if (!isStructural(kind)) return { ok: false, reason: "Not a structural tile." };
    const f = FACILITIES[kind];
    if (floor < GRID.minFloor || floor > GRID.maxFloor) {
      return { ok: false, reason: "Outside the buildable range." };
    }
    if (x < 0 || x + f.width > GRID.width) return { ok: false, reason: "Off the edge of the lot." };
    if (kind === "lobby" && !isLobbyFloor(floor)) {
      return { ok: false, reason: "Lobbies only go on the ground floor and every 15th floor (15, 30, 45…)." };
    }
    if (!this.structureSpanFree(floor, x, f.width)) {
      // Same in-place floor→lobby upgrade allowance as canPlace: a lobby may sit
      // on plain floor tiles, anything else is a real collision.
      if (kind !== "lobby" || !this.spanUpgradeableToLobby(floor, x, f.width)) {
        return { ok: false, reason: "Structure already here." };
      }
      if (!this.roomSpanFree(floor, x, f.width)) {
        return { ok: false, reason: "Lobbies are transit-only. Clear the rooms here first." };
      }
    }
    return { ok: true };
  }

  /** How many floor tiles under a room's footprint don't yet exist. */
  missingFloorCount(floor: number, x: number, width: number, hgt: number): number {
    let n = 0;
    for (let fl = floor; fl < floor + hgt; fl++) {
      for (let i = 0; i < width; i++) if (!this.structure.has(this.key(fl, x + i))) n++;
    }
    return n;
  }

  /** The shared "no floating overhangs" rule: every tile of an above-ground
   *  span must rest on structure directly below it. */
  private restsOnStoryBelow(floor: number, x: number, width: number): boolean {
    return this.spanEvery(floor - 1, x, width, (k) => this.structure.has(k));
  }

  /**
   * True if a room may be supported here. Above ground a room must sit fully on
   * the floor directly below it (no floating overhangs / diagonal stacking).
   * The ground floor rests on the earth, and basements hang off the level above,
   * so those connect by simply touching the existing tower.
   */
  spanConnects(floor: number, x: number, width: number, hgt: number): boolean {
    if (this.units.length === 0) return false;
    if (floor >= 2) return this.restsOnStoryBelow(floor, x, width);
    for (let fl = floor; fl < floor + hgt; fl++) {
      for (let i = -1; i <= width; i++) if (this.structure.has(this.key(fl, x + i))) return true;
    }
    for (let i = 0; i < width; i++) {
      if (this.structure.has(this.key(floor - 1, x + i)) || this.structure.has(this.key(floor + hgt, x + i))) return true;
    }
    return false;
  }

  /**
   * Auto-lay the floor tiles under a room's footprint, building outward so each
   * new tile stays supported. Returns the number of tiles created, or fails
   * (rolling back) if the footprint can't be connected to the tower.
   */
  ensureFloorUnder(floor: number, x: number, width: number, hgt: number): { ok: boolean; reason?: string; count: number } {
    let remaining: { fl: number; x: number }[] = [];
    for (let fl = floor; fl < floor + hgt; fl++) {
      for (let i = 0; i < width; i++) if (!this.structure.has(this.key(fl, x + i))) remaining.push({ fl, x: x + i });
    }
    if (remaining.length === 0) return { ok: true, count: 0 };
    const placed: number[] = [];
    let progress = true;
    while (remaining.length > 0 && progress) {
      progress = false;
      const still: { fl: number; x: number }[] = [];
      for (const m of remaining) {
        const r = this.place("floor", m.fl, m.x);
        if (r.ok && r.unitId !== undefined) {
          placed.push(r.unitId);
          progress = true;
        } else {
          still.push(m);
        }
      }
      remaining = still;
    }
    if (remaining.length > 0) {
      for (const id of placed) this.removeUnit(id);
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
   * neighboring lobby with lobby tiles, every room bridges to a neighboring
   * floor with plain floor. Only empty, supportable tiles are returned: above
   * ground each bridge tile needs structure directly below (no floating
   * overhangs), while the ground and basement rest on a run that is flanked by
   * structure on both ends and so always fills. A multi-story facility's upper
   * story may rest on the bridge its own lower story will lay, so the stories
   * are scanned bottom-up and lower planned tiles count as support for the one
   * above (both walkways of a stacked pair of cinemas fill, not just the base).
   *
   * The plan is exactly the set {@link fillBridge} lays: the scan reads only
   * columns outside the footprint, so laying the footprint (before or after)
   * can't change it, and a caller can size the charge from its length.
   * Non-mutating.
   */
  bridgeFillPlan(kind: FacilityKind, floor: number, x: number, width: number, hgt: number): { fl: number; x: number }[] {
    // Only rooms (plain-floor substrate) and lobbies bridge; a bare floor tool
    // has its own drag-run and would otherwise fill sideways to any neighbor,
    // and transports (elevators/stairs) never carry a horizontal substrate.
    if ((isStructural(kind) && kind !== "lobby") || FACILITIES[kind].transport) return [];
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
      return this.structure.has(this.key(fl - 1, tx)) || (plannedByFloor.get(fl - 1)?.has(tx) ?? false);
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
        const k = this.structKind.get(this.key(fl, tx));
        if (k === undefined) continue; // still scanning the gap
        if (k === substrate) for (let g = tx + 1; g < x; g++) add(g);
        break; // first structure hit ends the scan, whether or not it matched
      }
      // Nearest structure after the footprint, mirror of the above. Emit
      // right-side tiles from the neighbor INWARD (descending x) so the ground
      // and basement outward-fill drains in a single pass instead of walking
      // support back tile by tile through retries.
      for (let tx = x + width; tx < GRID.width; tx++) {
        const k = this.structKind.get(this.key(fl, tx));
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
  fillBridge(kind: FacilityKind, floor: number, x: number, width: number, hgt: number): number[] {
    const substrate: FacilityKind = kind === "lobby" ? "lobby" : "floor";
    let remaining = this.bridgeFillPlan(kind, floor, x, width, hgt);
    const placed: number[] = [];
    let progress = true;
    while (remaining.length > 0 && progress) {
      progress = false;
      const still: { fl: number; x: number }[] = [];
      for (const m of remaining) {
        const r = this.place(substrate, m.fl, m.x);
        if (r.ok && r.unitId !== undefined) {
          placed.push(r.unitId);
          progress = true;
        } else {
          still.push(m);
        }
      }
      remaining = still;
    }
    return placed;
  }

  /**
   * Whether a new floor span is structurally supported. Above ground every
   * tile must rest on structure directly below — extending sideways past the
   * story underneath would leave the floor hanging in midair. The ground
   * floor rests on the earth and basements are embedded in it, so those
   * connect by simply touching the existing tower (side, above, or below).
   */
  private isSupported(floor: number, x: number, width: number): boolean {
    if (this.units.length === 0) {
      return floor === 1; // the founding strip must be the ground floor
    }
    if (floor >= 2) return this.restsOnStoryBelow(floor, x, width);
    for (let i = -1; i <= width; i++) {
      if (this.structure.has(this.key(floor, x + i))) return true;
    }
    for (let i = 0; i < width; i++) {
      if (
        this.structure.has(this.key(floor - 1, x + i)) ||
        this.structure.has(this.key(floor + 1, x + i))
      ) {
        return true;
      }
    }
    return false;
  }

  place(kind: FacilityKind, floor: number, x: number): PlaceResult {
    const check = this.canPlace(kind, floor, x);
    if (!check.ok) return check;
    const f = FACILITIES[kind];
    // In-place floor→lobby upgrade: clear the plain floor tiles being replaced
    // before registering the lobby, so the structure index never goes stale.
    // (canPlace guaranteed any structure in the span is plain floor.)
    if (kind === "lobby") {
      for (let i = 0; i < f.width; i++) {
        const sid = this.structure.get(this.key(floor, x + i));
        if (sid !== undefined) this.removeUnit(sid);
      }
    }
    const unit: Unit = {
      id: this.nextId++,
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
    this.units.push(unit);
    this.register(unit);
    if (kind === "weddingHall") this.builtWeddingHall = true;
    // First lobby tile on this floor → it just became a (sky) lobby, so bring any
    // express spanning it into line (it now stops here).
    if (kind === "lobby" && this.lobbyTiles.get(floor) === unit.width) {
      this.syncExpressStopsForFloor(floor);
    }
    this.revision++;
    return { ok: true, unitId: unit.id };
  }

  /** The ONE span rule (and its message) shared by placement and resize, so
   *  the two paths can never drift apart again. Undefined when the span is
   *  legal for this kind. */
  private spanReason(kind: FacilityKind, bottom: number, top: number): string | undefined {
    const maxSpan = maxSpanFor(kind);
    if (top - bottom <= maxSpan) return undefined;
    return isFixedSpanTransport(kind)
      ? `${FACILITIES[kind].name} links exactly two floors.`
      : `This elevator can span at most ${maxSpan} floors (${maxSpan + 1} stops).`;
  }

  /** Validate a transport placement without mutating anything. */
  validateTransport(kind: FacilityKind, x: number, bottom: number, top: number): PlaceResult {
    const f = FACILITIES[kind];
    if (!f.transport) return { ok: false, reason: "Not a transport." };
    const cap = this.capReason(kind);
    if (cap) return { ok: false, reason: cap };
    if (top <= bottom) return { ok: false, reason: "Transport needs height." };
    if (x < 0 || x + f.width > GRID.width) {
      return { ok: false, reason: "Off the edge of the lot." };
    }
    const spanBad = this.spanReason(kind, bottom, top);
    if (spanBad) return { ok: false, reason: spanBad };
    // Canon: escalators serve commercial spaces (shops/food/theatres), not office
    // complexes — so they may not be placed on a floor that holds an office.
    if (kind === "escalator") {
      for (const fl of [bottom, top]) {
        if (this.units.some((u) => u.kind === "office" && u.floor === fl)) {
          return { ok: false, reason: "Escalators can't serve office floors. They link commercial floors only." };
        }
      }
    }


    // Transports may NOT overlap other shafts, and every floor they serve
    // must exist as built structure at the shaft, so elevators can never
    // float outside the tower. Rooms are deliberately NOT a collision: a
    // shaft may share a cell with a room and simply draws in front of it,
    // as in the original, where lifts overlap facilities.
    for (let fl = bottom; fl <= top; fl++) {
      if (!this.shaftHasStructureAt(fl, x, f.width)) {
        return { ok: false, reason: NEEDS_FLOORS };
      }
      for (const t of this.transports) {
        if (this.transportOverlaps(t, x, f.width, fl)) {
          // Stacked stair/escalator flights may share their LANDING floor —
          // the top of one is the bottom of the next, and the flights occupy
          // different bands — so a continuous stair run stacks in one column,
          // exactly like the original. The stack must align EXACTLY (same
          // column and width); a partially offset flight is still a collision.
          if (
            isFixedSpanTransport(kind) &&
            isFixedSpanTransport(t.kind) &&
            t.x === x &&
            t.width === f.width &&
            (bottom === t.top || top === t.bottom)
          ) {
            continue;
          }
          return { ok: false, reason: "Transport shafts cannot overlap." };
        }
      }
    }
    return { ok: true };
  }

  /** Convenience boolean dry-run for previews. */
  placeTransportDryRun(kind: FacilityKind, x: number, bottom: number, top: number): boolean {
    return this.validateTransport(kind, x, bottom, top).ok;
  }

  placeTransport(
    kind: FacilityKind,
    x: number,
    bottom: number,
    top: number,
  ): PlaceResult {
    const valid = this.validateTransport(kind, x, bottom, top);
    if (!valid.ok) return valid;
    const f = FACILITIES[kind];
    const span = top - bottom;
    // Clamp the initial car count to the kind's own cap (the single source of
    // truth) so a fresh shaft can never open above what setCars would allow.
    const cars = isElevatorKind(kind) ? Math.min(maxCarsFor(kind), Math.max(1, Math.ceil(span / 6))) : 0;
    const t: Transport = {
      id: this.nextId++,
      kind,
      x,
      width: f.width,
      bottom,
      top,
      cars,
      carPositions: Array.from({ length: cars }, (_, i) => bottom + i),
      carDir: Array.from({ length: cars }, () => 0),
      load: 0,
    };
    this.transports.push(t);
    this.transportsById.set(t.id, t);
    // Express elevators are lobby-to-lobby by definition: seed their skip list so
    // a freshly placed express actually behaves like one (stops only at lobby /
    // sky-lobby floors plus its own endpoints), instead of stopping everywhere
    // until the player opens the editor.
    if (kind === "elevatorExpress") this.setExpressStops(t.id);
    this.revision++;
    return { ok: true, transportId: t.id };
  }

  private transportOverlaps(t: Transport, x: number, width: number, floor: number): boolean {
    if (floor < t.bottom || floor > t.top) return false;
    return x < t.x + t.width && x + width > t.x;
  }

  /**
   * Why a unit may not be removed by the player, or undefined if removal is
   * safe. Mirrors the placement invariant: above ground, structure must rest
   * on the story below, so a floor/lobby tile can't be pulled out from under
   * standing structure. (Internal callers like {@link ensureFloorUnder}'s
   * rollback bypass this via {@link removeUnit} directly.)
   */
  removalReason(id: number): string | undefined {
    const u = this.byId.get(id);
    if (!u || !isStructural(u.kind)) return undefined;
    // Canon (1994 SimTower): once a lobby is placed, it cannot be bulldozed.
    // Applies at EVERY floor including the ground concourse (floor 1). The
    // sky-lobby-claimed placement rule scopes ground floor 1 out of the
    // placement half of the canon, but permanence has no such scope: a ground
    // lobby tile is just as final as a sky-lobby tile. Fires FIRST so the
    // canon reason wins over the generic structural message when both would
    // apply (a lobby with structure resting on it). Internal callers that
    // need to revert a lobby tile (bridge rollback, ensureFloorUnder rollback)
    // go through {@link removeUnit} directly and are unaffected.
    if (u.kind === "lobby") {
      return "Lobby tiles are permanent. The 1994 game does not let you remove them.";
    }
    if (u.floor >= 1 && !this.structureSpanFree(u.floor + 1, u.x, u.width)) {
      return "Remove the story above first. Floors can't hang in midair.";
    }
    return undefined;
  }

  removeUnit(id: number): Unit | undefined {
    const idx = this.units.findIndex((u) => u.id === id);
    if (idx === -1) return undefined;
    const [u] = this.units.splice(idx, 1);
    this.unregister(u);
    // Derive from what actually still stands, so bulldozing one of two halls
    // doesn't wrongly clear the flag while a hall remains.
    if (u.kind === "weddingHall") {
      this.builtWeddingHall = this.units.some((x) => x.kind === "weddingHall");
    }
    // Last lobby tile gone → the floor is no longer a lobby, so express elevators
    // spanning it stop stopping there.
    if (u.kind === "lobby" && !this.floorHasLobby(u.floor)) {
      this.syncExpressStopsForFloor(u.floor);
    }
    this.revision++;
    return u;
  }

  /**
   * Grow or shrink a transport's served range. Returns the number of floors
   * added (negative if removed) on success, or a failure reason. Newly served
   * floors are validated against rooms and other shafts.
   */
  resizeTransport(id: number, newBottom: number, newTop: number): PlaceResult & { added?: number } {
    const t = this.transportById(id);
    if (!t) return { ok: false, reason: "No such transport." };
    if (newTop <= newBottom) return { ok: false, reason: "Transport needs height." };
    if (newBottom < GRID.minFloor || newTop > GRID.maxFloor) {
      return { ok: false, reason: "Outside the buildable range." };
    }
    // Same span rules as placement — the extend arrows must not stretch a
    // transport past what validateTransport would ever allow (this once let
    // stairs grow the whole tower height one extend at a time).
    const spanBad = this.spanReason(t.kind, newBottom, newTop);
    if (spanBad) return { ok: false, reason: spanBad };
    // Validate only the floors that are being newly added.
    for (let fl = newBottom; fl <= newTop; fl++) {
      if (fl >= t.bottom && fl <= t.top) continue; // already served
      // Every newly-served floor needs built structure under the shaft — the
      // same invariant validateTransport enforces — so an extend can't float
      // the shaft into empty sky. (Rooms no longer block; it draws in front.)
      if (!this.shaftHasStructureAt(fl, t.x, t.width)) {
        return { ok: false, reason: NEEDS_FLOORS };
      }
      for (const other of this.transports) {
        if (other.id === t.id) continue;
        if (this.transportOverlaps(other, t.x, t.width, fl)) {
          return { ok: false, reason: "Another shaft is in the way." };
        }
      }
    }
    const before = t.top - t.bottom + 1;
    const prevBottom = t.bottom;
    const prevTop = t.top;
    t.bottom = newBottom;
    t.top = newTop;
    // Keep cars within the new range.
    for (let i = 0; i < t.carPositions.length; i++) {
      t.carPositions[i] = Math.max(newBottom, Math.min(newTop, t.carPositions[i]));
    }
    // Keep express skipFloors coherent after a resize (a common build-order path):
    //   - Drop the new endpoints from skip, so shrinking onto a formerly-skipped
    //     floor doesn't disconnect the new endpoint.
    //   - Add newly-in-span non-lobby floors to skip, so growing past new territory
    //     doesn't turn the express into a local elevator.
    //   - Floors that were already in-span are LEFT ALONE, so a manual stop the
    //     player set inside the old range survives the resize.
    if (t.kind === "elevatorExpress") {
      // Rebuild the skip set by (a) preserving only in-span choices — pruning
      // anything now outside [newBottom, newTop] so the model can't carry ghost
      // floors after a shrink, (b) dropping the new endpoints (they always
      // stop), and (c) adding newly-in-span non-lobby floors so a grow doesn't
      // turn the express into a local elevator.
      const skip = new Set<number>();
      for (const f of t.skipFloors ?? []) {
        if (f > newBottom && f < newTop) skip.add(f); // in-span (endpoints excluded)
      }
      for (let fl = newBottom + 1; fl < newTop; fl++) {
        if (fl >= prevBottom && fl <= prevTop) continue; // preserve pre-existing choice
        if (!this.floorHasLobby(fl)) skip.add(fl); // newly-in-span non-lobby → skip
      }
      t.skipFloors = [...skip].sort((a, b) => a - b);
    }
    this.revision++;
    return { ok: true, added: newTop - newBottom + 1 - before };
  }

  /** Change the number of elevator cars (1..max for that elevator type). */
  setCars(id: number, cars: number): boolean {
    const t = this.transportById(id);
    if (!t || !isElevatorKind(t.kind)) return false;
    cars = Math.max(1, Math.min(maxCarsFor(t.kind), cars));
    if (cars === t.cars) return false;
    if (cars > t.cars) {
      for (let i = t.cars; i < cars; i++) {
        t.carPositions.push(t.bottom);
        t.carDir.push(1);
      }
    } else {
      t.carPositions.length = cars;
      t.carDir.length = cars;
    }
    t.cars = cars;
    this.revision++;
    return true;
  }

  /** Floors that have at least one lobby tile (express stops). Derived from the
   *  per-floor lobbyTiles counter kept live by register/unregister, so this is
   *  O(k log k) in the number of lobby floors (a handful in practice) instead
   *  of O(n) over every unit — hot-path callers (ElevatorDispatch) invoke it
   *  every tick. */
  lobbyFloors(): number[] {
    return [...this.lobbyTiles.keys()].sort((a, b) => a - b);
  }

  /** Floor-distance from `floor` to the nearest (sky) lobby, in floors — 0 on a
   *  lobby floor itself. The ground floor (1) always counts as a lobby: visitors
   *  enter there, so it anchors the distance even before any lobby tile is laid.
   *  Drives the W3 commercial-near-lobby income penalty (see
   *  {@link EconomySystem.collectTrafficIncome}). O(lobby floors) — a handful. */
  nearestLobbyFloorDistance(floor: number): number {
    let best = Math.abs(floor - 1); // ground is always the tower's entrance lobby
    for (const lf of this.lobbyTiles.keys()) {
      const d = Math.abs(floor - lf);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Toggle whether a transport stops at a floor (express configuration).
   * Endpoints are always stops — a shaft's bottom and top can't be skipped, or
   * it would be disconnected from itself — so a request to skip an endpoint is
   * silently ignored regardless of `stop`.
   */
  setStop(id: number, floor: number, stop: boolean): boolean {
    const t = this.transportById(id);
    if (!t || floor < t.bottom || floor > t.top) return false;
    // Endpoints are always stops (a shaft can't disconnect from itself). Report
    // success — the request was valid and the endpoint is already stopping —
    // regardless of the requested `stop` value.
    if (floor === t.bottom || floor === t.top) return true;
    const skip = new Set(t.skipFloors ?? []);
    if (stop) skip.delete(floor);
    else skip.add(floor);
    t.skipFloors = [...skip].sort((a, b) => a - b);
    this.revision++;
    return true;
  }

  /** Does this floor carry at least one lobby tile (a ground/sky lobby)? O(1). */
  floorHasLobby(floor: number): boolean {
    return (this.lobbyTiles.get(floor) ?? 0) > 0;
  }

  /** Does this floor carry any non-lobby content: a plain floor tile, or any
   *  room whose footprint (including a multi-story facility's upper story)
   *  covers this floor? Used by the sky-lobby-commit check to refuse a lobby
   *  placement on a story that already carries something else. O(1) via the
   *  `nonLobbyTiles` counter, which register/unregister keep in lockstep. */
  floorHasNonLobbyContent(floor: number): boolean {
    return (this.nonLobbyTiles.get(floor) ?? 0) > 0;
  }

  /**
   * Keep express elevators serving a floor's *current* lobby status: an express
   * spanning `floor` stops there iff it's a (sky) lobby. Called whenever a floor
   * gains or loses its lobby, so an express built before a sky lobby (or one
   * built after) both end up stopping at it — "express stops at sky lobbies" holds
   * no matter the build order. Only the changed floor is touched, so a player's
   * manual stop choices on *other* floors are preserved. Endpoints always stop.
   */
  private syncExpressStopsForFloor(floor: number): void {
    const stop = this.floorHasLobby(floor);
    for (const t of this.transports) {
      if (t.kind !== "elevatorExpress") continue;
      if (floor <= t.bottom || floor >= t.top) continue; // endpoints always stop
      this.setStop(t.id, floor, stop);
    }
  }

  /** Configure an elevator to stop only at lobby floors (true express). */
  setExpressStops(id: number): boolean {
    const t = this.transportById(id);
    if (!t) return false;
    const lobbies = new Set(this.lobbyFloors());
    const skip: number[] = [];
    for (let fl = t.bottom; fl <= t.top; fl++) {
      // Always keep the bottom and top as stops so it stays connected.
      if (fl === t.bottom || fl === t.top) continue;
      if (!lobbies.has(fl)) skip.push(fl);
    }
    t.skipFloors = skip;
    this.revision++;
    return true;
  }

  /** Make a transport stop at every floor again. */
  clearStops(id: number): boolean {
    const t = this.transportById(id);
    if (!t) return false;
    t.skipFloors = [];
    this.revision++;
    return true;
  }

  removeTransport(id: number): Transport | undefined {
    const idx = this.transports.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    const [t] = this.transports.splice(idx, 1);
    this.transportsById.delete(id);
    this.stopsCache.delete(id);
    this.revision++;
    return t;
  }

  transportAt(floor: number, x: number): Transport | undefined {
    return this.transports.find(
      (t) => floor >= t.bottom && floor <= t.top && x >= t.x && x < t.x + t.width,
    );
  }

  /** Does this transport actually stop at the given floor (vs. skip it)? */
  stopsAt(t: Transport, floor: number): boolean {
    if (floor < t.bottom || floor > t.top) return false;
    return !(t.skipFloors && t.skipFloors.includes(floor));
  }

  /** Memoized stop lists, keyed by transport id and validated against
   *  {@link revision} (every stop-affecting edit bumps it). Callers treat the
   *  returned array as read-only. */
  private stopsCache = new Map<number, { rev: number; stops: number[] }>();

  /** The floors a transport actually stops at — the single stop-enumeration
   *  every consumer (routing graphs, dispatch, staff components) shares. */
  stopsOf(t: Transport): number[] {
    const cached = this.stopsCache.get(t.id);
    if (cached && cached.rev === this.revision) return cached.stops;
    const s: number[] = [];
    for (let fl = t.bottom; fl <= t.top; fl++) if (this.stopsAt(t, fl)) s.push(fl);
    this.stopsCache.set(t.id, { rev: this.revision, stops: s });
    return s;
  }

  /** Per-floor list of transport-column spans `[x0, x1)` for shafts that STOP at
   *  the floor AND make it reachable from the lobby — a dead-ended shaft the
   *  crowd can't actually use never counts as "an elevator nearby". Memoized by
   *  {@link revision}, the same signal `servedFloors` invalidates on, so the
   *  W1 per-office scan below is O(offices × shaftsOnFloor) with no re-walk. */
  private transportColsRev = -1;
  private transportColsByFloor = new Map<number, Array<[number, number]>>();
  private transportColumns(floor: number): Array<[number, number]> {
    if (this.transportColsRev !== this.revision) {
      this.transportColsByFloor.clear();
      const served = this.servedFloors();
      for (const t of this.transports) {
        // Service elevators are staff-only (canon): tenants and visitors can't
        // ride them, so a service shaft next door is NOT the "elevator nearby"
        // that spares an office the walk. Mirror servedFloors, which excludes them
        // for the same reason — otherwise a staff shaft would silently suppress W1.
        if (isStaffOnlyTransport(t.kind)) continue;
        for (let fl = t.bottom; fl <= t.top; fl++) {
          // A shaft only helps a floor it stops at, and only if that floor is
          // actually connected to the lobby (a shaft to nowhere is no relief).
          if (!this.stopsAt(t, fl) || !served.has(fl)) continue;
          const list = this.transportColsByFloor.get(fl);
          // Clamp the span to the lot: a transport's width is trusted from the
          // save (and can be a legacy value after a catalog change), so an
          // over-wide or corrupt shaft must not report a column past the lot
          // edge and skew the W1 distance scan.
          const span: [number, number] = [Math.max(0, t.x), Math.min(t.x + t.width, GRID.width)];
          if (list) list.push(span);
          else this.transportColsByFloor.set(fl, [span]);
        }
      }
      this.transportColsRev = this.revision;
    }
    return this.transportColsByFloor.get(floor) ?? [];
  }

  /**
   * Nearest reachable transport (elevator/stair/escalator) to a unit, as the
   * horizontal gap in tiles between the unit's footprint and the closest shaft
   * column that stops on its floor and is lobby-connected. `0` when a shaft
   * abuts or overlaps the footprint; `Infinity` when the floor has no reachable
   * shaft at all (the plain access drain already covers that case). This is the
   * canon "stairs/elevators are far away" measure — offices past ~79 tiles wear
   * their tenants down (W1, see {@link Simulation.updateSatisfaction}).
   */
  nearestTransportDistance(u: Unit): number {
    const cols = this.transportColumns(u.floor);
    if (cols.length === 0) return Infinity;
    const left = u.x;
    const right = u.x + u.width;
    let best = Infinity;
    for (const [x0, x1] of cols) {
      // Overlap ⇒ 0; shaft entirely left ⇒ left - x1; entirely right ⇒ x0 - right.
      const gap = x1 <= left ? left - x1 : x0 >= right ? x0 - right : 0;
      if (gap < best) best = gap;
      if (best === 0) break;
    }
    return best;
  }

  /** Cached reachable-floor set, keyed by {@link revision} so it is recomputed
   * only when transports/structure actually change (not every tick per unit). */
  private servedRev = -1;
  private servedSet = new Set<number>([1]);

  /** The full set of floors reachable from the ground lobby, memoized per revision. */
  private servedFloors(): Set<number> {
    if (this.servedRev === this.revision) return this.servedSet;
    const reachable = new Set<number>([1]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of this.transports) {
        // Service elevators are staff-only (canon): tenants and visitors never
        // ride them, so they don't make a floor reachable. Staff travel is the
        // separate {@link staffConnected} network.
        if (isStaffOnlyTransport(t.kind)) continue;
        let connects = false;
        for (let fl = t.bottom; fl <= t.top; fl++) {
          if (this.stopsAt(t, fl) && reachable.has(fl)) {
            connects = true;
            break;
          }
        }
        if (connects) {
          for (let fl = t.bottom; fl <= t.top; fl++) {
            if (this.stopsAt(t, fl) && !reachable.has(fl)) {
              reachable.add(fl);
              changed = true;
            }
          }
        }
      }
    }
    this.servedSet = reachable;
    this.servedRev = this.revision;
    return reachable;
  }

  /**
   * A floor is "served" if a chain of transports connects it to the ground
   * lobby (floor 1). Transports link via the floors they actually STOP at, so
   * an express that skips a floor does not serve it (it only passes through).
   * O(1) after the first call per revision — see {@link servedFloors}.
   */
  isFloorServed(floor: number): boolean {
    if (floor === 1) return true;
    return this.servedFloors().has(floor);
  }

  /** The full set of ground-connected floors (memoized per revision). Read-only
   * view for the spatial congestion model. */
  servedFloorSet(): ReadonlySet<number> {
    return this.servedFloors();
  }

  /** Cached staff-network components, keyed by {@link revision}. */
  private staffRev = -1;
  private staffComp = new Map<number, number>();

  /**
   * Label every floor touched by a staff-capable transport (service elevators,
   * stairs, escalators — never passenger elevators) with a connected-component id.
   * Housekeepers travel this network to reach dirty rooms, exactly as in the
   * original where staff ride the service elevator while guests take the
   * passenger ones. Floors with no staff transport get no label: staff there
   * can only work their own floor.
   */
  private staffComponents(): Map<number, number> {
    if (this.staffRev === this.revision) return this.staffComp;
    const comp = new Map<number, number>();
    const relabel = (from: number, to: number) => {
      for (const [f, c] of comp) if (c === from) comp.set(f, to);
    };
    let next = 0;
    for (const t of this.transports) {
      if (!isStaffTransportKind(t.kind)) continue;
      const stops = this.stopsOf(t);
      if (stops.length < 2) continue;
      // Merge every component this transport touches into one.
      let id: number | undefined;
      for (const f of stops) {
        const c = comp.get(f);
        if (c === undefined) continue;
        if (id === undefined) id = c;
        else if (c !== id) relabel(c, id);
      }
      if (id === undefined) id = next++;
      for (const f of stops) comp.set(f, id);
    }
    this.staffComp = comp;
    this.staffRev = this.revision;
    return comp;
  }

  /** True if staff stationed on floor `a` can reach floor `b` (same floor, or
   *  connected through service elevators / stairs / escalators). */
  staffConnected(a: number, b: number): boolean {
    if (a === b) return true;
    const comp = this.staffComponents();
    const ca = comp.get(a);
    return ca !== undefined && ca === comp.get(b);
  }

  /**
   * Count parking SPACES that actually function — i.e. connect to a Parking Ramp
   * through a contiguous chain of parking/ramp tiles (canon: "spaces must be
   * touching the ramp or another space"). Flood-fills from every operational ramp
   * over adjacent parking/ramp tiles (horizontally along a floor, and vertically
   * only across a ramp — cars change floors through ramps); a space with no path
   * back to a ramp is a dead X.
   */
  functionalParkingSpots(): number {
    return this.functionalParkingSet().size;
  }

  /**
   * The set of parking-SPACE unit ids that function — i.e. chain back to a ramp
   * (see {@link functionalParkingSpots}). A space whose id is absent is dead (no
   * relief). NOT memoized: it depends on unit STATE (construction/fire), and
   * those transitions don't bump {@link revision} (finishConstruction / the fire
   * handlers mutate `state` directly), so a revision cache would go stale. The
   * flood-fill is bounded by the parking region with O(1) `roomAt`, so it's cheap
   * enough for the callers (inspector, economy, and a once-per-sync render read).
   */
  functionalParkingSet(): ReadonlySet<number> {
    const usable = (u?: Unit): boolean =>
      !!u && (u.kind === "parking" || u.kind === "parkingRamp") && isOperational(u);
    const stack: [number, number][] = [];
    for (const u of this.units) {
      if (u.kind === "parkingRamp" && isOperational(u)) {
        for (let i = 0; i < u.width; i++) stack.push([u.floor, u.x + i]);
      }
    }
    const visited = new Set<string>();
    const reached = new Set<number>(); // parking-unit ids connected to a ramp
    while (stack.length) {
      const [f, x] = stack.pop()!;
      const key = `${f}:${x}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const u = this.roomAt(f, x);
      if (!usable(u)) continue;
      if (u!.kind === "parking") reached.add(u!.id);
      // Horizontal chaining is always allowed (spaces touch along a floor).
      stack.push([f, x - 1], [f, x + 1]);
      // Cars only change floors through a RAMP, so a vertical step is allowed
      // only from a ramp tile — two parking spaces stacked with no ramp between
      // them do NOT connect (they'd be dead Xs in the original).
      if (u!.kind === "parkingRamp") stack.push([f - 1, x], [f + 1, x]);
    }
    return reached;
  }

  facilityOf(unit: Unit): Facility {
    return FACILITIES[unit.kind];
  }

  totalPopulation(): number {
    let pop = 0;
    for (const u of this.units) {
      if (isPresent(u)) {
        pop += residentCount(u);
      }
    }
    return pop;
  }

  /**
   * Venue-associated meal customers currently out of their home unit: the sum of
   * the transient `outForMeal` overlay across present units. These are the
   * workers/residents who left an office, condo, or hotel room for a meal round-
   * trip and are now at (or travelling to/from) a venue. Reading the derived
   * overlay counts each round-tripper exactly once (spawn increments, despawn
   * decrements a single origin), so it never double-counts and needs no scan of
   * the crowd's Person array. Mirrors {@link totalPopulation}: gated on
   * `isPresent` and a pure read with no side effects.
   *
   * `outForMeal` is a `Unit` field this class already owns, so the count lives
   * here (single source of truth); {@link Crowd.mealAssociatedPopulation} is the
   * meal-domain seam that delegates to it. `opts.excludeHotelOrigin` drops
   * customers whose origin is a hotel room, so the star census can hold the canon
   * "hotel guests stop counting at 3 stars" rule for meal customers too.
   */
  associatedPopulation(opts?: { excludeHotelOrigin?: boolean }): number {
    const excludeHotel = opts?.excludeHotelOrigin ?? false;
    let pop = 0;
    for (const u of this.units) {
      const out = u.outForMeal ?? 0;
      if (out <= 0 || !isPresent(u)) continue;
      if (excludeHotel && isHotelKind(u.kind)) continue;
      pop += out;
    }
    return pop;
  }

  allocateId(): number {
    return this.nextId++;
  }

  setNextId(n: number): void {
    this.nextId = n;
  }

  getNextId(): number {
    return this.nextId;
  }
}
