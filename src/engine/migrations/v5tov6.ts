/**
 * v5 -> v6 save migration: grow every one-story party hall into the two-story
 * room canon (and the TDT format, tile codes 29/30) always intended. Extracted
 * from `saveMigration.ts`; pure functions on `SerializedGame`.
 *
 * Party-hall height is catalog-derived (`facilityFloors`, not a per-unit field),
 * so the moment the catalog gained `floors: 2` every saved hall became two
 * stories in the engine's eyes. This migration reconciles the SAVED layout with
 * that: it makes sure each hall's newly-claimed upper story is clear and paved
 * so the hall never silently overlaps whatever the player stacked above it.
 */
import { FACILITIES, GRID, facilityFloors, isFacilityKind } from "../facilities";
import type { LogEntry, SerializedGame, SerializedUnit } from "../types";
import { floatingStructureCount, migrationLooksValid } from "./v1tov2";

const HALL = "partyHall" as const;

/** v5 -> v6 hop: run the party-hall expansion once. The pass stamps `version: 6`
 *  on its output itself, so `data` is passed through at its ORIGINAL version.
 *  That matters for the validity net's baseline: `migrationLooksValid(data)`
 *  reads the input's halls at their pre-v6 height (one story), so the delta check
 *  compares the true prior layout against the migrated one. Pre-stamping v6 here
 *  would make the baseline see the not-yet-expanded halls as two stories and
 *  report the input as already invalid, defeating the "delta vs input" guard. */
export function upgradeV5toV6(data: SerializedGame): SerializedGame {
  return expandLegacyPartyHalls(data);
}

/**
 * Reconcile every party hall with its two-story footprint. Per hall, in
 * priority order:
 *
 *  1. **Expand in place.** If the story directly above is inside the tower, free
 *     of other rooms, and pave-able without floating, keep the hall where it is
 *     (its lower/entrance floor and transport untouched) and pave the upper span.
 *  2. **Relocate to the nearest fit.** Otherwise slide the hall to the closest
 *     spot where a full two-story footprint fits: both stories free of other
 *     rooms, and the footprint attaches to existing structure so no fresh tile
 *     floats (either story is paved where missing, but only where it rests on a
 *     built neighbor, never onto bare lot). Search the hall's own bottom floor
 *     first (nearest column wins), then floors outward.
 *  3. **Drop as a last resort.** If no two-story slot exists anywhere, remove the
 *     hall and log it. Losing one room beats a corrupt, overlapping tower.
 *
 * The migration never removes existing structure or any non-hall room; a
 * relocated hall leaves its old floor tiles behind (as the v1->v2 reflow does).
 * Placement is greedy: a placed hall's footprint becomes an obstacle for later
 * halls, so the result is DETERMINISTIC (halls are processed in save order) but
 * not order-independent, if two halls contend for one slot the earlier hall in
 * save order wins it and the other takes the next-nearest. Idempotent: an
 * already-v6 hall owns a clear, paved upper story, so it re-expands in place at
 * its current spot and nothing moves.
 */
