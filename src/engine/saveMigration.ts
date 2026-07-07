/**
 * Save-format version migrations.
 *
 * Extracted from Simulation so the (growing) migration surface lives in one
 * discoverable, independently-testable place. Everything here is a PURE function
 * on `SerializedGame` — no DOM, no class state — run by `Simulation.deserialize`
 * via {@link migrateSave}. Each `upgradeVNtoVN1` is a standalone step and
 * `migrateSave` just chains them, so a future per-version file split is a trivial
 * move (party decision, 2026-07-07: ship as one module, structured for that).
 */
import { FACILITIES, GRID, facilityFloors, isFacilityKind } from "./facilities";
import { isGameMode } from "./types";
import type { FacilityKind, SerializedGame, Unit } from "./types";

/**
 * Current save-format version. `serialize()` always stamps this; `deserialize()`
 * routes every save through {@link migrateSave} first, so the field is read on
 * load — not merely written — and a future format bump has exactly one place to
 * grow.
 */
export const SAVE_VERSION = 2;

/**
 * The condo sale price BEFORE this build re-anchored the band (old default 2×
 * cost was $120k, now $160k). A pre-mode save's SOLD condo that omitted `rent`
 * sold at this price, so we backfill it on load (see {@link migrateSave}) — the
 * buy-back must mirror what the unit actually sold for, not the new default.
 */
const LEGACY_CONDO_DEFAULT_PRICE = 120_000;

/**
 * Save-format migration seam. Runs before the field-level coercion in
 * `Simulation.deserialize`. Beyond normalizing `version`, it backfills the
 * pre-re-anchor condo sale price for legacy saves so an old tower's buy-back
 * still mirrors its historical sale price, then chains the versioned upgrades.
 */
/** The oldest schema version this migrator understands. A save with no valid
 *  `version` field predates versioning entirely, so it is treated as this — the
 *  OLDEST schema — not the current one: defaulting a versionless save to the
 *  latest would skip every upgrade step (e.g. the v1→v2 reflow) for exactly the
 *  legacy towers that need it. Unknown/garbled versions run migrations
 *  deterministically from the bottom. */
const OLDEST_SAVE_VERSION = 1;

export function migrateSave(data: SerializedGame): SerializedGame {
  // A missing/garbled version is normalized to the OLDEST schema (not the
  // current one) so the upgrade chain runs from the bottom for legacy saves.
  // "Valid" means a whole number ≥ the oldest schema: a non-integer (1.5),
  // zero, negative, NaN, or missing value is treated as legacy so it still runs
  // the v1→v2 reflow rather than silently skipping it. deserialize()'s coercion
  // still hardens every value afterward.
  const valid = Number.isInteger(data.version) && (data.version as number) >= OLDEST_SAVE_VERSION;
  const version = valid ? data.version : OLDEST_SAVE_VERSION;
  let migrated: SerializedGame = data.version === version ? data : { ...data, version };
  // A save with no VALID `mode` predates the condo work (or is corrupt) — the same
  // condition under which deserialize() falls back to Classic, so migration must
  // agree (an invalid mode string must be treated as legacy here too, else the
  // save loads Classic yet skips this backfill). A SOLD condo (owned, not an
  // empty/dead shell) that omitted `rent` sold at the OLD default — stamp it so
  // its buy-back mirrors that historical price instead of picking up the new,
  // higher default via rentOf(). Only touch that exact shape; never re-price a
  // condo that already carries a rent, or an unsold/dead one.
  if (!isGameMode(migrated.mode) && Array.isArray(migrated.units)) {
    migrated = {
      ...migrated,
      units: migrated.units.map((u) =>
        u &&
        u.kind === "condo" &&
        u.everOccupied === true &&
        u.rent === undefined &&
        u.state !== "empty" &&
        u.state !== "gutted" &&
        u.state !== "construction"
          ? { ...u, rent: LEGACY_CONDO_DEFAULT_PRICE }
          : u,
      ),
    };
  }
  // v1 → v2: re-lay each floor's rooms at their canon (post-E1b) widths (the
  // segment-parity reflow). Runs for any v1 save; new saves stamp v2 and skip it.
  if (migrated.version === 1) migrated = upgradeV1toV2(migrated);
  // A save from a newer build (version > SAVE_VERSION) can't be downgraded, so
  // it loads best-effort — the coercion below guards it — rather than throwing
  // away the player's tower.
  return migrated;
}

