import { CLASSIC_HOUSEHOLD, HOUSEHOLD_SIZES } from "./households";
import { ECON, GUTTED_RESALE_REFUND, carResaleRefund, resaleRefund } from "./econConfig";
import {
  ALL_KINDS,
  BUILD_CAPS,
  FACILITIES,
  GRID,
  MAX_CARS,
  POOLED_CAPS,
  buildMinutes,
  facilityFloors,
  hasBusinessHours,
  isCommercialKind,
  isElevatorKind,
  isFixedSpanTransport,
  isHotelKind,
  isOpenAt,
  maxSpanFor,
  transportCarCapacity,
} from "./facilities";
import { makeRules, priceNeutral, type GameRules } from "./gameRules";
import { isRentalKind } from "./residentialRentals";
import { subtypeListFor } from "./retailSubtypes";
import { NO_BASEMENT_KINDS, groundFloorStructureKind, isLobbyFloor, isSkyLobbyFloor } from "./tower/towerTopology";
import type { FacilityKind, GameMode } from "./types";

export { householdPrice } from "./households";
export { transportBuildCost } from "./econConfig";

/**
 * The catalog: every price, size and build rule a frontend reads, resolved for
 * one game mode, as plain JSON (#913). The Rust engine builds the same value in
 * `engine-rs/src/catalog.rs` (`catalog(mode)`, and `Engine.catalog(mode)` on
 * the WASM binding); `conformance/catalog.json` pins the canonical hash of each
 * mode's catalog and both engines must reproduce it.
 *
 * Every field reads the tables the simulation itself reads (FACILITIES, the
 * caps and pools, the rent bands and ladders, the rule-set for the mode), so the
 * catalog cannot drift from what the engine enforces. Presentation (colors,
 * descriptions, labels, icons) stays with the frontend. Where a price depends on
 * placement (a shaft's span, a sold condo's household) the catalog carries the
 * formula's inputs, and this module re-exports the function
 * (`transportBuildCost`, `householdPrice`).
 *
 * Absent values are `null` (never left out), so the JSON has the same keys in
 * every row and the same shape on both engines.
 */

export interface CatalogRung {
  level: number;
  label: string;
  value: number;
}

