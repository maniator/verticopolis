import { html, nothing, type TemplateResult } from "lit-html";
import { catalogBuildKind, catalogFacility, type Catalog } from "../../engine/catalogTypes";
import { isCommercialKind } from "../../engine/facilities";
import { facilityDescription } from "../../presentation/facilityPresentation";
import type { FacilityKind } from "../../engine/types";

/**
 * The tool-info panel bodies (E5-S2). `UI.selectTool` renders one of these
 * into `#tool-info` when the player picks a tool, and the status pump redraws
 * a build tool's card when the tower's catalog changes (#921). Authored to match `buildToolInfoHtml` / `BULLDOZE_TOOL_INFO_HTML` /
 * `INSPECT_TOOL_INFO_HTML` structurally (proven by
 * transitional guards, retired with the string builders). The facility `name`/`description` copy is trusted
 * static text and now auto-escapes through lit; the conditional
 * capacity/customers row uses lit's `nothing` in place of the legacy `""`.
 * `#tool-info` is lit's container exclusively after the constructor clears its
 * static placeholder (one container, one renderer).
 */
export function toolInfoTemplate(
  f: { name: string; cost: number; population: number; description: string },
  isCommercial: boolean,
  // When set, the tool lays a lobby at this price on the ground floor (level 1).
  // Passed for the Floor tool so a player learns up front that floor 1 is
  // lobby-only and priced accordingly, before they drop the cheaper floor tile.
  groundFloorLobbyCost?: number,
): TemplateResult {
  // Commercial venues never hold a flat population: they add however many
  // customers are eating right now, up to the catalog value. "Capacity"
  // stays for the kinds where it is literally the head count.
  return html`<div class="ti-name">${f.name}</div><div>Cost: $${f.cost.toLocaleString()}</div>${
    f.population
      ? html`<div>${isCommercial ? `Customers: up to ${f.population}` : `Capacity: ${f.population}`}</div>`
      : nothing
  }<p style="margin-top:6px;color:var(--muted)">${f.description}</p>${
    groundFloorLobbyCost !== undefined
      ? html`<p style="margin-top:6px;color:var(--muted)">On the ground floor (level 1) this lays a lobby, $${groundFloorLobbyCost.toLocaleString()} per tile.</p>`
      : nothing
  }`;
}

/** The info card for a build tool: the name, price and capacity from the
 *  tower's catalog (#921), and the description from the presentation table.
 *  The Floor tool lays the ground-floor structure (a lobby) on the ground
 *  floor, so its card carries that price too (see catalogBuildKind). */
export function toolInfoFor(catalog: Catalog, kind: FacilityKind): TemplateResult {
  // The description is display copy, which the catalog leaves to the UI.
  const f = { ...catalogFacility(catalog, kind), description: facilityDescription(kind) };
  return toolInfoTemplate(f, isCommercialKind(kind), groundFloorCost(catalog, kind));
}

export const BULLDOZE_TOOL_INFO: TemplateResult = html`<div class="ti-name">Bulldoze</div><p style="color:var(--muted)">Click a room or shaft to sell it for half its cost.</p>`;

export const INSPECT_TOOL_INFO: TemplateResult = html`<div class="ti-name">Inspect</div><p style="color:var(--muted)">Hover the tower to read a facility's status.</p>`;

/** The ground-floor price on the card: what the tool lays on the ground floor
 *  when that differs from the tool's own kind (the Floor tool lays a lobby). */
function groundFloorCost(catalog: Catalog, kind: FacilityKind): number | undefined {
  const laid = catalogBuildKind(catalog, kind, catalog.world.groundFloor);
  return laid === kind ? undefined : catalogFacility(catalog, laid).cost;
}