export function expandLegacyPartyHalls(data: SerializedGame): SerializedGame {
  const src = Array.isArray(data.units) ? data.units : [];
  const LOT = GRID.width;
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

  // Paved columns per story (floor + lobby tiles). A room can only sit where the
  // story it rests on is built, and a freshly-paved tile may only land where it
  // is supported, so both checks read this index. Not mutated during placement:
  // upper tiles we pave never become support for another hall this pass, which
  // conservatively blocks float chains.
  const structCols = new Map<number, Set<number>>();
  const addCol = (map: Map<number, Set<number>>, f: number, x: number): void => {
    let s = map.get(f);
    if (!s) map.set(f, (s = new Set<number>()));
    s.add(x);
  };
  // Columns occupied by OTHER (non-hall) rooms, expanded over every story they
  // span. Non-hall rooms never move, so this is built once.
  const roomOcc = new Map<number, Set<number>>();
  // Lobby concourse columns (ground floor + sky lobbies). A lobby is transit-only
  // structure: the engine forbids a room from sitting on it, so no story of a
  // hall's footprint may land on one, even though a lobby still counts as support
  // for the story above. This is what keeps the migration from manufacturing a
  // ground-floor straddle or a sky-lobby overlap the placement rules would reject.
  const lobbyCols = new Map<number, Set<number>>();
  for (const u of src) {
    if (!u || !isFacilityKind(u.kind)) continue;
    // Coerce geometry to the SAME on-lot integers `Simulation.deserialize` will
    // apply right after this migration (finite-or-fallback, floor clamped for the
    // kind's height, x on-lot, width >= 1 and inside the lot). Indexing the raw
    // save values instead would let a forged `width: 0` contribute no columns, or
    // an off-lot `x` index the wrong ones, so the obstacle/support map would
    // disagree with the tower that actually loads, and a hall could be paved or
    // placed where a clamped room really sits. Mirrors serialization.ts.
    const stories = facilityFloors(u.kind);
    const f = Math.max(GRID.minFloor, Math.min(GRID.maxFloor - (stories - 1), Math.round(num(u.floor, 1))));
    const x0 = Math.max(0, Math.min(LOT - 1, Math.round(num(u.x, 0))));
    const w = Math.max(1, Math.min(LOT - x0, Math.round(num(u.width, FACILITIES[u.kind].width))));
    if (u.kind === "floor" || u.kind === "lobby") {
      for (let i = 0; i < w; i++) {
        addCol(structCols, f, x0 + i);
        if (u.kind === "lobby") addCol(lobbyCols, f, x0 + i);
      }
      continue;
    }
    if (u.kind === HALL) continue; // halls are placed below, never a fixed obstacle
    for (let s = 0; s < stories; s++)
      for (let i = 0; i < w; i++) addCol(roomOcc, f + s, x0 + i);
  }

  // Footprints of halls already placed this pass (both stories), so two halls
  // can never claim the same tile.
  const hallOcc = new Map<number, Set<number>>();

  const paved = (f: number, x: number): boolean => structCols.get(f)?.has(x) === true;
  const spanClear = (F: number, x: number, w: number): boolean => {
    for (const f of [F, F + 1]) {
      const rooms = roomOcc.get(f);
      const halls = hallOcc.get(f);
      const lobbies = lobbyCols.get(f);
      for (let i = 0; i < w; i++) {
        if (rooms?.has(x + i) || halls?.has(x + i) || lobbies?.has(x + i)) return false;
      }
    }
    return true;
  };
  // Whether a two-story footprint column at bottom floor F can host the hall
  // without floating any freshly-paved tile AND while attaching to the tower's
  // existing structure (a relocated hall extends the built tower, it never
  // floats out onto bare lot). The footprint is two stories tall, so this reduces
  // to: its base tile is, or rests on, an already-built tile. The migration paves
  // only the footprint's own tiles, and the support rule matches
  // `floatingStructureCount`, so a column that passes here never raises the float
  // count:
  //   - above ground the base is the LOWER story: it is built, or rests on the
  //     built floor below (ground, floor 1, must be an existing tile, so a hall
  //     never lands on bare earth at an arbitrary column);
  //   - a basement footprint's base is its UPPER story (nearest the ground): it
  //     is built, or rests on the built story above it;
  //   - the far story is then paved resting on the base.
  const colSupported = (F: number, x: number): boolean => {
    if (F >= 2) return paved(F, x) || paved(F - 1, x);
    if (F === 1) return paved(F, x); // existing ground tile only, never bare earth
    if (F === 0) return paved(F, x) || paved(F + 1, x); // straddle (lobby-blocked in practice)
    return paved(F + 1, x) || paved(F + 2, x); // basement: upper is/rests-on built structure
  };
  // A valid two-story slot: both stories in bounds and on-lot, structurally
  // supportable without floating, and both stories free of other rooms and
  // already-placed halls. EITHER story is paved where missing when the hall
  // lands (see the output pass).
  const fits = (F: number, x: number, w: number): boolean => {
    if (F < GRID.minFloor || F + 1 > GRID.maxFloor || x < 0 || x + w > LOT) return false;
    for (let i = 0; i < w; i++) if (!colSupported(F, x + i)) return false;
    return spanClear(F, x, w);
  };

  // Candidate bottom floors in nearness order: the hall's own floor first (so an
  // in-place or same-floor horizontal slide wins), then alternating outward.
  const floorCandidates = (home: number): number[] => {
    const out: number[] = [];
    const push = (f: number): void => {
      if (f >= GRID.minFloor && f + 1 <= GRID.maxFloor) out.push(f);
    };
    push(home);
    for (let d = 1; d <= GRID.maxFloor - GRID.minFloor; d++) {
      push(home - d);
      push(home + d);
    }
    return out;
  };

  const halls = src.filter((u): u is SerializedUnit => !!u && u.kind === HALL);
  const kept: SerializedUnit[] = [];
  let dropped = 0;
  for (const u of halls) {
    const w = Math.max(1, Math.min(LOT, Math.round(num(u.width, FACILITIES[HALL].width))));
    const homeFloor = Math.max(GRID.minFloor, Math.min(GRID.maxFloor - 1, Math.round(num(u.floor, 1))));
    const homeX = Math.max(0, Math.min(LOT - w, Math.round(num(u.x, 0))));

    let placed: { floor: number; x: number } | null = null;
    // In place first: keep the hall unmoved when its own upper story is clear.
    if (fits(homeFloor, homeX, w)) {
      placed = { floor: homeFloor, x: homeX };
    } else {
      // Nearest fit: for each candidate floor, the column closest to home wins;
      // the first floor that offers any slot is taken (own floor scanned first,
      // so a horizontal slide beats changing floors).
      outer: for (const F of floorCandidates(homeFloor)) {
        let best: number | null = null;
        for (let x = 0; x + w <= LOT; x++) {
          if (!fits(F, x, w)) continue;
          if (best === null || Math.abs(x - homeX) < Math.abs(best - homeX)) best = x;
        }
        if (best !== null) {
          placed = { floor: F, x: best };
          break outer;
        }
      }
    }

    if (!placed) {
      dropped++;
      continue;
    }
    for (const f of [placed.floor, placed.floor + 1])
      for (let i = 0; i < w; i++) addCol(hallOcc, f, placed.x + i);
    kept.push({ ...u, floor: placed.floor, x: placed.x, width: w });
  }

  // Fresh floor tiles get ids past the highest existing id (a garbled `nextId`
  // must never collide with a live unit).
  let nextId = Number.isFinite(data.nextId) ? Math.floor(data.nextId as number) : 1;
  for (const u of src) if (u && Number.isFinite(u.id)) nextId = Math.max(nextId, Math.floor(u.id) + 1);

  const others = src.filter((u) => !!u && u.kind !== HALL);
  const out: SerializedUnit[] = [...others, ...kept];
  // Pave any tile of a placed hall's footprint that isn't already structure.
  // Either story may need a fresh floor tile: a relocated hall can bridge onto
  // structure below (or above, in the basement), so its own entrance floor is
  // sometimes newly paved too, not just the upper story. `colSupported`
  // guaranteed every such tile rests on built structure, so none floats.
  for (const h of kept) {
    for (const f of [h.floor, h.floor + 1]) {
      for (let i = 0; i < h.width!; i++) {
        const x = h.x + i;
        if (paved(f, x)) continue;
        addCol(structCols, f, x); // dedupe across overlapping halls
        out.push({
          id: nextId++,
          kind: "floor",
          floor: f,
          x,
          width: 1,
          state: "occupied",
          satisfaction: 1,
          occupants: 0,
          everOccupied: false,
          pendingIncome: 0,
          label: "Floor",
        });
      }
    }
  }

  const withLog = (units: SerializedUnit[], dropCount: number): SerializedGame => {
    let log = data.log;
    if (dropCount > 0) {
      const entry: LogEntry = {
        minute: Number.isFinite(data.minutes) ? (data.minutes as number) : 0,
        text:
          dropCount === 1
            ? "A party hall was removed: it is now two stories and had no room to grow. Rebuild it where two floors are free."
            : `${dropCount} party halls were removed: they are now two stories and had no room to grow. Rebuild them where two floors are free.`,
        kind: "bad",
      };
      log = Array.isArray(data.log) ? [...data.log, entry] : [entry];
    }
    return { ...data, version: 6, units, nextId, ...(log ? { log } : {}) };
  };

  const result = withLog(out, dropped);
  // Validity net, mirroring the sibling migrations (v1->v2): the constructed
  // layout must not overlap rooms, run off-lot, or add floating structure. It is
  // correct by construction today, but if a future edit ever broke that, ship a
  // guaranteed-valid save rather than a corrupt one. The only safe fallback here
  // is to drop every party hall (leaving a legacy 1-story hall in place would be
  // the very overlap we are guarding against): removing rooms can neither overlap
  // nor float, so this always passes. Both checks are deltas against the input so
  // a pre-existing defect in a hand-edited/corrupt save is never blamed on this
  // migration (and never triggers the drop-all): the input's own halls read as
  // one story at its pre-v6 version, so `inputValid` reflects the tower's real
  // prior state. It never triggers on a well-formed save.
  const inputValid = migrationLooksValid(data);
  if ((inputValid && !migrationLooksValid(result)) || floatingStructureCount(result) > floatingStructureCount(data)) {
    return withLog(others, halls.length);
  }
  return result;
}