export interface CatalogBand {
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface CatalogRent {
  /** When the price is collected. */
  cadence: "quarter" | "month" | "night" | "sale";
  /** `ladder` (the Classic rungs) or `band` (the Modern range). */
  shape: "ladder" | "band";
  /** What a unit charges at its neutral price: the Average rung on a ladder,
   *  the band default on a band. */
  default: number;
  ladder: CatalogRung[] | null;
  band: CatalogBand | null;
  /** Whether the unit can be taken off the market (No Rate). */
  noRate: boolean;
  /** Whether the price locks once the unit has sold (a condo). */
  lockedOnceSold: boolean;
  /** Modern condos sell to a rolled household that scales the price:
   *  `householdPrice(asking, size)`, round(asking * size / reference). */
  household: { sizes: number[]; reference: number } | null;
}

export interface CatalogFacility {
  key: FacilityKind;
  name: string;
  category: string;
  /** Width in tiles. */
  width: number;
  /** Height in floors (1 for a single-story room). */
  floors: number;
  cost: number;
  minStar: number;
  population: number;
  /** Seat capacity of an attendance venue. */
  attendance: number | null;
  modernOnly: boolean;
  /** Whether the kind can be built at all in this mode. */
  available: boolean;
  transport: boolean;
  staffOnly: boolean;
  /** Basement only: the whole facility sits below floor 1. */
  basement: boolean;
  /** Never below floor 1 (offices, condos, hotels need daylight). */
  noBasement: boolean;
  /** The one floor the kind may sit on (the wedding hall). */
  onlyFloor: number | null;
  /** What this tool lays on the ground floor when that differs from the kind
   *  (the floor tool lays lobby there). */
  groundFloorKind: FacilityKind | null;
  commercial: boolean;
  /** The hours (0 to 23) a venue with posted hours is open. */
  openHours: number[] | null;
  /** In-game minutes from placement to opening. */
  buildMinutes: number;
  /** What selling a working unit returns (a gutted one returns
   *  `economy.guttedResaleRefund`). */
  resaleRefund: number;
  /** The per-tower cap, or the shared cap of the pool the kind is in. */
  buildCap: number | null;
  /** The pool's name when `buildCap` is shared with other kinds. */
  capPool: string | null;
  /** Transports: the most floors of span (top minus bottom). */
  maxSpan: number | null;
  /** Transports: placed as a fixed two-floor flight, never dragged. */
  fixedSpan: boolean;
  /** Elevators: the most cars one shaft holds. */
  maxCars: number | null;
  /** Transports: riders one car (or one flight) carries per trip. */
  carCapacity: number | null;
  /** Transports: the price of each floor of span on top of `cost`
   *  (`transportBuildCost`); zero for a walkway. */
  floorCost: number | null;
  subtypes: string[] | null;
  /** The mode's headline daily take for a commercial venue. */
  dailyIncome: number | null;
  /** The tuned daily take the venue diagnostics score against in both modes. */
  trafficBaseline: number | null;
  /** The average ticket per customer the diagnostics divide by. */
  spendPerCustomer: number | null;
  rent: CatalogRent | null;
}

export interface CatalogWorld {
  lotWidth: number;
  minFloor: number;
  maxFloor: number;
  groundFloor: number;
  lobbyInterval: number;
  /** Every floor a lobby may go on: the ground floor and every
   *  `lobbyInterval`th floor above it. */
  lobbyFloors: number[];
  /** The sky-lobby floors (a claimed one takes no rooms anywhere on it). */
  skyLobbyFloors: number[];
  escalatorsOnOfficeFloors: boolean;
  autoBridgeToggleable: boolean;
  previewShowsReason: boolean;
}

export interface CatalogEconomy {
  addCarCost: number;
  carResaleRefund: number;
  transportFloorCost: number;
  guttedResaleRefund: number;
}

export interface Catalog {
  mode: GameMode;
  facilities: CatalogFacility[];
  world: CatalogWorld;
  economy: CatalogEconomy;
}

const RUNG_LABELS = ["Very Low", "Low", "Average", "High"] as const;

function cadence(kind: FacilityKind): CatalogRent["cadence"] {
  if (kind === "condo") return "sale";
  if (isHotelKind(kind)) return "night";
  if (isRentalKind(kind)) return "month";
  return "quarter";
}

function rentFor(rules: GameRules, kind: FacilityKind): CatalogRent | null {
  const opts = rules.priceOptions(kind);
  if (!opts) return null;
  const ladder =
    opts.shape === "ladder" ? opts.rungs.map((r) => ({ level: r.level, label: RUNG_LABELS[r.level], value: r.value })) : null;
  const band =
    opts.shape === "band"
      ? { default: opts.band.default, min: opts.band.min, max: opts.band.max, step: opts.band.step }
      : null;
  return {
    cadence: cadence(kind),
    shape: opts.shape,
    default: priceNeutral(opts),
    ladder,
    band,
    noRate: opts.shape === "ladder" && opts.noRate,
    lockedOnceSold: kind === "condo",
    household: rules.hasVariantHouseholds && kind === "condo" ? { sizes: [...HOUSEHOLD_SIZES], reference: CLASSIC_HOUSEHOLD } : null,
  };
}

/** The per-floor price a transport adds on top of its base cost: elevators
 *  charge for every floor of span, a walkway charges nothing. */
function floorCost(kind: FacilityKind): number {
  return isElevatorKind(kind) ? ECON.transportFloorCost : 0;
}

function facilityFor(rules: GameRules, kind: FacilityKind): CatalogFacility {
  const f = FACILITIES[kind];
  const pool = POOLED_CAPS.find((p) => p.kinds.includes(kind));
  const ground = groundFloorStructureKind(kind, 1);
  const transport = f.transport === true;
  const hours: number[] = [];
  for (let h = 0; h < 24; h++) if (isOpenAt(kind, h)) hours.push(h);
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
    available: f.modernOnly !== true || rules.mode === "modern",
    transport,
    staffOnly: f.staffOnly === true,
    basement: f.basement === true,
    noBasement: NO_BASEMENT_KINDS.has(kind),
    onlyFloor: kind === "weddingHall" ? GRID.maxFloor : null,
    groundFloorKind: ground !== kind ? ground : null,
    commercial: isCommercialKind(kind),
    openHours: hasBusinessHours(kind) ? hours : null,
    buildMinutes: buildMinutes(kind),
    resaleRefund: resaleRefund(kind),
    buildCap: BUILD_CAPS[kind] ?? pool?.cap ?? null,
    capPool: pool?.label ?? null,
    maxSpan: transport ? maxSpanFor(kind) : null,
    fixedSpan: isFixedSpanTransport(kind),
    maxCars: MAX_CARS[kind] ?? null,
    carCapacity: transport ? transportCarCapacity(kind) : null,
    floorCost: transport ? floorCost(kind) : null,
    subtypes: subtypes ? [...subtypes] : null,
    dailyIncome: rules.commercialDailyIncome(kind) ?? null,
    trafficBaseline: ECON.dailyTrafficIncome[kind] ?? null,
    spendPerCustomer: ECON.retailSpendPerCustomer[kind] ?? null,
    rent: rentFor(rules, kind),
  };
}

/** The catalog for `mode`: every facility in catalog order, the lot, and the
 *  economy constants a frontend shows. Pure; builds a fresh value each call. */
export function catalogFor(mode: GameMode): Catalog {
  const rules = makeRules(mode);
  const floors: number[] = [];
  for (let fl = GRID.minFloor; fl <= GRID.maxFloor; fl++) floors.push(fl);
  return {
    mode,
    facilities: ALL_KINDS.map((kind) => facilityFor(rules, kind)),
    world: {
      lotWidth: GRID.width,
      minFloor: GRID.minFloor,
      maxFloor: GRID.maxFloor,
      groundFloor: 1,
      lobbyInterval: GRID.lobbyInterval,
      lobbyFloors: floors.filter(isLobbyFloor),
      skyLobbyFloors: floors.filter(isSkyLobbyFloor),
      escalatorsOnOfficeFloors: rules.allowsEscalatorOnOfficeFloors,
      autoBridgeToggleable: rules.bridgingToggleable(),
      previewShowsReason: rules.showsPreviewReason,
    },
    economy: {
      addCarCost: ECON.addCarCost,
      carResaleRefund: carResaleRefund(),
      transportFloorCost: ECON.transportFloorCost,
      guttedResaleRefund: GUTTED_RESALE_REFUND,
    },
  };
}
