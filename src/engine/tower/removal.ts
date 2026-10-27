import type { Tower } from "../Tower";
import type { Unit } from "../types";

/**
 * Unit removal (friend functions of {@link Tower}). The unit list keeps its
 * order, which saves, `pickX` and every pass over the list read, so a removal
 * closes the gap instead of swapping the last unit in. Each function costs
 * one pass over the list however many units it removes (HP-6 in
 * `docs/performance/hot-path-review.md`): a command that removes several
 * units hands them over together. `engine-rs/src/tower_removal.rs` is the
 * Rust twin.
 */

/** The lobby brush's state while {@link withLobbyUpgrades} runs: every unit
 *  placed, in the order placed, whether a lobby took a floor tile's place,
 *  no unit placed stands before `first` in the list, and the positions of
 *  the plain floor tiles on floor `atFloor`, read on the first upgrade. */
interface LobbyUpgrades {
  readonly placed: Unit[];
  upgraded: boolean;
  first: number;
  at: Map<Unit, number> | undefined;
  atFloor: number;
}

const upgrades = new WeakMap<Tower, LobbyUpgrades>();

/** Remove one unit by id, or answer undefined when no unit has it. */
export function removeUnit(tower: Tower, id: number): Unit | undefined {
  const u = tower.byId.get(id);
  if (!u) return undefined;
  const units = tower.units;
  // A rollback's one unit is usually the last one laid.
  const idx = units[units.length - 1] === u ? units.length - 1 : units.indexOf(u);
  if (idx === -1) return undefined;
  units.splice(idx, 1);
  forgetPositions(tower, 1);
  settleRemovals(tower, [u]);
  return u;
}

/**
 * Remove every unit `ids` names in one pass, with the same result as
 * removing them one by one in that order: the same list, indexes, express
 * stops, wedding hall flag and revision. An id that names nothing, or that
 * repeats, removes nothing. Answers the units removed, in `ids` order.
 */
export function removeUnits(tower: Tower, ids: Iterable<number>): Unit[] {
  const gone: Unit[] = [];
  const going = new Set<Unit>();
  for (const id of ids) {
    const u = tower.byId.get(id);
    if (u && !going.has(u)) {
      going.add(u);
      gone.push(u);
    }
  }
  if (gone.length === 0) return gone;
  if (gone.length === 1) {
    const u = removeUnit(tower, gone[0].id);
    return u ? [u] : [];
  }
  // The engine's callers are rollbacks, which remove units their own command
  // just laid, so look for them from the end and close the gaps from the
  // first one found (any other list still ends right, at up to one pass).
  const units = tower.units;
  const found = new Set<Unit>();
  let first = units.length;
  for (let i = units.length - 1; i >= 0 && found.size < going.size; i--) {
    if (going.has(units[i])) {
      found.add(units[i]);
      first = i;
    }
  }
  let kept = first;
  for (let i = first; i < units.length; i++) {
    const u = units[i];
    if (!found.has(u)) units[kept++] = u;
  }
  units.length = kept;
  forgetPositions(tower, found.size);
  // Only what stood in the list was removed, as one by one would answer.
  const removed = found.size === gone.length ? gone : gone.filter((u) => found.has(u));
  settleRemovals(tower, removed);
  return removed;
}

/**
 * What removing `gone` (in that order) changes besides the list: the indexes,
 * the wedding hall flag, the express stops of each floor that lost its last
 * lobby tile, synced in the order the one-by-one removals would sync them,
 * and one revision per unit.
 */
function settleRemovals(tower: Tower, gone: readonly Unit[]): void {
  let lastLobby: Map<number, Unit> | undefined;
  let wedding = false;
  for (const u of gone) {
    tower.unregister(u);
    if (u.kind === "weddingHall") wedding = true;
    if (u.kind === "lobby") (lastLobby ??= new Map()).set(u.floor, u);
  }
  // Derive from what actually still stands, so bulldozing one of two halls
  // doesn't wrongly clear the flag while a hall remains.
  if (wedding) tower.builtWeddingHall = tower.units.some((x) => x.kind === "weddingHall");
  // Last lobby tile gone → the floor is no longer a lobby, so express elevators
  // spanning it stop stopping there.
  if (lastLobby) {
    for (const u of gone) {
      if (lastLobby.get(u.floor) === u && !tower.floorHasLobby(u.floor)) tower.syncExpressStopsForFloor(u.floor);
    }
  }
  tower.revision += gone.length;
}

