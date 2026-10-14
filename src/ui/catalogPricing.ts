import { catalogFacility, type Catalog, type CatalogRent } from "../engine/catalogTypes";
import type { PriceOptions, PriceRung } from "../engine/gameRules";
import type { FacilityKind } from "../engine/types";

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
