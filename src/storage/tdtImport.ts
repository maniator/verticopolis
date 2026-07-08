import { FACILITIES, GRID, buildMinutes, isHotelKind } from "../engine/facilities";
import { SAVE_VERSION } from "../engine/saveMigration";
import { minuteOfDayForFrame } from "../engine/timePacing";
import type { FacilityKind, SerializedGame, Transport, Unit } from "../engine/types";
import { LegacyImportError, parseTdtBinary } from "./tdtFormat";
import type { TdtTower } from "./tdtFormat";

export { LegacyImportError };

/**
 * Importer for original 1994 SimTower `.TDT` saves: maps the raw
 * {@link TdtTower} the binary walker produces into our {@link SerializedGame}
 * schema plus an honest {@link ImportReport} of what did and didn't survive
 * the trip. The output is deliberately fed through `Simulation.deserialize`
 * by the caller — its trust-boundary hardening is the second validation
 * layer, so nothing here needs to be the last line of defense.
 *
 * v1 scope (see the backlog's tdt-importer row): the header and floor map are
 * decoded; transports are SYNTHESIZED from the floor layout (the original's
 * elevator block is only partially documented); people, retail subtypes,
 * finance history, named tenants and rent classes are queued follow-ups.
 */

/** What the fidelity-report modal shows before the player adopts the tower. */
export interface ImportReport {
  towerName: string;
  /** 1–5 stars; 6 = TOWER. */
  star: number;
  /** Funds in display dollars (already ×100). */
  money: number;
  /** In-game day the save was on, 1-indexed — matches the report's own
   *  "The clock: day N" line (the engine's Clock.day is 0-indexed). */
  day: number;
  /** Above-ground floors built (highest floor), and basement levels. */
  floors: number;
  basements: number;
  /** Rooms imported (paving and transports not counted). */
  unitsImported: number;
  /** One honest sentence per thing that made it over. */
  broughtOver: string[];
  /** One honest sentence per approximation, divergence, or loss. */
  couldNotBring: string[];
}

/** Result of a successful parse: the save plus its fidelity report. */
export interface ParsedLegacyTower {
  save: SerializedGame;
  report: ImportReport;
}

/**
 * Tenant type ID → our FacilityKind (doc §5). IDs 0 (floor), 24 (lobby) and
 * 48 (burned) are structural/cleared and handled by the paving pass instead;
 * anything absent here is dropped with a report line.
 */
const TENANT_KIND: Readonly<Record<number, FacilityKind>> = {
  3: "hotelSingle",
  4: "hotelDouble", // the original's "twin" — closest match, reported as lossy
  5: "hotelSuite",
  6: "restaurant",
  7: "office",
  9: "condo",
  10: "shop",
  11: "parking",
  12: "fastFood",
  13: "medical",
  14: "security",
  15: "housekeeping",
  17: "security", // SECOM — a cut 1994 feature; approximated, reported
  18: "cinema",
  34: "cinema", // the notes list two theater IDs; both land on cinema
  20: "recycling",
  29: "partyHall",
  31: "metro",
  36: "weddingHall", // Cathedral — our deliberate divergence (PARITY.md)
  45: "parkingRamp",
};

const TDT_FLOOR = 0;
const TDT_LOBBY = 24;
const TDT_BURNED = 48;

/** TDT floor index → our floor: uniform `ours = tdt − 9` (doc §4). */
const TDT_FLOOR_OFFSET = 9;

/** Ceiling on the header's signed day counter (~1,000 in-game years) so a
 *  forged value can't blow the minutes math into precision-loss territory. */
const MAX_IMPORT_DAY = 360_000;

/** The ground floor (1) and every 15th floor above host a (sky) lobby —
 *  mirrors Tower.ts's isLobbyFloor, which is not exported. */
function isLobbyFloor(floor: number): boolean {
  return floor === 1 || (floor > 1 && floor % GRID.lobbyInterval === 0);
}

/** Heuristic for the import UI: is this picked file an original SimTower
 *  save? The .TDT extension first; else sniff the header magic, so a renamed
 *  or extension-less copy of a real save still routes here. */
