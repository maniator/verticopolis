import { html, nothing, type TemplateResult } from "lit-html";

/**
 * The tool-info panel bodies (E5-S2). Event-driven, not a pump path: `UI.
 * selectTool` renders one of these into `#tool-info` when the player picks a
 * tool. Authored to match `buildToolInfoHtml` / `BULLDOZE_TOOL_INFO_HTML` /
 * `INSPECT_TOOL_INFO_HTML` structurally (proven by the transitional
 * retired transitional guards). The catalog `name`/`description` copy is trusted
 * static text and now auto-escapes through lit; the conditional
 * capacity/customers row uses lit's `nothing` in place of the legacy `""`.
 * `#tool-info` is lit's container exclusively after the constructor clears its
 * static placeholder (one container, one renderer).
 */
export function toolInfoTemplate(
  f: { name: string; cost: number; population: number; description: string },
  isCommercial: boolean,
): TemplateResult {
  // Commercial venues never hold a flat population: they add however many
  // customers are eating right now, up to the catalog value. "Capacity"
  // stays for the kinds where it is literally the head count.
  return html`<div class="ti-name">${f.name}</div><div>Cost: $${f.cost.toLocaleString()}</div>${
    f.population
      ? html`<div>${isCommercial ? `Customers: up to ${f.population}` : `Capacity: ${f.population}`}</div>`
      : nothing
  }<p style="margin-top:6px;color:var(--muted)">${f.description}</p>`;
}

export const BULLDOZE_TOOL_INFO: TemplateResult = html`<div class="ti-name">Bulldoze</div><p style="color:var(--muted)">Click a room or shaft to sell it for half its cost.</p>`;

export const INSPECT_TOOL_INFO: TemplateResult = html`<div class="ti-name">Inspect</div><p style="color:var(--muted)">Hover the tower to read a facility's status.</p>`;
