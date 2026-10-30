import { CATALOG_VERSION, type Catalog } from "../engine/catalogTypes";
import type { GameMode } from "../engine/types";
import type { WasmModule } from "./binding";

/**
 * The catalog through the WASM binding: `catalog(mode)` on the module returns
 * canonical JSON in the shape of {@link Catalog} (declared in
 * `src/engine/catalogTypes.ts`, which carries no engine tables), so a
 * frontend reads every price, size and build rule from the engine instead of
 * from the TypeScript tables. `conformance/catalog-digests.json` holds the
 * two engines to the same text.
 */
export { CATALOG_VERSION } from "../engine/catalogTypes";
export type {
  Catalog,
  CatalogCalendar,
  CatalogEconomy,
  CatalogFacility,
  CatalogPool,
  CatalogRent,
  CatalogWorld,
  CatalogRentCadence,
} from "../engine/catalogTypes";

/** The catalog for `mode`, parsed and checked. Refuses, by name, a binding
 *  without the export, a refusal or unparsable reply, a shape version other
 *  than the one asked for (by default the version this build was written
 *  against), another mode's catalog, and a reply whose shape is not
 *  {@link Catalog}: every field present with its type, amounts finite and not
 *  negative, sizes whole and positive, and the cross references (pool keys and
 *  kinds, the ground floor structure) naming a listed facility. The lock holds
 *  the two engines to one text; this check stops a stale or damaged binding of
 *  the same version from handing a frontend a wrong price or a missing field. */
export function readCatalog(mod: Pick<WasmModule, "catalog">, mode: GameMode, version: number = CATALOG_VERSION): Catalog {
  if (typeof mod.catalog !== "function") throw new Error("the WASM binding exports no catalog; rebuild it");
  let c: unknown;
  try {
    c = JSON.parse(mod.catalog(mode));
  } catch (e) {
    // The cause keeps a trap a trap for the host (#1113).
    throw Object.assign(new Error(`the engine returned no ${mode} catalog: ${e instanceof Error ? e.message : String(e)}`), { cause: e });
  }
  if (!isRecord(c)) throw new Error("the engine returned no catalog");
  if (c.version !== version) throw new Error(`the engine's catalog is version ${String(c.version)}; expected version ${version}`);
  if (c.mode !== mode) throw new Error(`asked for the ${mode} catalog, got ${String(c.mode)}`);
  if (!isRecord(c.world) || !isRecord(c.economy) || !Array.isArray(c.pools) || !Array.isArray(c.facilities)) {
    throw new Error("the engine returned a catalog without its world, economy, pools or facilities");
  }
  checkCatalog(c);
  return c as unknown as Catalog;
}

type Check = (v: unknown) => boolean;
type Shape = Record<string, Check>;

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const int: Check = (v) => isNumber(v) && Number.isInteger(v);
const amount: Check = (v) => isNumber(v) && v >= 0;
const positive: Check = (v) => isNumber(v) && v > 0;
const count: Check = (v) => int(v) && (v as number) >= 0;
const size: Check = (v) => int(v) && (v as number) >= 1;
const bool: Check = (v) => typeof v === "boolean";
const text: Check = (v) => typeof v === "string" && v.length > 0;
const orNull = (check: Check): Check => (v) => v === null || check(v);
const oneOf = (...values: readonly unknown[]): Check => (v) => values.includes(v);
const cadence = oneOf("quarterly", "maintenancePeriod", "sale", "nightly");
const poolKey = oneOf("elevators", "walkways");
const category = oneOf("structure", "transport", "office", "residential", "hotel", "food", "retail", "entertainment", "service", "special");

const WORLD: Shape = {
  lotWidth: size,
  minFloor: int,
  maxFloor: int,
  groundFloor: int,
  groundFloorStructure: text,
  lobbyInterval: size,
};
const ECONOMY: Shape = {
  startingMoney: amount,
  addCarCost: amount,
  carResaleRefund: amount,
  transportFloorCost: amount,
  calendars: Array.isArray,
  maintenancePerCarMonthly: amount,
  overheadPerUnitMonthly: amount,
  condoHoldTaxRate: amount,
  cinemaBookingMonthly: amount,
  cinemaBookingBlockbusterMonthly: amount,
  nightclubDjMonthly: amount,
  exterminator: (v) => v === null || isRecord(v),
  autoBridgeToggleable: bool,
};
const EXTERMINATOR: Shape = { calloutFee: amount, perRoomFee: amount };
const CALENDAR: Shape = {
  key: oneOf("realWorld", "canon"),
  quarterDays: size,
  maintenancePeriodDays: size,
  maintenanceScale: positive,
  quarterlyRentScale: positive,
};
const POOL: Shape = { key: poolKey, label: text, cap: size, kinds: Array.isArray };
const FACILITY: Shape = {
  key: text,
  name: text,
  category,
  width: size,
  floors: size,
  cost: amount,
  minStar: count,
  population: count,
  attendance: orNull(count),
  modernOnly: bool,
  transport: bool,
  staffOnly: bool,
  basement: bool,
  noBasement: bool,
  available: bool,
  buildMinutes: count,
  resaleRefund: amount,
  buildCap: orNull(size),
  pool: orNull(poolKey),
  maxSpan: orNull(size),
  fixedSpan: bool,
  maxCars: orNull(size),
  carCapacity: orNull(size),
  subtypes: (v) => v === null || (Array.isArray(v) && v.every(text)),
  rent: (v) => v === null || isRecord(v),
  dailyIncome: orNull(amount),
  spendPerCustomer: orNull(amount),
  upkeepMonthly: orNull(amount),
  openHours: (v) => v === null || (Array.isArray(v) && v.length === 24 && v.every(bool)),
  ownHousehold: bool,
  commercial: bool,
  hotel: bool,
  leaseAmenity: bool,
  unmetDemand: bool,
};
const LADDER: Shape = { cadence, default: amount, rungs: Array.isArray, noRate: oneOf(true) };
const RUNG: Shape = { level: count, label: text, value: amount };
const BAND: Shape = { cadence, default: amount, min: amount, max: amount, step: positive, noRate: oneOf(false) };