export function looksLikeLegacyTower(filename: string, bytes?: Uint8Array): boolean {
  if (/\.tdt$/i.test(filename)) return true;
  return !!bytes && bytes.byteLength >= 2 && bytes[0] === 0x00 && bytes[1] === 0x24;
}

/**
 * Parse an original SimTower `.TDT` buffer into our save schema plus a
 * fidelity report. Throws {@link LegacyImportError} (player-readable) for
 * anything unreadable; never adopts or persists anything itself.
 */
export function parseTDT(buffer: ArrayBuffer, filename: string): ParsedLegacyTower {
  const bytes = new Uint8Array(buffer);
  const tdt: TdtTower = parseTdtBinary(bytes);

  // Header fields are hostile input; every clamp that fires is SAID in the
  // report — the fidelity modal's whole point is honesty about what changed.
  const headerNotes: string[] = [];
  const star = Math.max(1, Math.min(6, tdt.header.level));
  if (tdt.header.level < 1 || tdt.header.level > 6) {
    headerNotes.push(`The save's star rating (${tdt.header.level}) was out of range and was clamped.`);
  }
  const money = tdt.header.balance * 100;
  const day = Math.max(0, Math.min(MAX_IMPORT_DAY, tdt.header.currentDay));
  if (tdt.header.currentDay < 0) {
    headerNotes.push("The save's day counter was negative (a known quirk of the format) and was reset to day 1.");
  } else if (tdt.header.currentDay > MAX_IMPORT_DAY) {
    headerNotes.push("The save's day counter was impossibly far in the future and was clamped.");
  }
  // Clamp the clock into the documented 0–2599 frame range (a u16 can carry
  // more); minuteOfDayForFrame would wrap it anyway, but a corrupt value
  // deserves a report line, not a silent wrap.
  const frame = Math.max(0, Math.min(2599, tdt.header.frameTime));
  if (tdt.header.frameTime > 2599) {
    headerNotes.push("The save's clock was out of range and was reset to the end of the night.");
  }
  // The original's date changes at frame 2300 (midnight), so frames ≥ 2300
  // are the small hours of `currentDay` itself — minuteOfDayForFrame already
  // returns 0..419 for them, making the sum below correct on both sides of
  // the wrap (doc §3).
  const minutes = day * 1440 + minuteOfDayForFrame(frame);

  // ---- Floor map → units ---------------------------------------------------
  const counts = {
    rooms: 0,
    offices: 0,
    occupiedOffices: 0,
    condos: 0,
    soldCondos: 0,
    hotelRooms: 0,
    venues: 0, // food, retail, entertainment
    services: 0, // security/medical/housekeeping/recycling/parking/ramp/metro/weddingHall
    construction: 0,
    twinRooms: 0,
    secom: 0,
    cathedral: 0,
    burned: 0,
    unknown: 0,
    droppedFloors: 0,
    offLot: 0,
    overlapping: 0,
    clamped: 0,
    widthMismatch: 0,
  };
  // Paved tiles per (our) floor; rooms sit ON structure in our model, so the
  // paving pass below re-lays the corridor layer the same way the in-game
  // builder does (width-1 floor/lobby tiles).
  const paved = new Map<number, Uint8Array>();
  const paveRange = (floor: number, left: number, right: number): void => {
    const lo = Math.max(0, Math.min(GRID.width, left));
    const hi = Math.max(0, Math.min(GRID.width, right));
    if (hi <= lo) return;
    let row = paved.get(floor);
    if (!row) {
      row = new Uint8Array(GRID.width);
      paved.set(floor, row);
    }
    row.fill(1, lo, hi);
  };

  // Tiles already claimed by a kept ROOM per floor: a corrupt file can carry
  // overlapping tenant extents, and two units sharing tiles would corrupt the
  // engine's per-tile room index (last-wins on register, shared-tile deletes
  // on unregister) — so later overlappers are dropped with a report line.
  const roomClaimed = new Map<number, Uint8Array>();
  let nextId = 1;
  const units: Unit[] = [];
  for (const fl of tdt.floors) {
    const ours = fl.index - TDT_FLOOR_OFFSET;
    if (ours > GRID.maxFloor) {
      // Indexes ≥ 110 are the doc's known ambiguity — not buildable here.
      if (fl.tenants.length > 0 || fl.rightEdge > fl.leftEdge) counts.droppedFloors++;
      continue;
    }
    paveRange(ours, fl.leftEdge, fl.rightEdge);
    for (const t of fl.tenants) {
      const underConstruction = t.type < 0;
      const typeId = Math.abs(t.type);
      if (typeId === TDT_FLOOR || typeId === TDT_LOBBY) {
        paveRange(ours, t.left, t.right);
        continue;
      }
      if (typeId === TDT_BURNED) {
        paveRange(ours, t.left, t.right);
        counts.burned++;
        continue;
      }
      const kind = TENANT_KIND[typeId];
      if (!kind) {
        counts.unknown++;
        continue;
      }
      // Geometry: extents are 8-px segments == our tiles, half-open. The
      // extents are u16s (never negative), so only the RIGHT edge can poke
      // off-lot: drop a degenerate or fully off-lot room; trim one that
      // merely pokes past the edge.
      const x = t.left;
      let right = t.right;
      if (right <= x || x >= GRID.width) {
        counts.offLot++;
        continue;
      }
      if (right > GRID.width) {
        right = GRID.width;
        counts.clamped++;
      }
      // Drop a room that overlaps one already kept on this floor (corrupt
      // files only — the original packs rooms disjointly).
      let claimed = roomClaimed.get(ours);
      if (!claimed) {
        claimed = new Uint8Array(GRID.width);
        roomClaimed.set(ours, claimed);
      }
      let overlaps = false;
      for (let i = x; i < right && !overlaps; i++) if (claimed[i]) overlaps = true;
      if (overlaps) {
        counts.overlapping++;
        continue;
      }
      claimed.fill(1, x, right);
      const width = right - x;
      if (width !== FACILITIES[kind].width) counts.widthMismatch++;
      paveRange(ours, x, right);

      const occupiedHere = !underConstruction && (kind === "office" || kind === "condo") && t.status !== 0;
      const unit: Unit = {
        id: nextId++,
        kind,
        floor: ours,
        x,
        width,
        state: underConstruction ? "construction" : occupiedHere ? "occupied" : "empty",
        satisfaction: 1,
        occupants: 0,
        everOccupied: occupiedHere,
        pendingIncome: 0,
        label: FACILITIES[kind].name,
      };
      if (underConstruction) {
        unit.completeAt = minutes + buildMinutes(kind);
        counts.construction++;
      }
      units.push(unit);

      counts.rooms++;
      if (kind === "office") {
        counts.offices++;
        if (occupiedHere) counts.occupiedOffices++;
      } else if (kind === "condo") {
        counts.condos++;
        if (occupiedHere) counts.soldCondos++;
      } else if (isHotelKind(kind)) {
        counts.hotelRooms++;
      } else if (
        kind === "fastFood" ||
        kind === "restaurant" ||
        kind === "shop" ||
        kind === "cinema" ||
        kind === "partyHall"
      ) {
        counts.venues++;
      } else {
        counts.services++;
      }
      if (typeId === 4) counts.twinRooms++;
      if (typeId === 17) counts.secom++;
      if (typeId === 36) counts.cathedral++;
    }
  }

  // ---- Paving pass: the corridor layer under everything --------------------
  // Width-1 tiles, exactly like in-game placement, so every downstream
  // consumer (structure index, bulldozer, renderer) sees the shape it knows.
  // Lobby floors pave as lobby across their built extent (canon: the ground
  // concourse and every 15th floor).
  const builtExtents = new Map<number, { left: number; right: number }>();
  for (const [floor, row] of paved) {
    const kind: FacilityKind = isLobbyFloor(floor) ? "lobby" : "floor";
    let left = -1;
    let right = -1;
    for (let xTile = 0; xTile < GRID.width; xTile++) {
      if (!row[xTile]) continue;
      if (left === -1) left = xTile;
      right = xTile + 1;
      units.push({
        id: nextId++,
        kind,
        floor,
        x: xTile,
        width: 1,
        state: "empty",
        satisfaction: 1,
        occupants: 0,
        everOccupied: false,
        pendingIncome: 0,
        label: FACILITIES[kind].name,
      });
    }
    if (left !== -1) builtExtents.set(floor, { left, right });
  }

  // ---- Transports: synthesized, not decoded (v1) ----------------------------
  const hotelFloors = units.filter((u) => isHotelKind(u.kind)).map((u) => u.floor);
  const staffFloors = units.filter((u) => u.kind === "housekeeping").map((u) => u.floor);
  const transports = synthesizeTransports(builtExtents, hotelFloors, staffFloors, nextId);
  nextId += transports.length;

  const towerName = towerNameFromFilename(filename);
  const save: SerializedGame = {
    version: SAVE_VERSION,
    seed: hashSeed(bytes),
    money,
    star,
    minutes,
    mode: "classic",
    units,
    transports,
    nextId,
    towerName,
    builtWeddingHall: units.some((u) => u.kind === "weddingHall"),
    evaluatedTower: star >= 6,
    vipVisitDay: -1,
    vipFavorable: star >= 6,
  };

  return { save, report: buildReport(save, counts, tdt, transports.length, headerNotes) };
}

