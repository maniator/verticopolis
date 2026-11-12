import { html, type TemplateResult } from "lit-html";
import { iconTemplate } from "../icons";
import { ordinal } from "../format";

/**
 * The TOWER-achieved congratulations modal body: the last dialog to migrate
 * off the string builders (it sat outside the epic-by-epic dialog list and
 * came over in the final sweep). Static celebratory copy with a single
 * Continue action bound inline, so the controller needs no wireActions pass.
 * `topFloor` is the tower's top floor from its catalog, where the wedding
 * hall stands (#1987).
 */
export function congratsTemplate(topFloor: number, onClose: () => void): TemplateResult {
  // One text run after the rating: a binding mid-sentence splits it into
  // separate text nodes, which the browser shapes apart and draws differently.
  const cheers = ` rating. Cheers ring out over the city from the wedding hall on the ${ordinal(topFloor)} floor. Congratulations, master builder!`;
  return html`<h2>${iconTemplate("trophy", { size: 20 })}TOWER achieved!</h2>
    <p>
      Your skyscraper has earned the legendary <b>TOWER</b>${cheers}
    </p>
    <div class="modal-actions"><button class="btn primary" data-act="close" @click=${onClose}>Continue</button></div>`;
}