/**
 * v1 → v2 migration with a safety net. Runs the reflow ({@link reflowV1toV2}); if
 * it throws OR produces an invalid layout (a room overlap or an off-lot room the
 * per-unit hardening couldn't have caused), it falls back to simply stamping v2
 * on the ORIGINAL units. That fallback is always safe — units persist their own
 * width and `deserialize` trusts it, so an un-reflowed old tower loads at its
 * legacy footprints with no corruption (arch §1). Better a tower that keeps
 * legacy widths than a lost or scrambled save.
 */
export function upgradeV1toV2(data: SerializedGame): SerializedGame {
  const safe: SerializedGame = { ...data, version: 2 };
  let out: SerializedGame;
  try {
    out = reflowV1toV2(data);
  } catch {
    return safe;
  }
  // Reject a reflow that overlaps/runs off-lot, OR that introduces a NEW floating
  // floor (a slab the reflow padded over a setback where the story below ends).
  // The delta — not an absolute count — is what matters: an odd hand-built save
  // may already float, and the migration must not be blamed for that; it must only
  // never make it worse. The safe fallback keeps legacy widths, which never float.
  if (!migrationLooksValid(out)) return safe;
  if (floatingStructureCount(out) > floatingStructureCount(data)) return safe;
  return out;
}

/**
 * The invariants the reflow must never violate: no two ROOM footprints overlap on
 * a shared floor, and no room runs off the lot. Structural (`floor`/`lobby`) and
 * transport units are ignored — transports overlay rooms, floor tiles are width 1.
 * Per-floor bucketing keeps it near-linear for a one-time load-time check.
 */
export function migrationLooksValid(data: SerializedGame): boolean {
  const units = Array.isArray(data.units) ? data.units : [];
  const rooms = units.filter((u) => u && isFacilityKind(u.kind) && u.kind !== "floor" && u.kind !== "lobby");
  const byFloor = new Map<number, { x: number; w: number }[]>();
  for (const r of rooms) {
    if (r.x < 0 || r.x + r.width > GRID.width) return false; // off-lot
    for (let f = r.floor; f < r.floor + facilityFloors(r.kind); f++) {
      const arr = byFloor.get(f) ?? [];
      arr.push({ x: r.x, w: r.width });
      byFloor.set(f, arr);
    }
  }
  for (const arr of byFloor.values()) {
    arr.sort((a, b) => a.x - b.x);
    for (let i = 1; i < arr.length; i++) if (arr[i].x < arr[i - 1].x + arr[i - 1].w) return false;
  }
  return true;
}

/**
 * Count structure tiles (floor/lobby) that hang in mid-air: an above-ground tile
 * with no structure directly below it, or a basement tile with none directly
 * above (the ground floor rests on the earth and never counts). Used to guard the
 * reflow — it must never ADD a floating slab versus the original save (a
 * pre-existing float in a hand-built/unusual save is left as-is, not blamed on the
 * migration). Cheap: one pass to index structure, one to test each tile.
 */
export function floatingStructureCount(data: SerializedGame): number {
  const units = Array.isArray(data.units) ? data.units : [];
  const struct = new Set<string>();
  for (const u of units) {
    if (!u || (u.kind !== "floor" && u.kind !== "lobby")) continue;
    for (let i = 0; i < u.width; i++) struct.add(`${u.floor}:${u.x + i}`);
  }
  let floating = 0;
  for (const u of units) {
    if (!u || (u.kind !== "floor" && u.kind !== "lobby") || u.floor === 1) continue;
    const below = u.floor >= 2 ? u.floor - 1 : u.floor + 1;
    for (let i = 0; i < u.width; i++) if (!struct.has(`${below}:${u.x + i}`)) floating++;
  }
  return floating;
}