/**
 * Deterministic elevator layout from the floor map alone — the original's
 * elevator block is only partially documented, so v1 rebuilds a serviceable
 * layout instead of decoding one (reported to the player). Pure and RNG-free:
 * the same floor map always yields byte-identical shafts.
 *
 * - Standard shafts in ≤30-floor bands: one anchored at the LOWEST built
 *   floor (so basements ride the ground band), then one per 15th-floor sky
 *   lobby that extends coverage — every band clamped into the built range so
 *   a sparse tower never gets a shaft hanging below its lowest floor.
 * - One express shaft when the tower tops ~30 floors, stopping at its
 *   endpoints plus the (sky) lobby floors between them.
 * - Service elevator(s) chained over the hotel/housekeeping floors when
 *   hotels exist and that range actually spans floors — housekeeping is
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
  // Service chain over the staff range — only when there are hotels to clean.
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

/** Tower name from the FILENAME (never from file bytes): basename minus
 *  extension, separators to spaces, printable ASCII only, capped length. */
export function towerNameFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "";
  const name = base
    .replace(/\.[^.]*$/, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24)
    .trim();
  return name || "SimTower Import";
}

/** FNV-1a over the file bytes: a stable, deterministic RNG seed for the
 *  imported tower (same file, same seed — golden-testable). */
