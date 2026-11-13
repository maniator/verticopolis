import { catalogFacility, type Catalog, type CatalogCalendar, type CatalogRent, type CatalogRentCadence } from "../catalog/catalogTypes";
import type { CalendarKind, PriceOptions, PriceRung } from "../shared/engineTypes";
import type { FacilityKind } from "../shared/types";

/**
 * The price controls for a kind, read from the tower's catalog (#921) in the
 * shape the editor, the rung picker and the batch dialog switch on. The
 * catalog states the same ladder or band the engine prices against, so the
 * controls always offer what the engine accepts. Null for a kind the mode
 * does not price.
 */
export function priceOptionsFor(catalog: Catalog, kind: FacilityKind): PriceOptions | null {
  return priceOptionsFromRent(catalogFacility(catalog, kind).rent);
}

const RUNG_LABELS: readonly PriceRung["label"][] = ["Very Low", "Low", "Average", "High"];

/** {@link priceOptionsFor} for one catalog rent entry. A ladder rung whose
 *  level or label is not one of the four canon rungs throws: the rung level
 *  is the 1994 rent-class byte, so a rung outside them is a damaged catalog. */
export function priceOptionsFromRent(rent: CatalogRent | null): PriceOptions | null {
  if (!rent) return null;
  if (rent.shape === "band") {
    return { shape: "band", band: { default: rent.default, min: rent.min, max: rent.max, step: rent.step } };
  }
  const rungs = rent.rungs.map((r): PriceRung => {
    const label = RUNG_LABELS[r.level];
    if (label === undefined || label !== r.label) throw new Error(`the catalog's rent ladder has an unknown rung: ${r.level} "${r.label}"`);
    return { level: r.level as PriceRung["level"], label, value: r.value };
  });
  return { shape: "ladder", rungs, noRate: true };
}

/** What a unit charges, by the tower's catalog: nothing when it is off the
 *  market (No Rate), its stored price when the player set one, and the kind's
 *  catalog default otherwise. A Classic build stores its Average rung, so an
 *  unset Classic unit is one whose Average equals the default (an office),
 *  and the engine charges exactly this (#921, held in
 *  `catalogPricing.integration.test.ts`). */
export function unitPrice(catalog: Catalog, u: { kind: FacilityKind; rent?: number; noRate?: boolean }): number {
  if (u.noRate) return 0;
  return u.rent ?? catalogFacility(catalog, u.kind).rent?.default ?? 0;
}

/** The calendar a tower runs, from its catalog: the one the tower chose when
 *  the mode lets it choose, else the mode's only calendar (a Classic tower
 *  runs the 1994 calendar whatever its save stores). */
export function catalogCalendar(catalog: Catalog, chosen: CalendarKind | undefined): CatalogCalendar {
  const { calendars } = catalog.economy;
  return calendars.find((c) => c.key === chosen) ?? calendars[0];
}

/** What one collection of a unit's rent pays at `price` on `calendar` (#2107):
 *  a quarterly rent times the calendar's `quarterlyRentScale`, a monthly rent
 *  times its `maintenanceScale`, and a sale or a nightly rate as it is. The
 *  engine scales each collection by the same factors the catalog publishes,
 *  so on Modern's short 1994 calendar a $10,000 office lands $333 each
 *  three-day quarter. This is one room's share: the engine rounds each kind's
 *  total once, so 36 such offices land $12,000, not 36 times $333. */
export function rentPerCollection(cadence: CatalogRentCadence, price: number, calendar: CatalogCalendar): number {
  if (cadence === "quarterly") return Math.round(price * calendar.quarterlyRentScale);
  if (cadence === "maintenancePeriod") return Math.round(price * calendar.maintenanceScale);
  return price;
}
