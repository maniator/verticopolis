import { html, nothing, render, type TemplateResult } from "lit-html";
import type { CatalogSkyBridge } from "@verticopolis/components/catalog/skyBridgeTypes";
import { facilityColor } from "@verticopolis/components/presentation/facilityPresentation";
import { groupDigits, shortMoney } from "@verticopolis/components/windows/format";
import { descriptionId } from "./paletteHints";

/**
 * The Sky Bridge tool's palette button and card (Modern; party, 2026-11-16).
 * The button sits in Structure's Modern sub-band, only where the catalog
 * publishes a `rules.skyBridge` rule (Modern), so a Classic palette never
 * builds it. Like a facility button it is hidden until the tower reaches the
 * rule's star and dimmed while the funds cannot pay for one tile.
 */

/** The button's `data-tool` and the tool's `type`. */
export const SKY_BRIDGE_TOOL = "skyBridge";

/** What the tool does, for the button's description and its card. */
export const SKY_BRIDGE_DESCRIPTION =
  "Click the open air between two towers' sky lobbies to build the whole bridge at once. Click a bridge to give it the look picked on the strip, free.";

/** The button's spoken label: its name and its price per tile. */
function spokenLabel(rule: CatalogSkyBridge): string {
  return `Sky Bridge, $${groupDigits(rule.tileCost)} a tile`;
}

/** Draw the button's swatch, name, price per tile and description. */
export function labelSkyBridgeButton(item: HTMLElement, rule: CatalogSkyBridge): void {
  render(
    html`<span class="pal-swatch" style="background:${facilityColor("lobby")}"></span><span class="pal-name">Sky Bridge</span><span class="pal-cost">$${shortMoney(rule.tileCost)}/tile</span><span class="pal-desc" id=${descriptionId(SKY_BRIDGE_TOOL)} hidden>${SKY_BRIDGE_DESCRIPTION}</span>`,
    item,
  );
  item.setAttribute("aria-label", spokenLabel(rule));
  item.setAttribute("aria-describedby", descriptionId(SKY_BRIDGE_TOOL));
}

/** A new Sky Bridge button, labeled; the caller makes it activatable. */
export function skyBridgeButton(rule: CatalogSkyBridge, group: string): HTMLElement {
  const item = document.createElement("div");
  item.className = "pal-item pal-mod";
  item.dataset.tool = SKY_BRIDGE_TOOL;
  item.dataset.group = group;
  labelSkyBridgeButton(item, rule);
  return item;
}

/** Whether the tool is open: the mode builds bridges and the tower has the
 *  rule's stars. */
export function skyBridgeUnlocked(rule: CatalogSkyBridge | null, star: number): boolean {
  return rule !== null && star >= rule.minStar;
}

/** The lock scan's part for the button: hide it below the rule's star, dim it
 *  while one tile is past the funds. Returns whether it was shown or hidden. */
export function scanSkyBridgeButton(
  palette: HTMLElement,
  rule: CatalogSkyBridge | null,
  star: number,
  money: number,
): boolean {
  const item = palette.querySelector<HTMLElement>(`.pal-item[data-tool="${SKY_BRIDGE_TOOL}"]`);
  if (!item || !rule) return false;
  const locked = !skyBridgeUnlocked(rule, star);
  const changed = item.classList.contains("locked") !== locked;
  item.classList.toggle("locked", locked);
  item.classList.toggle("unaffordable", !locked && money < rule.tileCost);
  return changed;
}

/** The tool's card: what a click does, the price of a tile and the longest
 *  bridge. The ghost tags the whole bridge's price before the click. */
export function skyBridgeToolInfo(rule: CatalogSkyBridge | null): TemplateResult {
  const price = rule
    ? html`<div>Cost: $${groupDigits(rule.tileCost)} per tile, up to ${rule.maxSpan} tiles</div>`
    : nothing;
  return html`<div class="ti-name">Sky Bridge</div>${price}<p style="margin-top:6px;color:var(--muted)">${SKY_BRIDGE_DESCRIPTION} The ghost shows the whole bridge and its price before you click.</p>`;
}