function hashSeed(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  h &= 0x7fffffff;
  return h === 0 ? 1 : h;
}

function buildReport(
  save: SerializedGame,
  counts: {
    rooms: number;
    offices: number;
    occupiedOffices: number;
    condos: number;
    soldCondos: number;
    hotelRooms: number;
    venues: number;
    services: number;
    construction: number;
    twinRooms: number;
    secom: number;
    cathedral: number;
    burned: number;
    unknown: number;
    droppedFloors: number;
    offLot: number;
    overlapping: number;
    clamped: number;
    widthMismatch: number;
  },
  tdt: TdtTower,
  shafts: number,
  headerNotes: string[],
): ImportReport {
  let floors = 0;
  let basements = 0;
  for (const u of save.units) {
    if (u.floor > floors) floors = u.floor;
    if (u.floor < 1) basements = Math.max(basements, 1 - u.floor);
  }
  const day = Math.floor(save.minutes / 1440) + 1; // 1-indexed, as shown to the player

  const broughtOver: string[] = [];
  const rating = save.star >= 6 ? "the TOWER rating" : `your ${save.star}-star rating`;
  broughtOver.push(`$${save.money.toLocaleString()} in funds and ${rating}.`);
  broughtOver.push(
    `${floors} floor${floors === 1 ? "" : "s"} of structure` +
      (basements > 0 ? ` and ${basements} basement level${basements === 1 ? "" : "s"}.` : "."),
  );
  if (counts.offices > 0) {
    broughtOver.push(`${counts.offices} office${counts.offices === 1 ? "" : "s"} (${counts.occupiedOffices} with tenants).`);
  }
  if (counts.condos > 0) {
    broughtOver.push(`${counts.condos} condo${counts.condos === 1 ? "" : "s"} (${counts.soldCondos} sold).`);
  }
  if (counts.hotelRooms > 0) {
    broughtOver.push(`${counts.hotelRooms} hotel room${counts.hotelRooms === 1 ? "" : "s"}, starting the day empty and ready for guests.`);
  }
  if (counts.venues > 0) {
    broughtOver.push(`${counts.venues} food, retail, and entertainment venue${counts.venues === 1 ? "" : "s"}.`);
  }
  if (counts.services > 0) {
    broughtOver.push(`${counts.services} service and special facilit${counts.services === 1 ? "y" : "ies"}.`);
  }
  if (counts.construction > 0) {
    broughtOver.push(`${counts.construction} room${counts.construction === 1 ? "" : "s"} still under construction; work resumes now.`);
  }
  broughtOver.push(`The clock: day ${day}, ${formatClock(save.minutes)}.`);

  const couldNotBring: string[] = [];
  couldNotBring.push(
    `Elevators and stairs: the original's shaft data isn't decoded yet, so ${shafts} elevator${shafts === 1 ? " was" : "s were"} rebuilt from your floor layout.`,
  );
  if (counts.twinRooms > 0) {
    couldNotBring.push(`${counts.twinRooms} twin room${counts.twinRooms === 1 ? "" : "s"} imported as Double Rooms (the closest match).`);
  }
  if (counts.secom > 0) {
    couldNotBring.push(`${counts.secom} SECOM office${counts.secom === 1 ? "" : "s"} imported as Security (SECOM never shipped in the original).`);
  }
  if (counts.cathedral > 0) {
    couldNotBring.push("The Cathedral arrives as our Wedding Hall (a deliberate divergence).");
  }
  if (counts.burned > 0) {
    couldNotBring.push(`${counts.burned} burned-out area${counts.burned === 1 ? " was" : "s were"} cleared back to bare floor.`);
  }
  if (counts.unknown > 0) {
    couldNotBring.push(`${counts.unknown} room${counts.unknown === 1 ? "" : "s"} of a type we don't recognize stayed behind.`);
  }
  if (counts.droppedFloors > 0) {
    couldNotBring.push(
      `${counts.droppedFloors} floor record${counts.droppedFloors === 1 ? "" : "s"} above floor 100 stayed behind (not buildable here).`,
    );
  }
  if (counts.offLot > 0) {
    couldNotBring.push(`${counts.offLot} room${counts.offLot === 1 ? " sat" : "s sat"} outside the lot and stayed behind.`);
  }
  if (counts.overlapping > 0) {
    couldNotBring.push(
      `${counts.overlapping} room${counts.overlapping === 1 ? "" : "s"} overlapped another room and stayed behind.`,
    );
  }
  if (counts.clamped > 0) {
    couldNotBring.push(`${counts.clamped} room${counts.clamped === 1 ? " was" : "s were"} trimmed to fit the lot edge.`);
  }
  if (counts.widthMismatch > 0) {
    couldNotBring.push(
      `${counts.widthMismatch} room${counts.widthMismatch === 1 ? " keeps" : "s keep"} the original's size, which differs from what new construction here would use.`,
    );
  }
  if (counts.occupiedOffices + counts.soldCondos > 0) {
    couldNotBring.push("Occupancy is approximate: any office or condo with people recorded imports as occupied.");
  }
  if (tdt.peopleCount !== null && tdt.peopleCount > 0) {
    couldNotBring.push(
      `The ${tdt.peopleCount.toLocaleString()} people on the save's roster aren't carried over one by one; your tower re-populates as it runs.`,
    );
  }
  couldNotBring.push("Tenant names, rent settings, retail varieties, and finance history aren't imported yet.");
  couldNotBring.push(...headerNotes);
  couldNotBring.push(...tdt.warnings);

  return {
    towerName: save.towerName,
    star: save.star,
    money: save.money,
    day,
    floors,
    basements,
    unitsImported: counts.rooms,
    broughtOver,
    couldNotBring,
  };
}

/** "7:00 AM"-style clock text for the report. */
function formatClock(minutes: number): string {
  const mod = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(mod / 60);
  const m = Math.floor(mod % 60);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}
