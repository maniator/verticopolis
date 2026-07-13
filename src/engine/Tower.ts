import { facilityFloors } from "./facilities";
import type { Facility, FacilityKind, PlaceResult, Transport, Unit } from "./types";
import { isStructural } from "./tower/towerTopology";
import * as placement from "./tower/placement";
import * as transport from "./tower/transport";
import * as routing from "./tower/routing";

export class Tower {
  units: Unit[] = [];
  transports: Transport[] = [];
  nextId = 1;
  towerName = "Tower One";
  builtWeddingHall = false;
  /** Bumped whenever units/transports are added or removed (render caching). */
  revision = 0;
  /** Bumped whenever a room's transient meal overlay changes, so the renderer can
   *  repaint visible office/condo headcounts without treating it as a build edit. */
  mealOverlayRevision = 0;

  /** "floor:x" -> structural unit id (floor/lobby). */
  structure = new Map<string, number>();
  /** "floor:x" -> which structural kind occupies it (floor vs lobby). */
  structKind = new Map<string, "floor" | "lobby">();
  /** "floor:x" -> room unit id. */
  rooms = new Map<string, number>();
  /** id → unit index, kept in lockstep with `units` via register/unregister, so
   *  tile lookups are O(1) rather than a linear scan (hot in the flood-fills and
   *  the per-frame congestion read). */
  byId = new Map<number, Unit>();
  /** id → transport, kept in lockstep with `transports` (mirror of `byId`). */
  transportsById = new Map<number, Transport>();
  /** floor → number of lobby structural tiles on it, so "is this a lobby floor?"
   *  is O(1). Used to keep express-elevator stops synced with sky lobbies as they
   *  are built or removed, regardless of the order relative to the elevator. */
  lobbyTiles = new Map<number, number>();
  /** floor → number of NON-lobby tiles on it: plain floor tiles plus every
   *  tile a room's footprint covers on this story (a multi-story facility
   *  contributes to each of its stories). Mirror of `lobbyTiles`, kept live by
   *  register/unregister/reindex so `floorHasNonLobbyContent` is O(1) on every
   *  hover-preview frame. */
  nonLobbyTiles = new Map<number, number>();

