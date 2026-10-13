/**
 * The catalog: the reference data a frontend draws a build menu, a price label
 * or a placement ghost from, resolved for one mode so a frontend never applies
 * a rule itself. The Rust engine owns the same catalog (`engine-rs/src/catalog.rs`,
 * exported through the WASM binding as `catalog(mode)`); this module builds it
 * from the TypeScript engine's own tables, and
 * `conformance/catalog-digests.json` pins the canonical hash of each mode's
 * catalog (`src/tests/integration/catalog.integration.test.ts`), so the two
 * engines cannot quote a different price or size while both exist.
 *
 * The shape is the contract: keys are camelCase, a value a kind does not have
 * is present as `null`, and facilities come in the engine's catalog order.
 * Presentation stays with the frontend: display copy beyond the facility name,
 * icons, sprite sizes in pixels and colors are not here.
 */
import { ECON, carResaleRefund, resaleRefund } from "./econConfig";
import {
  ALL_KINDS,
  BUILD_CAPS,
  FACILITIES,
  GRID,
  POOLED_CAPS,
  buildMinutes,
  facilityFloors,
  isElevatorKind,
  isFixedSpanTransport,
  isHotelKind,
  maxCarsFor,
  maxSpanFor,
  transportCarCapacity,
} from "./facilities";
import { REAL_WORLD, resolveCalendar, type CalendarKind } from "./calendar";
import { makeRules } from "./gameRules";
import { priceNeutral } from "./pricing";
import { isRentalKind } from "./residentialRentals";
import { subtypeListFor } from "./retailSubtypes";
import { NO_BASEMENT_KINDS, groundFloorStructureKind } from "./tower/towerTopology";
import type { FacilityKind, GameMode } from "./types";
import {
  CATALOG_VERSION,
  type Catalog,
  type CatalogCalendar,
  type CatalogFacility,
  type CatalogPool,
  type CatalogRent,
} from "./catalogTypes";

export * from "./catalogTypes";

/** The key each of {@link POOLED_CAPS} goes by, in its order. */
const POOL_KEYS = ["elevators", "walkways"] as const;
if (POOL_KEYS.length !== POOLED_CAPS.length) throw new Error("catalog: every pooled cap needs a key");

/** When a priced kind's price is collected (see {@link CatalogRent.cadence}). */
function rentCadence(kind: FacilityKind): CatalogRent["cadence"] {
  if (kind === "office" || kind === "fitnessClub" || kind === "clinic") return "quarterly";
  if (isRentalKind(kind)) return "maintenancePeriod";
  if (kind === "condo") return "sale";
  if (isHotelKind(kind)) return "nightly";
  // A priced kind with no collector here is a programming error; building
  // every mode's catalog in the tests trips it before a build ships.
  throw new Error(`catalog: ${kind} has a price but no rent cadence`);
}

function rentFor(rules: ReturnType<typeof makeRules>, kind: FacilityKind): CatalogRent | null {
  const opts = rules.priceOptions(kind);
  if (!opts) return null;
  const cadence = rentCadence(kind);
  if (opts.shape === "ladder") {
    return {
      shape: "ladder",
      cadence,
      default: priceNeutral(opts),
      rungs: opts.rungs.map((r) => ({ level: r.level, label: r.label, value: r.value })),
      noRate: true,
    };
  }
  const { default: def, min, max, step } = opts.band;
  return { shape: "band", cadence, default: def, min, max, step, noRate: false };
}

function poolKey(kind: FacilityKind): CatalogPool["key"] | null {
  const i = POOLED_CAPS.findIndex((p) => p.kinds.includes(kind));
  return i < 0 ? null : POOL_KEYS[i];
}

