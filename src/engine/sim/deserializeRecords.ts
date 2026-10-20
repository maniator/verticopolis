import type { Simulation } from "../Simulation";

import { rentConfig } from "../econConfig";
import { snapToLadder } from "../gameRules";
import { canonicalSubtype, subtypeListFor } from "../retailSubtypes";
import { FACILITIES, GRID, facilityFloors, isElevatorKind, isHotelKind, maxCarsFor } from "../facilities";
import type { FacilityKind, SerializedGame, Transport, Unit } from "../types";
import { isStructural } from "../tower/towerTopology";
import { isUnitState, isVacateReason } from "../types";
import { coerceSchedule } from "../elevatorSchedule";
import { SOLD_CONDO_MIN_PRICE, SOLD_CONDO_MAX_PRICE } from "./constants";
import { coerceDirtyDays } from "./coerce";

/** One unit and one transport record of a save, hardened the way
 *  `deserialize` reads them. Apart from it so the worker host can read the
 *  records an hourly delta carries (#1045) through the same trust boundary
 *  as a full load. Each reads only its own record and the rule-set. */

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** A unit record from a save, coerced: geometry on the lot, a known state,
 *  prices and households sanitized, transient counters dropped. */
export function coerceUnitRecord(sim: Simulation, u: SerializedGame["units"][number]): Unit {
  // Coerce geometry to finite integers and keep the whole FOOTPRINT on the
  // lot: forged floor/x/width would otherwise flow into renderer math as
  // NaN/Infinity, drive an absurd per-tile draw loop, or hang off the edge.
  // Clamp a STRUCTURAL tile (floor/lobby, always laid one width-1 tile) to
  // its catalog, so a forged wide "floor" can't orphan structure on a
  // sky-lobby in-place upgrade. Rooms are NOT clamped: TDT import and legacy
  // reflow keep a room's original width even when wider than catalog. #731.
  const stories = facilityFloors(u.kind);
  const cat = FACILITIES[u.kind].width;
  const floor = Math.max(GRID.minFloor, Math.min(GRID.maxFloor - (stories - 1), Math.round(num(u.floor, 1))));
  const x = Math.max(0, Math.min(GRID.width - 1, Math.round(num(u.x, 0))));
  const cap = isStructural(u.kind) ? cat : GRID.width - x;
  const width = Math.max(1, Math.min(GRID.width - x, cap, Math.round(num(u.width, cat))));
  // Coerce the free-form state first (a forged `state` would reach UI innerHTML and state
  // compares). Structure tiles load `empty` at satisfaction 1: two migrations paved some `occupied`.
  const state = isStructural(u.kind) || !isUnitState(u.state) ? "empty" : u.state;
  // Harden the "currently sold/leased" flag at the trust boundary: only a
  // literal `true` counts, AND for a LEASE/SALE unit (office, condo) a shell
  // state (empty, construction, gutted) is definitionally NOT owned, so the
  // flag normalizes to false even if the save left it true. That rescues a
  // LEGACY "dead" condo whose owner left back when `vacate()` kept
  // `everOccupied` set (else it reloads sold-but-empty and, since sales
  // require `!everOccupied`, sits off-market forever), and blocks a forged
  // shell doing the same. (A sold unit on fire IS still owned, so `fire` is
  // not cleared.) HOTELS are exempt: everOccupied means "ever booked" and
  // stays true while a room sits `empty` between guests (turnover is `state`).
  const notOwned = state === "empty" || state === "construction" || state === "gutted";
  const everOccupied = u.everOccupied === true && !(notOwned && !isHotelKind(u.kind));
  const soldCondo = u.kind === "condo" && everOccupied;
  // Kinds that carry a real household to round-trip: a sold condo, or an
  // occupied rental Apartment. (The Studio is a fixed single occupant, so it
  // never stores `residents`.) The condo-sale reprice below stays condo-only.
  const keepHousehold = everOccupied && (u.kind === "condo" || u.kind === "rentalApartment");
  // Player-set price. Ladder-priced kinds pass through raw (non-finite
  // included): the snap pass below owns their normalization, and both of
  // its rules would otherwise be broken here, since the ladder's Very Low
  // rungs sit below the band floors (a band clamp would lift a legal $50k
  // condo sale to $60k, and the snap pulling it back would re-post the
  // one-time bulletin as a phantom migration on every load) and the band
  // DEFAULTS sit below the hotel ladders (coercing a forged NaN through
  // one would snap to Very Low instead of snapToLadder's Average rule).
  // Band mode keeps the historical behavior: an unsold condo re-enters
  // the legal band, and a SOLD condo keeps its historical price for the
  // buy-back mirror, bounded so a forged rent cannot drive an unbounded
  // buy-back drain (ladder mode bounds that sale to the ladder extremes).
  const ladderPriced = sim.rules.priceOptions(u.kind)?.shape === "ladder";
  let rent: number | undefined;
  if (u.rent === undefined) rent = undefined;
  else if (ladderPriced) rent = typeof u.rent === "number" ? u.rent : Number.NaN;
  else rent = num(u.rent, rentConfig(u.kind)?.default ?? 0);
  if (rent !== undefined && u.kind === "condo") {
    const condoOpts = sim.rules.priceOptions("condo");
    const ladderMode = condoOpts?.shape === "ladder";
    if (soldCondo) {
      rent =
        condoOpts?.shape === "ladder"
          ? Math.max(condoOpts.rungs[0].value, Math.min(condoOpts.rungs[condoOpts.rungs.length - 1].value, rent))
          : Math.max(SOLD_CONDO_MIN_PRICE, Math.min(SOLD_CONDO_MAX_PRICE, rent));
    } else if (!ladderMode) {
      const band = rentConfig("condo")!;
      rent = Math.max(band.min, Math.min(band.max, rent));
    }
  }
  return {
    ...u,
    floor,
    x,
    width,
    everOccupied,
    // A non-string `label` would crash the escaping at render.
    state,
    label: typeof u.label === "string" ? u.label : FACILITIES[u.kind].name,
    satisfaction: isStructural(u.kind) ? 1 : Math.max(0, Math.min(1, num(u.satisfaction, 1))),
    // Attendance venues' occupants mirrors the transient customersIn
    // tally (zeroed below), so it restores to 0 no matter what the save
    // carries: a hand-edited or legacy save can't seed a phantom
    // audience the live crowd would never drain. Structure tiles (floor,
    // lobby) hold nobody either, so a legacy count on one restores to 0:
    // the per-step scans skip them, and must agree with the hourly ones.
    occupants:
      FACILITIES[u.kind].attendance !== undefined || isStructural(u.kind) ? 0 : Math.max(0, num(u.occupants, 0)),
    // Household size, only kept for a CURRENTLY-sold condo, and sanitized by
    // the rule-set (Classic strips it so its condos read the flat 3; Modern
    // clamps into the 2..5 generator band). A not-sold condo (legacy dead
    // unit, empty/gutted, or a hand-edited save) carries none, so a stale
    // household can't leak into the census or a per-unit occupancy readout;
    // the next sale draws fresh.
    residents: keepHousehold ? sim.rules.coerceResidents(u.residents) : undefined,
    pendingIncome: num(u.pendingIncome, 0),
    rent,
    // Coerce the film policy so a hand-edited save can't inject a bad value
    // (undefined ⇒ auto, the legacy behavior).
    filmPolicy:
      u.filmPolicy === "feature" || u.filmPolicy === "blockbuster" || u.filmPolicy === "auto"
        ? u.filmPolicy
        : undefined,
    // Whitelist-coerce the canon retail variant name against the kind's
    // §7 list, so a scrambled save or a subtype from a kind that doesn't
    // carry one drops to undefined (unit renders as the generic name).
    subtype: canonicalSubtype(u.kind as FacilityKind, u.subtype),
    // Retail-only running totals: kept only on kinds that carry a canon
    // subtype so a hand-edited save can't leak the fields onto a hotel or
    // office. `num` clamps non-finite / negative-infinity forgeries; a
    // legitimate absence stays absent (undefined) so a legacy save is
    // indistinguishable from a fresh retail unit that hasn't earned yet.
    patronageToday: subtypeListFor(u.kind as FacilityKind) === null || u.patronageToday === undefined ? undefined : Math.max(0, num(u.patronageToday, 0)),
    patronageYest: subtypeListFor(u.kind as FacilityKind) === null || u.patronageYest === undefined ? undefined : Math.max(0, num(u.patronageYest, 0)),
    profitToday: subtypeListFor(u.kind as FacilityKind) === null || u.profitToday === undefined ? undefined : Math.max(0, num(u.profitToday, 0)),
    profitYest: subtypeListFor(u.kind as FacilityKind) === null || u.profitYest === undefined ? undefined : Math.max(0, num(u.profitYest, 0)),
    // Preserve an in-progress eviction across save/reload, hardened like
    // every other loop-driving field: an out-of-set reason or a non-finite
    // deadline from a forged save must not reach the toast / state machine.
    vacateReason: isVacateReason(u.vacateReason) ? u.vacateReason : undefined,
    vacateAt: u.vacateAt === undefined ? undefined : num(u.vacateAt, 0),
    dirtyDays: coerceDirtyDays(state, u.kind as FacilityKind, u.dirtyDays),
    // Off-market flag, sanitized through the rule-set seam (like
    // `coerceResidents`): Classic keeps a literal-true flag and hardens a
    // forged non-boolean away; Modern never holds the state, so it coerces
    // the flag off entirely. Gated to priced kinds, mirroring import and
    // export: No Rate is a priced-unit concept, so a forged `true` on an
    // unpriced kind (shop, fast food) drops to undefined and never reaches
    // the move-in gate.
    noRate: rentConfig(u.kind as FacilityKind) ? sim.rules.coerceNoRate(u.noRate) : undefined,
    // Transient crowd counters never survive a load: serializeUnit omits
    // them, and the `...u` spread above would otherwise let a hand-edited
    // save seed the census/star gating (customersIn, hotelCustomersIn) or
    // the visible-occupancy projection (outForMeal) with forged values.
    // The live crowd rebuilds all of them organically.
    customersIn: undefined,
    hotelCustomersIn: undefined,
    outForMeal: undefined,
  };
}

