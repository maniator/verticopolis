import { GRID, facilityFloors } from "../facilities";
import { isStructural } from "../tower/towerTopology";
import type { FacilityKind, Unit } from "../types";

/**
 * Forged-save guards for `deserialize` (#537, audit AUD-011/AUD-012): a hard
 * unit-count ceiling checked before any unit object is built, and the
 * unit-layer overlap filter (both NEW in #537), plus the id-repair pass
 * (extracted verbatim from serialization.ts). All three run only at the load
 * trust boundary; the move also keeps serialization.ts under the size ratchet.
 */

/**
 * Hard count ceiling, checked BEFORE the per-unit map constructs anything:
 * within each index layer, every unit occupies at least one tile and
 * footprints may not overlap (placement enforces it, and
 * {@link dropOverlappingUnits} enforces it again on load). There are exactly TWO
 * layers (structure and rooms, mirroring Tower's per-tile maps), so no real
 * tower can hold more units than twice the lot's tile count: a fully floored
 * lot is one width-1 structure unit per tile, and the rooms sitting on it can
 * cover at most the same tiles again. A small file under the decompression
 * byte cap can still inflate to millions of minimal entries, and mapping them
 * would freeze the tab at load (the same hang the transports guard against
 * with their pooled-cap slice). Units past the cap REJECT rather than
 * truncate: transports have a canon pool cap to truncate to, but cutting an
 * arbitrary tail of units would quietly adopt (and re-save) a different tower
 * than the file describes. The overlap filter's drops are a different case:
 * they repair a broken invariant deterministically, exactly like the TDT
 * importer, rather than discarding valid entries by position.
 */
export const UNIT_CAP = 2 * GRID.width * (GRID.maxFloor - GRID.minFloor + 1);

export function assertSaneUnitCount(count: number): void {
  if (count > UNIT_CAP) {
    // Worded "more than" rather than echoing the count: the collector in
    // deserialize bails on the first entry past the cap, so the count it
    // sees is the cap plus one, not the file's full (possibly huge) length.
    throw new Error(
      `This save lists more than ${UNIT_CAP} units, more than the whole lot can hold, so it cannot be a real tower.`,
    );
  }
}

/**
 * Ids drive every by-id lookup, and the renderer keys its retained actors by
 * them, so they must be sane and unique, and the id counter must sit above
 * them all (a corrupt/hand-edited nextId would otherwise mint duplicates for
 * new placements, permanently drawing the wrong room). "Sane" is stricter
 * than finite: a forged id near/past 2^53 would make the ++ repair (and
 * allocateId later) a precision no-op that re-mints the same id forever, so
 * ids must be positive integers under a bound no legit tower approaches. Max
 * over the SANE ids only, then hand each corrupt or duplicated id a fresh
 * one. Returns the repaired next-id counter: the saved value gets the same
 * sanity gate (a forged huge nextId would otherwise win the max and park the
 * counter where ++ stops incrementing). Extracted verbatim from deserialize.
 */
export function repairEntityIds(entities: { id: number }[], rawNextId: unknown): number {
  const ID_CAP = 2 ** 31; // ~2.1e9 placements, far past any real save
  const saneId = (n: unknown): n is number =>
    typeof n === "number" && Number.isInteger(n) && n > 0 && n < ID_CAP;
  let maxLoadedId = 0;
  for (const e of entities) if (saneId(e.id) && e.id > maxLoadedId) maxLoadedId = e.id;
  const seenIds = new Set<number>();
  for (const e of entities) {
    if (!saneId(e.id) || seenIds.has(e.id)) e.id = ++maxLoadedId;
    seenIds.add(e.id);
  }
  const savedNextId = saneId(rawNextId) ? rawNextId : 0;
  return Math.max(savedNextId, maxLoadedId + 1);
}

/**
 * Overlap cross-check, the unit mirror of deserialize's transport pass:
 * placement can never produce two units sharing a tile, but a forged or
 * hand-edited save can, and the per-tile indexes assume the invariant
 * (register is last-wins, unregister deletes shared tiles, so one overlap
 * corrupts census, hit-testing, and removal). Same resolution as the TDT
 * importer's claimRoom (tdtParse.ts): claim every story facilityFloors
 * registers, first kept wins, a later overlapper is dropped. Layered like
 * the indexes themselves: structure (floor/lobby) and rooms live in separate
 * maps and a room legitimately sits ON structure, so each layer claims only
 * against itself. Tile-bitmap based, not the transports' pairwise scan: that
 * one is O(n^2) over a pooled cap of ~88, while a real tower carries tens of
 * thousands of units. Expects geometry already clamped to the lot (the map
 * in deserialize runs first), so rows are indexed in bounds.
 */
export function dropOverlappingUnits(units: Unit[]): Unit[] {
  const claimedStructure = new Map<number, Uint8Array>();
  const claimedRooms = new Map<number, Uint8Array>();
  const claimFootprint = (
    layer: Map<number, Uint8Array>,
    u: { kind: FacilityKind; floor: number; x: number; width: number },
  ): boolean => {
    const stories = facilityFloors(u.kind);
    for (let f = u.floor; f < u.floor + stories; f++) {
      const row = layer.get(f);
      if (row) {
        for (let i = u.x; i < u.x + u.width; i++) if (row[i]) return false;
      }
    }
    for (let f = u.floor; f < u.floor + stories; f++) {
      let row = layer.get(f);
      if (!row) {
        row = new Uint8Array(GRID.width);
        layer.set(f, row);
      }
      row.fill(1, u.x, u.x + u.width);
    }
    return true;
  };
  return units.filter((u) => claimFootprint(isStructural(u.kind) ? claimedStructure : claimedRooms, u));
}