/**
 * v1 → v2 save migration: re-lay each floor's rooms at their canon (post-E1b)
 * facility widths. Some kinds widened (fast food, restaurant, cinema, parking
 * ramp) and some squished (parking, suite), so a straight width swap would
 * overlap neighbours or break parking chains. Two passes, validated against real
 * saves (see arch-simtower-parity §1):
 *
 *  - **Pass 1 — parking (ramp-anchored).** For each contiguous parking+ramp run,
 *    anchor the ramp at its ORIGINAL x and pack its chained spaces flush on both
 *    sides, then sweep the runs so widened ramps never collide. Ramp columns stay
 *    vertically aligned; every space stays chained; the repositioning of identical
 *    spaces is cosmetically invisible.
 *  - **Pass 2 — every other room (minimal-disruption).** Keep each room at its
 *    original x, growing a widened room into the paved gap already beside it;
 *    shove a neighbour only when the local gap is too small. If a room would be
 *    flung far (boxed in by a widened neighbour, a multi-floor room from below,
 *    and/or parking), leave it at its LEGACY footprint rather than relocate it
 *    across the tower.
 *
 * Transports overlay rooms (they never block a room and keep their own stored
 * width), so they are untouched. Structural `floor` tiles are added under any new
 * room-footprint tile that wasn't already paved. Pure and deterministic — the
 * golden fixture (`towerone_6`) pins 0 overlaps / 0 dead parking / aligned ramps.
 *
 * Wrapped by {@link upgradeV1toV2}, which falls back to the un-reflowed save if
 * this ever throws or yields an invalid layout — a bad migration must never lose
 * or scramble a player's tower.
 */