/** Snap a coerced unit's stored rent onto its ladder (ladder-priced modes
 *  only; see the snap-on-load note in `deserialize`). Returns whether the
 *  unit's visible price changed. */
export function snapUnitRent(sim: Simulation, u: Unit): boolean {
  const priceShape = sim.rules.priceOptions(u.kind);
  if (!priceShape || priceShape.shape !== "ladder") return false;
  const cfg = rentConfig(u.kind)!;
  const effective = u.rent ?? cfg.default; // what rentOf would charge (No Rate aside)
  // A stored value snaps to its nearest rung; an ABSENT override is not a
  // stored rent at all, it means "on the default", and the ladder's default
  // rung is Average (AR6), so it lands there directly. Snapping the band
  // default's dollars instead would drop a never-priced hotel onto Very Low
  // (the band defaults sit an order of magnitude under the canon ladder)
  // while an identical new build starts on Average: same untouched unit,
  // two prices. Offices and condos read identically either way.
  const snapped = u.rent === undefined ? priceShape.rungs[2].value : snapToLadder(priceShape.rungs, u.rent);
  // Count only visible price changes: an off-market (No Rate) unit charges
  // $0 either way, so normalizing its latent stored value is silent.
  const visible = !u.noRate && snapped !== effective;
  // Same storage rule as every rung write: strip the override only when the
  // rung coincides with the band default (so `rentOf`'s fallback still reads
  // the same rung and sparse saves stay sparse for offices on Average).
  u.rent = snapped === cfg.default ? undefined : snapped;
  return visible;
}