/**
 * Run `run` (the lobby brush) with each lobby it lays over plain floor taking
 * the floor tile's place in the list. Laying them one by one would remove
 * each floor tile from the list (a pass per tile) and append its lobby, so
 * when a lobby took a tile's place, everything `run` placed moves to the end
 * of the list once, in the order placed. The list then ends as laying one by
 * one would leave it: the units that stood before, in their order, then the
 * units placed that still stand. Between the brush's tiles the list holds
 * exactly the units that stand. The move bumps the revision, so a cache keyed
 * on it rebuilds in the final order. A brush inside a brush joins the outer
 * one.
 *
 * Cost: the first upgrade makes one pass that keeps the positions of the
 * plain floor tiles on its floor (a few hundred at most), and the move is a
 * pass from the first unit placed, however many tiles the brush upgrades. A
 * removal inside the brush (only a build's rollback removes) shifts the
 * positions, and an upgrade on another floor (only a brush inside a brush
 * changes floor) needs that floor's, so the next upgrade reads them again.
 */
export function withLobbyUpgrades<T>(tower: Tower, run: () => T): T {
  if (upgrades.has(tower)) return run();
  const batch: LobbyUpgrades = { placed: [], upgraded: false, first: tower.units.length, at: undefined, atFloor: 0 };
  upgrades.set(tower, batch);
  try {
    return run();
  } finally {
    upgrades.delete(tower);
    if (batch.upgraded) moveToEnd(tower, batch.placed, batch.first);
  }
}

/**
 * Inside {@link withLobbyUpgrades}, take plain floor tile `id` off the tower
 * (indexes, revision) and answer its place in the list for the lobby laid
 * over it; outside, answer undefined and leave the tile for the caller to
 * remove. The positions of the plain floor tiles on its floor are read in one
 * pass, the first time.
 */
export function takeFloorSlot(tower: Tower, id: number): number | undefined {
  const batch = upgrades.get(tower);
  const u = tower.byId.get(id);
  if (!batch || u?.kind !== "floor") return undefined;
  if (!batch.at || batch.atFloor !== u.floor) {
    batch.at = new Map();
    batch.atFloor = u.floor;
    const units = tower.units;
    for (let i = 0; i < units.length; i++) {
      const x = units[i];
      if (x.kind === "floor" && x.floor === u.floor) batch.at.set(x, i);
    }
  }
  const idx = batch.at.get(u);
  if (idx === undefined || tower.units[idx] !== u) return undefined;
  batch.at.delete(u);
  settleRemovals(tower, [u]);
  return idx;
}

/** Add a newly placed unit to the list: at the end, or at `slot`, the place
 *  {@link takeFloorSlot} answered. The lobby brush notes it for the move. */
export function addUnit(tower: Tower, unit: Unit, slot: number | undefined): void {
  if (slot === undefined) tower.units.push(unit);
  else tower.units[slot] = unit;
  const batch = upgrades.get(tower);
  if (!batch) return;
  const at = slot ?? tower.units.length - 1;
  batch.placed.push(unit);
  batch.first = Math.min(batch.first, at);
  if (slot !== undefined) batch.upgraded = true;
  if (unit.kind === "floor" && unit.floor === batch.atFloor) batch.at?.set(unit, at);
}

/** Removing `count` units inside the brush shifts the positions read for
 *  it, and may move each unit placed that many places nearer the start. */
function forgetPositions(tower: Tower, count: number): void {
  const batch = upgrades.get(tower);
  if (!batch) return;
  batch.at = undefined;
  batch.first = Math.max(0, batch.first - count);
}

/** Move `placed` (those still in the list) to the end of the list, in the
 *  order placed, looking from `first`, before which none of them should
 *  stand. Should one stand there after all, the rest of the list is read
 *  too, so the order still ends right. */
function moveToEnd(tower: Tower, placed: readonly Unit[], first: number): void {
  const moving = new Set(placed);
  let expected = 0;
  for (const u of placed) if (tower.byId.get(u.id) === u) expected++;
  const standing = new Set<Unit>();
  const units = tower.units;
  let from = first;
  let kept = first;
  for (;;) {
    for (let i = from; i < units.length; i++) {
      const u = units[i];
      if (moving.has(u)) standing.add(u);
      else units[kept++] = u;
    }
    units.length = kept;
    if (standing.size === expected || from === 0) break;
    from = 0;
    kept = 0;
  }
  for (const u of placed) if (standing.has(u)) units.push(u);
  tower.revision++;
}
