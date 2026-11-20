import { html, nothing, render } from "lit-html";
import type { CatalogSkyBridge } from "@verticopolis/engine/catalog/skyBridgeTypes";

/**
 * The Sky Bridge tool's look strip (Modern; owner, 2026-11-16: "let the users
 * choose"). While the tool is armed, a small strip over the tower lists the
 * catalog's bridge looks. A click on open air lays a bridge in the picked look,
 * and a click on a bridge dresses it in the picked look, free.
 */

/** The look a new bridge wears until the player picks another: the glass
 *  skywalk, the catalog's second look (the first is the plain lobby). */
export const FIRST_PICKED_LOOK = 1;

let picked = FIRST_PICKED_LOOK;

/** The picked look, an index into the catalog's `rules.skyBridge.looks`. */
export function pickedSkyBridgeLook(): number {
  return picked;
}

/** Pick look `look` and redraw the strip. */
export function pickSkyBridgeLook(look: number, rule: CatalogSkyBridge | null): void {
  picked = look;
  syncSkyBridgeLookStrip({ type: "skyBridge" }, rule);
}

/** Show the strip while the Sky Bridge tool is armed, the picked look pressed. */
export function syncSkyBridgeLookStrip(tool: { type: string }, rule: CatalogSkyBridge | null): void {
  const strip = document.getElementById("sky-bridge-look-strip");
  if (!strip) return;
  const armed = tool.type === "skyBridge" && rule !== null;
  strip.hidden = !armed;
  if (!armed) {
    render(nothing, strip);
    return;
  }
  if (picked >= rule.looks.length) picked = FIRST_PICKED_LOOK;
  const buttons = rule.looks.map(
    (name, i) =>
      html`<button type="button" class="btn${picked === i ? " es-on" : ""}" data-look=${i} aria-pressed=${picked === i} @click=${() => pickSkyBridgeLook(i, rule)}>${name}</button>`,
  );
  render(html`<span>Bridge look</span>${buttons}`, strip);
}
