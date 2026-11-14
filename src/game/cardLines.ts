import { html, type TemplateResult } from "lit-html";
import { catalogFacility, type Catalog } from "../catalog/catalogTypes";
import type { FacilityKind } from "../shared/types";

/**
 * Card lines the shipped Rust card and the TypeScript reference card share,
 * kept free of the TypeScript engine so the game's card bundles none of it.
 */

/**
 * Whether a unit's card carries an access-reachability line: only kinds that
 * actually draw commuters or visitors (tenants and venues) get one, since
 * parking and service facilities work through ramp chains or coverage
 * instead of passenger trips, so an access warning on them would be a false
 * alarm. The mobile editor reads this to decide whether its plain "Elevator
 * access" row would just repeat the diagnostics line (drop it) or is the only
 * connectivity signal for a zero-population service kind (keep it). The Rust
 * card applies the same gate to the same catalog values
 * (`has_access_diagnostic` in `engine-rs/src/diagnostics/tenant.rs`, over the
 * `population` and `dailyIncome` the catalog is built from, which
 * `the_access_line_gate_matches_the_catalog_values` pins), so the editor and
 * the card's access line follow the same kinds.
 */
export function hasAccessDiagnostic(catalog: Catalog, u: { readonly kind: FacilityKind }): boolean {
  const f = catalogFacility(catalog, u.kind);
  return f.population > 0 || f.dailyIncome !== null;
}

/**
 * The people a tenant room's card counts: those inside against its full
 * count, and for an office the workers still on their way in, booked or
 * walking ("4/6, 2 on the way"). An office counts only the workers who got
 * to their desks, so a slow tower fills late and the card says why.
 */
export function occupantsText(occupants: number, full: number, workersComing: number | null): string {
  const coming = workersComing !== null && workersComing > 0 ? `, ${workersComing} on the way` : "";
  return `${occupants}/${full}${coming}`;
}

/** Format a measured passenger-elevator load for the hover card and mobile
 * editor. The engine supplies the load and its near-capacity verdict; the frontend only words them.
 * Staff-only service elevators, stairs and escalators provide no load reading. */
export function transportLoadLines(util: number | null | undefined, near: boolean): TemplateResult[] {
  if (util === undefined || util === null || !Number.isFinite(util)) return [];
  return [
    html`<div style="color:${near ? "var(--bad)" : "var(--good)"}">Avg load: ${Math.round(util * 100)}% full${near ? ". Near capacity; consider more cars or a parallel shaft." : ""}</div>`,
  ];
}
