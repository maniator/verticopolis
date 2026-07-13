import { FACILITIES, GRID, maxCarsFor, maxSpanFor } from "../engine/facilities";
import type { FacilityKind, Transport } from "../engine/types";
import { TDT_FLOOR_OFFSET } from "./tdtConstants";
import type { TdtElevator, TdtStair } from "./tdtTypes";
import { ELEVATOR_KINDS, isLobbyFloor } from "./tdtTables";

/**
 * Transport reconstruction for a `.TDT` import: map the decoded elevator and
 * stairs tables onto our transports, or synthesize a deterministic layout from
 * the floor map when the save's transport blocks can't be read. Extracted from
 * `tdtImport.ts`.
 */

/** What the decode-path mapping produced, with honest loss accounting. */
export interface DecodedTransports {
  transports: Transport[];
  /** Corrupt shafts dropped (degenerate, out of range, or overlapping). */
  droppedShafts: number;
  /** Shafts whose extents were trimmed (lot range or canon span). */
  adjustedShafts: number;
  /** Walkway flights dropped at the 64-link pool cap. */
  droppedFlights: number;
}

/** True when placing a transport at (x, width, bottom..top) would overlap one
 *  already placed. Exact-footprint stacked walkways may share their landing
 *  floor (the engine's own stacking rule), so that one case is allowed. */
function overlapsPlaced(
  placed: readonly Transport[],
  kind: FacilityKind,
  x: number,
  width: number,
  bottom: number,
  top: number,
): boolean {
  const isWalkway = kind === "stairs" || kind === "escalator";
  for (const t of placed) {
    if (x >= t.x + t.width || t.x >= x + width) continue;
    if (bottom > t.top || t.bottom > top) continue;
    const otherWalkway = t.kind === "stairs" || t.kind === "escalator";
    if (isWalkway && otherWalkway && t.x === x && t.width === width && (bottom === t.top || top === t.bottom)) {
      continue; // stacked flights sharing exactly the landing floor
    }
    return true;
  }
  return false;
}

/**
 * Map the DECODED elevator and stairs tables onto our transports. Live
 * passenger/queue state is deliberately not carried over (the crowd
 * re-simulates), but the shafts themselves come across faithfully: kind,
 * position, extent, car count, per-floor stop settings (the serviced-floors
 * map becomes `skipFloors`), and each car's home floor as its starting
 * position. Two- and three-story walkway variants become stacked flights
 * (exact-footprint stacking is how the engine models a continuous run).
 *
 * Corrupt entries are dropped or trimmed, never invented: a shaft wholly
 * outside the buildable range is discarded (not clamped into a phantom stub),
 * spans obey the engine's canon `maxSpanFor`, and no transport may overlap
 * one already placed. Every drop/trim is counted for the fidelity report.
 */
export function transportsFromDecoded(
  elevators: readonly TdtElevator[],
  stairs: readonly TdtStair[],
  firstId: number,
): DecodedTransports {
  const out: Transport[] = [];
  let droppedShafts = 0;
  let adjustedShafts = 0;
  let droppedFlights = 0;
  for (const e of elevators) {
    const kind = ELEVATOR_KINDS[e.type];
    if (!kind) {
      droppedShafts++; // type byte names no known elevator kind (corrupt save)
      continue;
    }
    const rawBottom = e.bottomFloor - TDT_FLOOR_OFFSET;
    const rawTop = e.topFloor - TDT_FLOOR_OFFSET;
    if (rawTop <= rawBottom) {
      droppedShafts++; // degenerate shaft in a corrupt save
      continue;
    }
    // Trim into the buildable range; a shaft with no height left inside it is
    // corrupt data, not something to fold into a phantom stub at the edge.
    const bottom = Math.max(GRID.minFloor, rawBottom);
    let top = Math.min(GRID.maxFloor, rawTop);
    if (top <= bottom) {
      droppedShafts++;
      continue;
    }
    let trimmed = bottom !== rawBottom || top !== rawTop;
    // The engine's canon span cap (standard/service 30; express unlimited).
    if (top - bottom > maxSpanFor(kind)) {
      top = bottom + maxSpanFor(kind);
      trimmed = true;
    }
    const width = FACILITIES[kind].width;
    const x = Math.max(0, Math.min(GRID.width - width, e.x));
    if (overlapsPlaced(out, kind, x, width, bottom, top)) {
      droppedShafts++;
      continue;
    }
    if (trimmed) adjustedShafts++;
    const cars = Math.max(1, Math.min(maxCarsFor(kind), e.cars));
    // The 120-byte serviced-floors map is the original's per-floor stop
    // configuration: exactly our skipFloors, inverted. Endpoints always stop.
    const skipFloors: number[] = [];
    for (let fl = bottom + 1; fl < top; fl++) {
      if (!e.serviced[fl + TDT_FLOOR_OFFSET]) skipFloors.push(fl);
    }
    const carPositions = Array.from({ length: cars }, (_, i) => {
      const home = e.carHomes[i] - TDT_FLOOR_OFFSET;
      return Math.max(bottom, Math.min(top, home));
    });
    out.push({
      id: firstId + out.length,
      kind,
      x,
      width,
      bottom,
      top,
      cars,
      carPositions,
      carDir: Array.from({ length: cars }, () => 0),
      load: 0,
      skipFloors,
    });
  }
  let walkways = 0;
  for (const s of stairs) {
    if (s.type > 5) continue; // undocumented variant in a corrupt save
    const kind: FacilityKind = s.type % 2 === 1 ? "stairs" : "escalator";
    const stories = s.type <= 1 ? 1 : s.type <= 3 ? 2 : 3;
    const width = FACILITIES[kind].width;
    const x = Math.max(0, Math.min(GRID.width - width, s.x));
    const base = s.floor - TDT_FLOOR_OFFSET;
    for (let i = 0; i < stories; i++) {
      const bottom = base + i;
      if (bottom < GRID.minFloor || bottom + 1 > GRID.maxFloor) continue;
      if (walkways >= 64) {
        droppedFlights++; // past the shared 64-link walkway pool
        continue;
      }
      if (overlapsPlaced(out, kind, x, width, bottom, bottom + 1)) {
        droppedFlights++;
        continue;
      }
      walkways++;
      out.push({
        id: firstId + out.length,
        kind,
        x,
        width,
        bottom,
        top: bottom + 1,
        cars: 0,
        carPositions: [],
        carDir: [],
        load: 0,
      });
    }
  }
  return { transports: out, droppedShafts, adjustedShafts, droppedFlights };
}