/** A transport record from a save, coerced: cars, span and width bounded,
 *  car arrays sized to the cars, the schedule hardened. The pairwise
 *  overlap pass stays in `deserialize`, since it reads every record. */
export function coerceTransportRecord(t: SerializedGame["transports"][number]): Transport {
  // Coerce car counts/positions from an untrusted save: a NaN/negative/huge
  // `cars` would otherwise reach `new Array(cars)` in the dispatcher and
  // throw a RangeError (or OOM) on the very next tick.
  const maxCars = isElevatorKind(t.kind) ? maxCarsFor(t.kind) : 0;
  const cars = Math.max(0, Math.min(maxCars, Math.floor(num(t.cars, 0))));
  // Clamp the span to the lot: an unbounded forged bottom/top would give
  // the shaft an absurd height (its banded graphic loop scales with it).
  // Bottom caps at maxFloor - 1 so the top > bottom rule below can't be
  // forced past maxFloor by a forged bottom.
  const bottom = Math.max(GRID.minFloor, Math.min(GRID.maxFloor - 1, Math.round(num(t.bottom, 1))));
  // A transport must have height (validateTransport requires top > bottom);
  // never deserialize a zero-height shaft from a corrupt save.
  const top = Math.max(bottom + 1, Math.min(GRID.maxFloor, Math.round(num(t.top, bottom + 1))));
  // Shaft width is normally fixed per kind, but a legacy save keeps its own
  // stored width (canon widths only ever GREW: stairs 4→8, standard elevator
  // 3→4), so preserve a valid stored width up to the catalog's, and clamp an
  // above-catalog (forged) or non-positive width down to it.
  const w0 = Math.round(num(t.width, FACILITIES[t.kind].width));
  const width = w0 > 0 ? Math.min(w0, FACILITIES[t.kind].width) : FACILITIES[t.kind].width;
  const fixLen = (arr: unknown, fill: number) =>
    Array.from({ length: cars }, (_, i) =>
      Array.isArray(arr) ? num(arr[i], fill) : fill,
    );
  return {
    ...t,
    // Same geometry hardening as units: keep the shaft's whole width on
    // the lot. `width` is already bounded by the catalog above, so
    // clamping by it keeps a kept-legacy 3-wide shaft at the right lot
    // edge at its exact saved x (never shoved one tile into the neighbor
    // that boxed it in).
    x: Math.max(0, Math.min(GRID.width - width, Math.round(num(t.x, 0)))),
    width,
    bottom,
    top,
    cars,
    carPositions: fixLen(t.carPositions, bottom),
    carDir: fixLen(t.carDir, 0),
    carLoad: t.carLoad ? fixLen(t.carLoad, 0) : undefined,
    skipFloors: Array.isArray(t.skipFloors)
      ? t.skipFloors.filter((n) => typeof n === "number" && Number.isFinite(n))
      : undefined,
    // Harden the authored schedule (#305) at the load boundary: clamp its
    // active-car counts to [0, cars], its response tunables to sane ranges,
    // and its home floors onto the shaft, so a forged save cannot drive the
    // dispatcher out of range. A garbage or empty value loads as no schedule.
    schedule: coerceSchedule(t.schedule, cars, bottom, top),
  };
}
