import { html, nothing, type TemplateResult } from "lit-html";
import type { Simulation } from "../../engine/Simulation";
import type { Transport, Unit } from "../../engine/types";
import { isTenanted } from "../../engine/types";
import { FACILITIES, isCommercialKind, isElevatorKind, isOpenAt, residentCount } from "../../engine/facilities";
import { facilityDiagnostics, transportDiagnostics } from "../../game/facilityDiagnostics";
import { floorTag } from "../format";

/**
 * The hover inspector card bodies (E6-S2), pure functions of (sim, entity),
 * plus the Modern build-refusal tooltip that borrows the same DOM surface.
 * Authored to match the strings `InspectorController.inspectPicked` and
 * `GameApp.updateBuildRefusal` built inline (pinned by the legacy-replica
 * equivalence tests). The card re-renders on every hover pick; lit patches
 * the changed text in place. The title/label/subtype copy auto-escapes
 * through lit (the legacy code used escapeHtml; the subtype is additionally
 * whitelist-coerced on load). The diagnostics blocks (`facilityDiagnostics` /
 * `transportDiagnostics`, shared with the mobile editor fold-in) return lit
 * `TemplateResult` lines and are interpolated directly; an empty array renders
 * nothing.
 *
 * The mobile-only ✕ is NOT part of these templates: `showInspector` appends
 * it from the one shared `titleBarClose` recipe after the h4's lit-managed
 * content, so the modal ✕ and the inspector ✕ can't drift apart.
 */

/** Plain-language phrasing for the lifecycle states that would otherwise read
 *  as bare enums ("dirty", "asleep"); the diagnostics block adds the why + the
 *  fix. A relocation is a life event (Modern condos), not a complaint, so its
 *  status line reads differently. */
function statusTextFor(u: Unit): string {
  switch (u.state) {
    case "vacating":
      return u.vacateReason === "relocation" ? "on notice (household relocating)" : "on notice (tenant leaving)";
    case "dirty":
      return "dirty (awaiting housekeeping)";
    case "infested":
      return "cockroach infested";
    case "asleep":
      return "occupied (guest asleep)";
    default:
      return u.state;
  }
}

export function unitInspectorTemplate(sim: Simulation, u: Unit): TemplateResult {
  const f = FACILITIES[u.kind];
  const statusText = statusTextFor(u);
  // Canon retail variant (§7): a shop / fastFood / restaurant with a subtype
  // titles as its specific name ("Chinese Cafe"), not the generic kind name.
  const title = u.subtype ?? f.name;
  // The label subheading only appears when the player-set label is a real
  // rename: if it matches either the catalog name OR the subtype now shown
  // in the title, suppress the extra line so a shop renamed "Chinese Cafe"
  // (matching its subtype) doesn't render the name twice.
  const labelIsExtra = u.label !== f.name && u.label !== title;
  // Commercial venues contribute their LIVE customers to the census, so show
  // that number (plus a closed marker), never a static "N/25" that reads as a
  // flat, always-full population. "(closed)" only for a tenanted venue outside
  // business hours; vacancy/construction already reads from the Status row.
  // Attendance venues (cinema / party hall / wedding hall, catalog population
  // 0) show the same live line from their routed attendance tally: a mid-show
  // house must never inspect as empty while the audience is visibly seated.
  const closed = isTenanted(u) && !isOpenAt(u.kind, sim.clock.hour);
  return html`<h4 class="win-title">${title}</h4><div>${labelIsExtra ? html`${u.label}<br />` : nothing}${
    u.floor >= 1 ? `Floor ${u.floor}` : `B${1 - u.floor}`
  }</div><div>Status: ${statusText}</div>${
    (isCommercialKind(u.kind) && f.population > 0) || f.attendance !== undefined
      ? html`<div>Customers: ${u.customersIn ?? 0}${closed ? " (closed)" : ""}</div>`
      : f.population
        ? html`<div>Occupants: ${u.occupants}/${residentCount(u)}</div>`
        : nothing
  }${facilityDiagnostics(sim, u)}<div>Satisfaction: ${Math.round(u.satisfaction * 100)}%</div>`;
}

export function transportInspectorTemplate(sim: Simulation, t: Transport): TemplateResult {
  const f = FACILITIES[t.kind];
  // Passenger elevators report how full their cars run on average (staff-only
  // service elevators carry no passenger load, so they show none). Shared
  // with the mobile transport editor via transportDiagnostics.
  return html`<h4 class="win-title">${f.name}</h4><div>Serves floors ${floorTag(t.bottom)}–${floorTag(t.top)}</div>${
    isElevatorKind(t.kind) ? html`<div>Cars: ${t.cars}</div>` : nothing
  }${transportDiagnostics(sim, t)}`;
}

/** The Modern build-refusal tooltip: the build-preview path borrows the
 *  inspector's DOM surface (the card is dormant in build mode), and the
 *  standard win-title h4 is what makes `showInspector` attach the mobile ✕. */
export const buildRefusalTemplate = (reason: string): TemplateResult =>
  html`<h4 class="win-title">Can't build here</h4><div class="preview-refuse">${reason}</div>`;