/**
 * FALLBACK deterministic elevator layout from the floor map alone; used only
 * when the save's transport blocks can't be read (truncated or corrupt
 * files); reported to the player. Pure and RNG-free: the same floor map
 * always yields byte-identical shafts.
 *
 * - Standard shafts in ≤30-floor bands: one anchored at the LOWEST built
 *   floor (so basements ride the ground band), then one per 15th-floor sky
 *   lobby that extends coverage; every band clamped into the built range so
 *   a sparse tower never gets a shaft hanging below its lowest floor.
 * - One express shaft when the tower tops ~30 floors, stopping at its
 *   endpoints plus the (sky) lobby floors between them.
 * - Service elevator(s) chained over the hotel/housekeeping floors when
 *   hotels exist and that range actually spans floors; housekeeping is
 *   unreachable without staff transport (an all-on-one-floor hotel needs no
 *   shaft; staff walk).
 * - 8 cars per shaft; the 24-shaft pooled cap is respected (never reached by
 *   a legal 110-floor tower, but a guard is a guard).
 */
export function synthesizeTransports(
  builtExtents: ReadonlyMap<number, { left: number; right: number }>,
  hotelFloors: readonly number[],
  staffFloors: readonly number[],
  firstId: number,
): Transport[] {
  if (builtExtents.size === 0) return [];
  let bottom = Infinity;
  let top = -Infinity;
  let minLeft = Infinity;
  let maxRight = -Infinity;
  for (const [floor, ext] of builtExtents) {
    bottom = Math.min(bottom, floor);
    top = Math.max(top, floor);
    minLeft = Math.min(minLeft, ext.left);
    maxRight = Math.max(maxRight, ext.right);
  }
  const center = Math.round((minLeft + maxRight) / 2);

  const specs: { kind: FacilityKind; bottom: number; top: number; skipFloors?: number[] }[] = [];
  // Standard bands: ground first (basements included), then each sky-lobby
  // anchor that extends coverage upward. Consecutive bands overlap at a sky
  // lobby, so a two-ride trip can always transfer.
  let covered = -Infinity;
  const groundTop = Math.min(bottom + 30, top);
  if (groundTop > bottom) {
    specs.push({ kind: "elevatorStandard", bottom, top: groundTop });
    covered = groundTop;
  }
  for (let anchor = GRID.lobbyInterval; anchor < top; anchor += GRID.lobbyInterval) {
    // Clamp the anchor into the built range: a sparse tower (nothing built
    // below floor 40, say) must not get a shaft hanging under its own floors.
    const bandBottom = Math.max(anchor, bottom);
    const bandTop = Math.min(bandBottom + 30, top);
    if (bandTop <= covered || bandTop <= bandBottom) continue;
    specs.push({ kind: "elevatorStandard", bottom: bandBottom, top: bandTop });
    covered = bandTop;
  }
  // Express once the tower is genuinely tall: from the ground (or the lowest
  // built floor when the tower floats above it), stopping lobby-to-lobby.
  if (top >= 30) {
    const exBottom = Math.max(1, bottom);
    if (top > exBottom) {
      const skip: number[] = [];
      for (let fl = exBottom + 1; fl < top; fl++) if (!isLobbyFloor(fl)) skip.push(fl);
      specs.push({ kind: "elevatorExpress", bottom: exBottom, top, skipFloors: skip });
    }
  }
  // Service chain over the staff range; only when there are hotels to clean.
  // Anchored at the ground concourse but clamped into the built range; when
  // every hotel and housekeeping sits on one floor, staff walk (no shaft).
  if (hotelFloors.length > 0) {
    const staffRange = [...hotelFloors, ...staffFloors, 1];
    let lo = Math.max(Math.min(...staffRange), bottom);
    const hi = Math.min(Math.max(...staffRange), top);
    while (lo < hi) {
      const t = Math.min(lo + 30, hi);
      specs.push({ kind: "elevatorService", bottom: lo, top: t });
      lo = t;
    }
  }

  // The pooled 24-shaft cap: unreachable for a legal tower (≤ ~11 shafts),
  // but never emit more than the game itself allows.
  const capped = specs.slice(0, 24);

  // Lay the shafts side by side around the built extent's horizontal center.
  const totalWidth = capped.reduce((w, s) => w + FACILITIES[s.kind].width, 0);
  let x = Math.max(0, Math.min(GRID.width - totalWidth, Math.round(center - totalWidth / 2)));
  const transports: Transport[] = [];
  for (const s of capped) {
    const width = FACILITIES[s.kind].width;
    const cars = 8;
    transports.push({
      id: firstId + transports.length,
      kind: s.kind,
      x,
      width,
      bottom: s.bottom,
      top: s.top,
      cars,
      carPositions: Array.from({ length: cars }, (_, i) => Math.min(s.bottom + i, s.top)),
      carDir: Array.from({ length: cars }, () => 0),
      load: 0,
      skipFloors: s.skipFloors,
    });
    x += width;
  }
  return transports;
}