function facilityEntry(mode: GameMode, rules: ReturnType<typeof makeRules>, kind: FacilityKind): CatalogFacility {
  const f = FACILITIES[kind];
  const transport = f.transport === true;
  const subtypes = subtypeListFor(kind);
  return {
    key: kind,
    name: f.name,
    category: f.category,
    width: f.width,
    floors: facilityFloors(kind),
    cost: f.cost,
    minStar: f.minStar,
    population: f.population,
    attendance: f.attendance ?? null,
    modernOnly: f.modernOnly === true,
    transport,
    staffOnly: f.staffOnly === true,
    basement: f.basement === true,
    noBasement: NO_BASEMENT_KINDS.has(kind),
    available: f.modernOnly !== true || mode === "modern",
    buildMinutes: transport ? 0 : buildMinutes(kind),
    resaleRefund: resaleRefund(kind),
    buildCap: BUILD_CAPS[kind] ?? null,
    pool: poolKey(kind),
    maxSpan: transport ? maxSpanFor(kind) : null,
    fixedSpan: isFixedSpanTransport(kind),
    maxCars: isElevatorKind(kind) ? maxCarsFor(kind) : null,
    carCapacity: transport ? transportCarCapacity(kind) : null,
    subtypes: subtypes ? [...subtypes] : null,
    rent: rentFor(rules, kind),
    dailyIncome: rules.commercialDailyIncome(kind) ?? null,
    spendPerCustomer:
      subtypes && rules.commercialDailyIncome(kind) !== undefined ? (ECON.retailSpendPerCustomer[kind] ?? null) : null,
    upkeepMonthly: ECON.serviceMaintenanceMonthly[kind] ?? null,
  };
}

/** The calendars a mode can run, its default first. */
function calendarsFor(mode: GameMode, rules: ReturnType<typeof makeRules>): CatalogCalendar[] {
  const kinds: readonly CalendarKind[] = mode === "classic" ? ["canon"] : ["realWorld", "canon"];
  return kinds.map((kind) => {
    const c = resolveCalendar(mode, kind);
    return {
      key: c.kind,
      quarterDays: c.quarterDays,
      maintenancePeriodDays: c.maintPeriodDays,
      maintenanceScale: c.maintPeriodDays / REAL_WORLD.maintPeriodDays,
      quarterlyRentScale: rules.quarterlyRentScale(c.quarterDays),
    };
  });
}

/** The catalog for `mode`, built from the TypeScript engine's tables. */
export function catalogFor(mode: GameMode): Catalog {
  const rules = makeRules(mode);
  const exterminator = rules.infestationRecovery();
  return {
    version: CATALOG_VERSION,
    mode,
    world: {
      lotWidth: GRID.width,
      minFloor: GRID.minFloor,
      maxFloor: GRID.maxFloor,
      groundFloor: 1,
      groundFloorStructure: groundFloorStructureKind("floor", 1),
      lobbyInterval: GRID.lobbyInterval,
    },
    economy: {
      startingMoney: ECON.startingMoney,
      addCarCost: ECON.addCarCost,
      carResaleRefund: carResaleRefund(),
      transportFloorCost: ECON.transportFloorCost,
      calendars: calendarsFor(mode, rules),
      maintenancePerCarMonthly: ECON.maintenancePerCarMonthly,
      overheadPerUnitMonthly: rules.operatingOverheadPerUnit(),
      condoHoldTaxRate: rules.condoHoldTaxRate(),
      cinemaBookingMonthly: ECON.cinemaBookingMonthly,
      cinemaBookingBlockbusterMonthly: ECON.cinemaBookingBlockbuster,
      nightclubDjMonthly: ECON.nightclubDjMonthly,
      exterminator: exterminator ? { calloutFee: exterminator.calloutFee, perRoomFee: exterminator.perRoomFee } : null,
      autoBridgeToggleable: rules.bridgingToggleable(),
    },
    pools: POOLED_CAPS.map((p, i) => ({ key: POOL_KEYS[i], label: p.label, cap: p.cap, kinds: [...p.kinds] })),
    facilities: ALL_KINDS.map((kind) => facilityEntry(mode, rules, kind)),
  };
}