/** The object at `path`, once every field of `shape` is present and passes its
 *  check; otherwise throws naming the first field that does not. */
function checkShape(v: unknown, shape: Shape, path: string): Record<string, unknown> {
  if (!isRecord(v)) throw new Error(`the engine's catalog has no object at ${path}`);
  for (const [field, check] of Object.entries(shape)) {
    if (!(field in v)) throw new Error(`the engine's catalog is missing ${path}.${field}`);
    if (!check(v[field])) throw new Error(`the engine's catalog has an invalid ${path}.${field}: ${JSON.stringify(v[field])}`);
  }
  return v;
}

function refuse(path: string, why: string): never {
  throw new Error(`the engine's catalog has an invalid ${path}: ${why}`);
}

function checkRent(rent: Record<string, unknown>, path: string): void {
  if (!("shape" in rent)) throw new Error(`the engine's catalog is missing ${path}.shape`);
  if (rent.shape === "ladder") {
    checkShape(rent, LADDER, path);
    const rungs = rent.rungs as unknown[];
    if (rungs.length === 0) refuse(`${path}.rungs`, "no rung");
    rungs.forEach((r, i) => checkShape(r, RUNG, `${path}.rungs[${i}]`));
  } else if (rent.shape === "band") {
    checkShape(rent, BAND, path);
    const [def, min, max] = [rent.default, rent.min, rent.max] as number[];
    if (min > def || def > max) refuse(path, "the default lies outside the band");
  } else {
    refuse(`${path}.shape`, JSON.stringify(rent.shape));
  }
}

function checkCatalog(c: Record<string, unknown>): void {
  const world = checkShape(c.world, WORLD, "world");
  const [minFloor, groundFloor, maxFloor] = [world.minFloor, world.groundFloor, world.maxFloor] as number[];
  if (minFloor > groundFloor || groundFloor > maxFloor) refuse("world", "the ground floor lies outside the floor range");

  const economy = checkShape(c.economy, ECONOMY, "economy");
  if (economy.exterminator !== null) checkShape(economy.exterminator, EXTERMINATOR, "economy.exterminator");
  const calendars = economy.calendars as unknown[];
  if (calendars.length === 0) refuse("economy.calendars", "no calendar");
  calendars.forEach((cal, i) => checkShape(cal, CALENDAR, `economy.calendars[${i}]`));

  const facilities = c.facilities as unknown[];
  if (facilities.length === 0) refuse("facilities", "no facility");
  const keys = new Set<string>();
  facilities.forEach((f, i) => {
    const path = `facilities[${i}]`;
    const e = checkShape(f, FACILITY, path);
    const key = e.key as string;
    if (keys.has(key)) refuse(`${path}.key`, `${key} is listed twice`);
    keys.add(key);
    // A transport states its span and car capacity; nothing else does.
    if (e.transport !== (e.maxSpan !== null) || e.transport !== (e.carCapacity !== null)) {
      refuse(path, `${key} states a span or car capacity that does not match its transport flag`);
    }
    if (e.rent !== null) checkRent(e.rent as Record<string, unknown>, `${path}.rent`);
  });
  if (!keys.has(world.groundFloorStructure as string)) {
    refuse("world.groundFloorStructure", `${String(world.groundFloorStructure)} is not a listed facility`);
  }

  const pools = new Set<unknown>();
  (c.pools as unknown[]).forEach((p, i) => {
    const pool = checkShape(p, POOL, `pools[${i}]`);
    pools.add(pool.key);
    for (const kind of pool.kinds as unknown[]) {
      if (typeof kind !== "string" || !keys.has(kind)) refuse(`pools[${i}].kinds`, `${JSON.stringify(kind)} is not a listed facility`);
    }
  });
  facilities.forEach((f, i) => {
    const pool = (f as Record<string, unknown>).pool;
    if (pool !== null && !pools.has(pool)) refuse(`facilities[${i}].pool`, `${String(pool)} is not a listed pool`);
  });
}
