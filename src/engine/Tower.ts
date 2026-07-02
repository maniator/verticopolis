import { BUILD_CAPS, FACILITIES, GRID, POOLED_CAPS, facilityFloors, isElevatorKind, maxCarsFor, maxSpanFor } from "./facilities";
import { isOperational } from "./types";
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
  /** floor → number of lobby structural tiles on it, so "is this a lobby floor?"
   *  is O(1). Used to keep express-elevator stops synced with sky lobbies as they
   *  are built or removed, regardless of the order relative to the elevator. */
  private lobbyTiles = new Map<number, number>();

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

  /** True if no room occupies any tile of the span. */
  private roomSpanFree(floor: number, x: number, width: number): boolean {
    for (let i = 0; i < width; i++) {
      if (this.rooms.has(this.key(floor, x + i))) return false;
    }
    return true;
  }

  /** True if no structure occupies any tile of the span. */
  private structureSpanFree(floor: number, x: number, width: number): boolean {
    for (let i = 0; i < width; i++) {
      if (this.structure.has(this.key(floor, x + i))) return false;
    }
    return true;
  }

  /** True if structural floor exists across the whole span. */
  spanHasFloor(floor: number, x: number, width: number): boolean {
    for (let i = 0; i < width; i++) {
      if (!this.structure.has(this.key(floor, x + i))) return false;
    }
    return true;
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
    for (const u of this.units) this.register(u);
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
    for (let i = 0; i < width; i++) {
      if (this.structKind.get(this.key(floor, x + i)) === "lobby") return true;
    }
    return false;
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
      return "The ground floor is a lobby concourse — build rooms on floor 2 and up.";
    }
    // Offices, condos and hotels need daylight; only commercial/service go below.
    if (floor < 1 && NO_BASEMENT_KINDS.has(kind)) return `${f.name} can't be built in the basement.`;
    for (let fl = floor; fl < floor + hgt; fl++) {
      if (!this.roomSpanFree(fl, x, f.width)) return "Something is already here.";
      if (requireFloor && !this.spanHasFloor(fl, x, f.width)) return "Build floors on every story first.";
      // Lobbies are transit concourses — no rooms may sit on them, exactly as in
      // the original, where the ground/sky lobby floors stay clear.
      if (this.spanHasLobby(fl, x, f.width)) return "Lobbies are transit-only — build rooms on a standard floor.";
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
      if (!this.structureSpanFree(floor, x, f.width)) {
        return { ok: false, reason: "Structure already here." };
      }
      if (!this.isSupported(floor, x, f.width)) {
        return {
          ok: false,
          reason:
            floor >= 2
              ? "Floors and lobbies must sit on the story below — no floating overhangs."
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

  /** How many floor tiles under a room's footprint don't yet exist. */
  missingFloorCount(floor: number, x: number, width: number, hgt: number): number {
    let n = 0;
    for (let fl = floor; fl < floor + hgt; fl++) {
      for (let i = 0; i < width; i++) if (!this.structure.has(this.key(fl, x + i))) n++;
    }
    return n;
  }

  /**
   * True if a room may be supported here. Above ground a room must sit fully on
   * the floor directly below it (no floating overhangs / diagonal stacking).
   * The ground floor rests on the earth, and basements hang off the level above,
   * so those connect by simply touching the existing tower.
   */
  spanConnects(floor: number, x: number, width: number, hgt: number): boolean {
    if (this.units.length === 0) return false;
    if (floor >= 2) {
      for (let i = 0; i < width; i++) {
        if (!this.structure.has(this.key(floor - 1, x + i))) return false;
      }
      return true;
    }
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
      return { ok: false, reason: "Build next to the tower — you can't build in midair.", count: 0 };
    }
    return { ok: true, count: placed.length };
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
    if (floor >= 2) {
      for (let i = 0; i < width; i++) {
        if (!this.structure.has(this.key(floor - 1, x + i))) return false;
      }
      return true;
    }
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
    const span = top - bottom;
    if ((kind === "stairs" || kind === "escalator") && span > 1) {
      return { ok: false, reason: `${f.name} spans exactly one floor.` };
    }
    // Canon: escalators serve commercial spaces (shops/food/theatres), not office
    // complexes — so they may not be placed on a floor that holds an office.
    if (kind === "escalator") {
      for (const fl of [bottom, top]) {
        if (this.units.some((u) => u.kind === "office" && u.floor === fl)) {
          return { ok: false, reason: "Escalators serve commercial floors only — not offices." };
        }
      }
    }
    const maxSpan = maxSpanFor(kind);
    if (isElevatorKind(kind) && span > maxSpan) {
      return { ok: false, reason: `This elevator can span at most ${maxSpan} floors (${maxSpan + 1} stops).` };
    }

    // Transports share the structural column but cannot collide with rooms or
    // other shafts — and every floor they serve must actually exist as built
    // structure at the shaft, so elevators can never float outside the tower.
    for (let fl = bottom; fl <= top; fl++) {
      let hasStructure = false;
      for (let i = 0; i < f.width; i++) {
        // Transport may share a cell with a room — the shaft simply draws in
        // front of it (as in the original, where lifts overlap facilities).
        if (this.structure.has(this.key(fl, x + i))) hasStructure = true;
      }
      if (!hasStructure) {
        return {
          ok: false,
          reason: "Transport must run through built floors — lay floors first.",
        };
      }
      for (const t of this.transports) {
        if (this.transportOverlaps(t, x, f.width, fl)) {
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
    const cars = isElevatorKind(kind) ? Math.min(8, Math.max(1, Math.ceil(span / 6))) : 0;
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
    if (u.floor >= 1) {
      for (let i = 0; i < u.width; i++) {
        if (this.structure.has(this.key(u.floor + 1, u.x + i))) {
          return "Remove the story above first — floors can't hang in midair.";
        }
      }
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
    const t = this.transports.find((x) => x.id === id);
    if (!t) return { ok: false, reason: "No such transport." };
    if (newTop <= newBottom) return { ok: false, reason: "Transport needs height." };
    if (newBottom < GRID.minFloor || newTop > GRID.maxFloor) {
      return { ok: false, reason: "Outside the buildable range." };
    }
    const maxSpan = maxSpanFor(t.kind);
    if (isElevatorKind(t.kind) && newTop - newBottom > maxSpan) {
      return { ok: false, reason: `This elevator can span at most ${maxSpan} floors (${maxSpan + 1} stops).` };
    }
    // Validate only the floors that are being newly added.
    for (let fl = newBottom; fl <= newTop; fl++) {
      if (fl >= t.bottom && fl <= t.top) continue; // already served
      // Every newly-served floor needs built structure under the shaft — the
      // same invariant validateTransport enforces — so an extend can't float
      // the shaft into empty sky. (Rooms no longer block; it draws in front.)
      let hasStructure = false;
      for (let i = 0; i < t.width; i++) {
        if (this.structure.has(this.key(fl, t.x + i))) hasStructure = true;
      }
      if (!hasStructure) {
        return { ok: false, reason: "Transport must run through built floors — lay floors first." };
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
    const t = this.transports.find((x) => x.id === id);
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

  /**
   * Toggle whether a transport stops at a floor (express configuration).
   * Endpoints are always stops — a shaft's bottom and top can't be skipped, or
   * it would be disconnected from itself — so a request to skip an endpoint is
   * silently ignored regardless of `stop`.
   */
  setStop(id: number, floor: number, stop: boolean): boolean {
    const t = this.transports.find((x) => x.id === id);
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
    const t = this.transports.find((x) => x.id === id);
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
    const t = this.transports.find((x) => x.id === id);
    if (!t) return false;
    t.skipFloors = [];
    this.revision++;
    return true;
  }

  removeTransport(id: number): Transport | undefined {
    const idx = this.transports.findIndex((t) => t.id === id);
    if (idx === -1) return undefined;
    const [t] = this.transports.splice(idx, 1);
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
      if (u.state === "occupied" || u.state === "asleep" || u.state === "moving_in") {
        pop += FACILITIES[u.kind].population;
      }
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
