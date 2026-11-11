import { catalogFacility } from "../../catalog/catalogTypes";
import type { StopRow, TransportDetail, UnitDetail } from "../../simport/panels";
import type { FacilityKind, GameMode } from "../../shared/types";
import { unitPrice } from "../../ui/catalogPricing";
import { catalogFor } from "../catalogFixture";

/**
 * Hand-built unit and shaft cards, the answers `Cards` decodes from the
 * engine, for the template tests: each test states the fields its branch
 * reads. Sizes come from the pinned catalog; the price is `unitPrice` over
 * it unless a test sets one.
 */

/** An occupied, served unit of `kind` on floor 2. */
export function unitDetail(mode: GameMode, kind: FacilityKind, over: Partial<UnitDetail> = {}): UnitDetail {
  const catalog = catalogFor(mode);
  const base = {
    id: 1,
    kind,
    floor: 2,
    x: 40,
    width: catalogFacility(catalog, kind).width,
    state: "occupied",
    satisfaction: 0.5,
    occupants: 0,
    customersIn: null,
    residents: null,
    everOccupied: false,
    noRate: false,
    rent: null,
    label: "",
    subtype: null,
    vacateReason: null,
    filmPolicy: null,
    served: true,
    reachable: true,
    floorHasLobby: false,
    blockbuster: null,
    ...over,
  } satisfies Omit<UnitDetail, "price">;
  const price = over.price ?? unitPrice(catalog, { kind, rent: base.rent ?? undefined, noRate: base.noRate });
  return { ...base, price };
}

/** Stop rows for floors `bottom` to `top`, top first, all served; floor 1 is the lobby. */
export function stopRows(bottom: number, top: number, skipped: readonly number[] = []): StopRow[] {
  const rows: StopRow[] = [];
  for (let floor = top; floor >= bottom; floor--) {
    rows.push({ floor, served: !skipped.includes(floor), lobby: floor === 1, endpoint: floor === top || floor === bottom });
  }
  return rows;
}

/** A shaft of `kind` from floor 1 to `top` at x 10, one car, no measured load. */
export function transportDetail(kind: FacilityKind, top = 2, over: Partial<TransportDetail> = {}): TransportDetail {
  const f = catalogFacility(catalogFor("classic"), kind);
  const elevator = f.maxCars !== null;
  return {
    id: 1,
    kind,
    x: 10,
    width: f.width,
    bottom: 1,
    top,
    cars: elevator ? 1 : 0,
    capacity: f.carCapacity ?? 0,
    utilization: null,
    nearCapacity: false,
    hourly: null,
    origins: null,
    stops: elevator ? stopRows(1, top) : [],
    ...over,
  };
}