  key(floor: number, x: number): string {
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
  spanEvery(floor: number, x: number, width: number, pred: (k: string) => boolean): boolean {
    for (let i = 0; i < width; i++) {
      if (!pred(this.key(floor, x + i))) return false;
    }
    return true;
  }

  /** True if `pred` holds for SOME tile key of the span (short-circuits). */
  spanSome(floor: number, x: number, width: number, pred: (k: string) => boolean): boolean {
    return !this.spanEvery(floor, x, width, (k) => !pred(k));
  }

  /** ANY-tile structure check for a shaft cell, a transport floor is valid
   *  when at least one tile under the shaft is built (distinct from
   *  {@link spanHasFloor}, which requires ALL tiles). */
  shaftHasStructureAt(floor: number, x: number, width: number): boolean {
    return this.spanSome(floor, x, width, (k) => this.structure.has(k));
  }

  transportById(id: number): Transport | undefined {
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
  roomSpanFree(floor: number, x: number, width: number): boolean {
    return this.spanEvery(floor, x, width, (k) => !this.rooms.has(k));
  }

  /** True if no structure occupies any tile of the span. */
  structureSpanFree(floor: number, x: number, width: number): boolean {
    return this.spanEvery(floor, x, width, (k) => !this.structure.has(k));
  }

  /** The structural kind occupying a tile ("floor" | "lobby"), if any. */
  structureKindAt(floor: number, x: number): "floor" | "lobby" | undefined {
    return this.structKind.get(this.key(floor, x));
  }

  /** True if every occupied tile of the span is a plain floor (no lobbies),
   *  i.e. a lobby placed here is an in-place upgrade, not a collision. */
  spanUpgradeableToLobby(floor: number, x: number, width: number): boolean {
    return this.spanEvery(floor, x, width, (k) => this.structKind.get(k) !== "lobby");
  }

  /** True if structural floor exists across the whole span. */
  spanHasFloor(floor: number, x: number, width: number): boolean {
    return this.spanEvery(floor, x, width, (k) => this.structure.has(k));
  }

  register(unit: Unit): void {
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

  unregister(unit: Unit): void {
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
    // set `setStop(id, lobbyFloor, false)` to skip a sky lobby, so we deliberately
    // leave loaded skipFloors alone.
    this.revision++;
  }

  /** Count existing units/transports of a kind (across both layers). */
  countKind(kind: FacilityKind): number {
    let n = 0;
    for (const u of this.units) if (u.kind === kind) n++;
    for (const t of this.transports) if (t.kind === kind) n++;
    return n;
  }

  capReason(kind: FacilityKind): string | undefined {
    return placement.capReason(this, kind);
  }

  /** True if any tile of the span sits on a lobby (transit-only) concourse. */
  spanHasLobby(floor: number, x: number, width: number): boolean {
    return this.spanSome(floor, x, width, (k) => this.structKind.get(k) === "lobby");
  }

  roomPlacementReason(
    kind: FacilityKind,
    floor: number,
    x: number,
    requireFloor: boolean,
  ): string | undefined {
    return placement.roomPlacementReason(this, kind, floor, x, requireFloor);
  }

  canPlace(kind: FacilityKind, floor: number, x: number): PlaceResult {
    return placement.canPlace(this, kind, floor, x);
  }

  canPlaceRoomIgnoringFloor(kind: FacilityKind, floor: number, x: number): PlaceResult {
    return placement.canPlaceRoomIgnoringFloor(this, kind, floor, x);
  }

  canPlaceStructureIgnoringSupport(kind: FacilityKind, floor: number, x: number): PlaceResult {
    return placement.canPlaceStructureIgnoringSupport(this, kind, floor, x);
  }

  missingFloorCount(floor: number, x: number, width: number, hgt: number): number {
    return placement.missingFloorCount(this, floor, x, width, hgt);
  }

  restsOnStoryBelow(floor: number, x: number, width: number): boolean {
    return placement.restsOnStoryBelow(this, floor, x, width);
  }

  spanConnects(floor: number, x: number, width: number, hgt: number): boolean {
    return placement.spanConnects(this, floor, x, width, hgt);
  }

  placeStructureRun(
    tiles: { fl: number; x: number }[],
    kind: "floor" | "lobby",
  ): { placed: number[]; stuck: { fl: number; x: number }[] } {
    return placement.placeStructureRun(this, tiles, kind);
  }

  ensureFloorUnder(floor: number, x: number, width: number, hgt: number): { ok: boolean; reason?: string; count: number } {
    return placement.ensureFloorUnder(this, floor, x, width, hgt);
  }

  bridgeFillPlan(kind: FacilityKind, floor: number, x: number, width: number, hgt: number): { fl: number; x: number }[] {
    return placement.bridgeFillPlan(this, kind, floor, x, width, hgt);
  }

  fillBridge(kind: FacilityKind, floor: number, x: number, width: number, hgt: number): number[] {
    return placement.fillBridge(this, kind, floor, x, width, hgt);
  }

  isSupported(floor: number, x: number, width: number): boolean {
    return placement.isSupported(this, floor, x, width);
  }

  place(kind: FacilityKind, floor: number, x: number): PlaceResult {
    return placement.place(this, kind, floor, x);
  }

  spanReason(kind: FacilityKind, bottom: number, top: number): string | undefined {
    return placement.spanReason(this, kind, bottom, top);
  }

  validateTransport(kind: FacilityKind, x: number, bottom: number, top: number): PlaceResult {
    return transport.validateTransport(this, kind, x, bottom, top);
  }

  placeTransportDryRun(kind: FacilityKind, x: number, bottom: number, top: number): boolean {
    return transport.placeTransportDryRun(this, kind, x, bottom, top);
  }

  placeTransport(
    kind: FacilityKind,
    x: number,
    bottom: number,
    top: number,
  ): PlaceResult {
    return transport.placeTransport(this, kind, x, bottom, top);
  }

  transportOverlaps(t: Transport, x: number, width: number, floor: number): boolean {
    return transport.transportOverlaps(this, t, x, width, floor);
  }

  removalReason(id: number): string | undefined {
    return transport.removalReason(this, id);
  }

  removeUnit(id: number): Unit | undefined {
    return transport.removeUnit(this, id);
  }

  layShaftFloors(floors: number[], x: number, width: number): number[] | null {
    return transport.layShaftFloors(this, floors, x, width);
  }

  resizeTransport(id: number, newBottom: number, newTop: number): PlaceResult & { added?: number; floorTilesCreated?: number } {
    return transport.resizeTransport(this, id, newBottom, newTop);
  }

  setCars(id: number, cars: number): boolean {
    return transport.setCars(this, id, cars);
  }

  lobbyFloors(): number[] {
    return transport.lobbyFloors(this);
  }

  nearestLobbyFloorDistance(floor: number): number {
    return transport.nearestLobbyFloorDistance(this, floor);
  }

  setStop(id: number, floor: number, stop: boolean): boolean {
    return transport.setStop(this, id, floor, stop);
  }

  floorHasLobby(floor: number): boolean {
    return transport.floorHasLobby(this, floor);
  }

  floorHasNonLobbyContent(floor: number): boolean {
    return transport.floorHasNonLobbyContent(this, floor);
  }

  syncExpressStopsForFloor(floor: number): void {
    transport.syncExpressStopsForFloor(this, floor);
  }

  setExpressStops(id: number): boolean {
    return transport.setExpressStops(this, id);
  }

  clearStops(id: number): boolean {
    return transport.clearStops(this, id);
  }

  removeTransport(id: number): Transport | undefined {
    return transport.removeTransport(this, id);
  }

  transportAt(floor: number, x: number): Transport | undefined {
    return transport.transportAt(this, floor, x);
  }

  stopsAt(t: Transport, floor: number): boolean {
    return transport.stopsAt(this, t, floor);
  }

  /** Memoized stop lists, keyed by transport id and validated against
   *  {@link revision} (every stop-affecting edit bumps it). Callers treat the
   *  returned array as read-only. */
  stopsCache = new Map<number, { rev: number; stops: number[] }>();

  stopsOf(t: Transport): number[] {
    return transport.stopsOf(this, t);
  }

  /** Per-floor list of transport-column spans `[x0, x1)` for shafts that STOP at
   *  the floor AND make it reachable from the lobby, a dead-ended shaft the
   *  crowd can't actually use never counts as "an elevator nearby". Memoized by
   *  {@link revision}, the same signal `servedFloors` invalidates on, so the
   *  W1 per-office scan below is O(offices × shaftsOnFloor) with no re-walk. */
  transportColsRev = -1;
  transportColsByFloor = new Map<number, Array<[number, number]>>();
  transportColumns(floor: number): Array<[number, number]> {
    return transport.transportColumns(this, floor);
  }

  nearestTransportDistance(u: Unit): number {
    return transport.nearestTransportDistance(this, u);
  }

  /** Cached reachable-floor set, keyed by {@link revision} so it is recomputed
   * only when transports/structure actually change (not every tick per unit). */
  servedRev = -1;
  servedSet = new Set<number>([1]);

  servedFloors(): Set<number> {
    return routing.servedFloors(this);
  }

  isFloorServed(floor: number): boolean {
    return routing.isFloorServed(this, floor);
  }

  servedFloorSet(): ReadonlySet<number> {
    return routing.servedFloorSet(this);
  }

  /** Cached staff-network components, keyed by {@link revision}. */
  staffRev = -1;
  staffComp = new Map<number, number>();

  staffComponents(): Map<number, number> {
    return routing.staffComponents(this);
  }

  staffConnected(a: number, b: number): boolean {
    return routing.staffConnected(this, a, b);
  }

  functionalParkingSpots(): number {
    return routing.functionalParkingSpots(this);
  }

  functionalParkingSet(): ReadonlySet<number> {
    return routing.functionalParkingSet(this);
  }

  facilityOf(unit: Unit): Facility {
    return routing.facilityOf(this, unit);
  }

  totalPopulation(): number {
    return routing.totalPopulation(this);
  }

  associatedPopulation(opts?: { excludeHotelOrigin?: boolean }): number {
    return routing.associatedPopulation(this, opts);
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