export function reflowV1toV2(data: SerializedGame): SerializedGame {
  const src = Array.isArray(data.units) ? data.units : [];
  const isStruct = (k: string): boolean => k === "floor" || k === "lobby";
  const isPark = (k: string): boolean => k === "parking" || k === "parkingRamp";
  const canonW = (k: FacilityKind): number => FACILITIES[k]?.width ?? 1;
  const LOT = GRID.width;

  // Split units: structural paving (kept, plus we may add more), well-formed rooms
  // (reflowed), and anything unrecognized/garbled (passed through untouched — the
  // deserialize hardening still guards it).
  interface R {
    u: Unit;
    kind: FacilityKind;
    floor: number;
    x0: number;
    w0: number;
    w: number; // canon width
    fl: number; // floors spanned
  }
  const rooms: R[] = [];
  const others: Unit[] = []; // structural + passthrough
  // Original support envelope: the columns each story is paved on. A reflowed
  // room may only sit where the story it RESTS on is already paved, or the floor
  // tiles the reflow pads under it would hang in mid-air (a "floating floor").
  // Above ground (floor ≥ 2) rests on the floor below; basements (≤ 0) rest on the
  // story above; the ground floor (1) rests on the earth. Built from ORIGINAL
  // structure only — the reflow never removes a floor tile, so this can only be an
  // under-count of support, never an over-count (safe: it never OKs a float).
  const origStruct = new Set<string>();
  for (const u of src) {
    if (!u || !isStruct(u.kind)) continue;
    const f = Math.round(Number(u.floor));
    const x0 = Math.round(Number(u.x));
    const w0 = Math.round(Number(u.width));
    if (!Number.isFinite(f) || !Number.isFinite(x0) || !Number.isFinite(w0)) continue;
    for (let i = 0; i < w0; i++) origStruct.add(`${f}:${x0 + i}`);
  }
  const restsOn = (floor: number, x: number): boolean => {
    if (floor === 1) return true; // the ground floor rests on the earth
    return origStruct.has(`${floor >= 2 ? floor - 1 : floor + 1}:${x}`);
  };
  // A footprint column is safe to occupy when placing it can't leave a floor tile
  // hanging: either this floor is ALREADY paved there (no new tile — its original
  // support stands) OR the story below supports the fresh tile the reflow would
  // pad. Only genuinely-new-and-unsupported tiles float, so this blocks exactly
  // those without over-constraining a room growing within already-built floor.
  const safeCol = (floor: number, x: number): boolean =>
    origStruct.has(`${floor}:${x}`) || restsOn(floor, x);
  for (const u of src) {
    if (!u || !isFacilityKind(u.kind) || isStruct(u.kind)) {
      if (u) others.push(u);
      continue;
    }
    const floor = Math.round(Number(u.floor));
    const x0 = Math.round(Number(u.x));
    const w0 = Math.round(Number(u.width));
    if (!Number.isFinite(floor) || !Number.isFinite(x0) || !Number.isFinite(w0) || w0 < 1) {
      others.push(u);
      continue;
    }
    rooms.push({ u, kind: u.kind, floor, x0, w0, w: canonW(u.kind), fl: facilityFloors(u.kind) });
  }

  const nx = new Map<Unit, number>(); // room -> new x
  const nw = new Map<Unit, number>(); // room -> final width (canon, or legacy if boxed)

  // Obstacles a placed room presents, bucketed by every floor it spans. Pass 2
  // reads only its own floor's footprints instead of re-scanning every room, so the
  // whole migration stays polynomial — O(rooms) placements, each an
  // O(footprints-on-that-floor) sweep. Nothing here is exponential.
  const obstaclesByFloor = new Map<number, [number, number][]>();
  const addObstacle = (floor: number, fl: number, x: number, w: number): void => {
    for (let f = floor; f < floor + fl; f++) {
      const arr = obstaclesByFloor.get(f);
      if (arr) arr.push([x, x + w]);
      else obstaclesByFloor.set(f, [[x, x + w]]);
    }
  };

  // Pass 1: parking. Lay each contiguous parking+ramp run (ramp anchored at its
  // ORIGINAL x, chained spaces flush on both sides), THEN sweep the runs
  // left-to-right so a WIDENED ramp in one run can never overlap another run's ramp
  // on the same floor (two ramps within the canon ramp width would otherwise clash).
  interface Run {
    left: number; // preferred left edge (keeps ramp columns aligned)
    width: number;
    items: { r: R; off: number }[];
  }
  for (const F of new Set(rooms.filter((r) => isPark(r.kind)).map((r) => r.floor))) {
    const units = rooms.filter((r) => r.floor === F && isPark(r.kind)).sort((a, b) => a.x0 - b.x0);
    const runs: Run[] = [];
    for (let i = 0; i < units.length; ) {
      let j = i;
      const run: R[] = [units[i]];
      while (j + 1 < units.length && units[j + 1].x0 === units[j].x0 + units[j].w0) run.push(units[++j]);
      const items: { r: R; off: number }[] = [];
      let off = 0;
      for (const r of run) {
        items.push({ r, off });
        off += r.w;
      }
      const ri = run.findIndex((r) => r.kind === "parkingRamp");
      // A ramp-bearing run lands its ramp on its original column; a ramp-less run
      // (dead anyway) just packs flush from its own left edge.
      const left = ri >= 0 ? run[ri].x0 - items[ri].off : run[0].x0;
      runs.push({ left, width: off, items });
      i = j + 1;
    }
    runs.sort((a, b) => a.left - b.left);
    let cursor = 0; // clamp the first run on-lot (a ramp near x=0 can want a negative left)
    for (const run of runs) {
      const left = Math.max(run.left, cursor);
      for (const { r, off } of run.items) {
        nx.set(r.u, left + off);
        nw.set(r.u, r.w);
      }
      cursor = left + run.width;
    }
    for (const run of runs) for (const { r } of run.items) addObstacle(r.floor, r.fl, nx.get(r.u)!, r.w);
  }

  // Pass 2: every other room, minimal-disruption, bottom floor → top so a
  // multi-floor room placed at its base is already an obstacle on the floors above.
  const byBase = new Map<number, R[]>();
  for (const r of rooms) {
    if (isPark(r.kind)) continue;
    const arr = byBase.get(r.floor);
    if (arr) arr.push(r);
    else byBase.set(r.floor, [r]);
  }
  // First column ≥ startX where the next `w` columns are all FREE in the floor's
  // occupancy bitmap (`blocked[x] === 0`) — i.e. supported and unoccupied — or null
  // if none fits before the lot edge. When a run of free columns is cut short by a
  // blocked one at `x+k`, no window starting in `[x, x+k]` can fit (each still spans
  // the blocked column), so we resume at `x+k+1`. Every column is thus visited O(1)
  // times as x only moves forward: an honest O(LOT) scan per room, no per-step
  // obstacle search or re-sort — dense floors stay linear.
  const firstFit = (blocked: Uint8Array, startX: number, w: number): number | null => {
    let x = Math.max(0, startX);
    while (x + w <= LOT) {
      let k = 0;
      while (k < w && blocked[x + k] === 0) k++;
      if (k === w) return x;
      x += k + 1;
    }
    return null;
  };
  for (const F of [...byBase.keys()].sort((a, b) => a - b)) {
    const here = byBase.get(F)!.sort((a, b) => a.x0 - b.x0);
    // Per-floor occupancy bitmap: a column is blocked if the story below doesn't
    // support it, or a multi-floor room placed on a lower floor already occupies it.
    const floorBlocked = new Uint8Array(LOT);
    for (let x = 0; x < LOT; x++) if (!safeCol(F, x)) floorBlocked[x] = 1;
    for (const [o0, o1] of obstaclesByFloor.get(F) ?? [])
      for (let x = Math.max(0, o0); x < Math.min(LOT, o1); x++) floorBlocked[x] = 1;
    // Try to canon-ize the WHOLE floor: place every room at its canon width in the
    // first supported + clear column at/after home. All-or-nothing — a single room
    // that can't fit (an over-packed floor) fails the attempt, because widening
    // some rooms but clamping others onto unsupported ground is exactly what pads a
    // floating floor. A floor that can't all fit at canon keeps its ORIGINAL layout
    // instead (legacy widths at legacy columns — supported and non-overlapping by
    // construction, since that's how the tower was built). Per-floor, so only the
    // genuinely-too-tight floors miss canon, not the whole tower.
    const tryCanon = (): { r: R; x: number; w: number }[] | null => {
      const blocked = floorBlocked.slice(); // tentative — mutated as rooms place
      const placed: { r: R; x: number; w: number }[] = [];
      let cursor = 0;
      for (const r of here) {
        const x = firstFit(blocked, Math.max(r.x0, cursor), r.w);
        if (x === null) return null; // this floor is too tight for canon widths
        for (let i = x; i < x + r.w; i++) blocked[i] = 1;
        placed.push({ r, x, w: r.w });
        cursor = x + r.w;
      }
      return placed;
    };
    const placed = tryCanon() ?? here.map((r) => ({ r, x: r.x0, w: r.w0 }));
    for (const { r, x, w } of placed) {
      nx.set(r.u, x);
      nw.set(r.u, w);
      addObstacle(r.floor, r.fl, x, w);
    }
  }

  // Build the migrated unit list: structural/passthrough unchanged, reflowed rooms
  // at their new x/width, plus a `floor` tile under any new footprint tile that
  // wasn't already paved (so a grown/shifted room never floats over bare space).
  const paved = new Set<string>();
  for (const u of others) if (isStruct(u.kind)) for (let i = 0; i < u.width; i++) paved.add(`${u.floor}:${u.x + i}`);
  // Fresh floor tiles get ids past the highest existing id — a missing/garbled
  // `nextId` must never collide with an existing unit id.
  let nextId = Number.isFinite(data.nextId) ? data.nextId : 1;
  for (const u of src) if (u && Number.isFinite(u.id)) nextId = Math.max(nextId, Math.floor(u.id) + 1);
  // `others` aliases the input unit objects; that's safe because deserialize re-maps
  // (deep-copies) every unit right after migration, and the migration never mutates.
  const outUnits: Unit[] = [...others];
  for (const r of rooms) {
    const x = nx.get(r.u) ?? r.x0;
    const w = nw.get(r.u) ?? r.w0;
    outUnits.push({ ...r.u, x, width: w });
    for (let f = r.floor; f < r.floor + r.fl; f++) {
      for (let tx = x; tx < x + w; tx++) {
        const key = `${f}:${tx}`;
        if (!paved.has(key)) {
          paved.add(key);
          outUnits.push({
            id: nextId++,
            kind: "floor",
            floor: f,
            x: tx,
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
  }

  return { ...data, version: 2, units: outUnits, nextId };
}
