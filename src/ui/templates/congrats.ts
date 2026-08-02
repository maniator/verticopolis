import { html, type TemplateResult } from "lit-html";
import { iconTemplate } from "../icons";

/**
 * The TOWER-achieved congratulations modal body: the last dialog to migrate
 * off the string builders (it sat outside the epic-by-epic dialog list and
 * came over in the final sweep). Static celebratory copy with a single
 * Continue action bound inline, so the controller needs no wireActions pass.
 */
export function congratsTemplate(onClose: () => void): TemplateResult {
  return html`<h2>${iconTemplate("trophy", { size: 20 })}TOWER achieved!</h2>
    <p>
      Your skyscraper has earned the legendary <b>TOWER</b> rating. Wedding bells ring out over the city from the
      hall on the 100th floor. Congratulations, master builder!
    </p>
    <div class="modal-actions"><button class="btn primary" data-act="close" @click=${onClose}>Continue</button></div>`;
}
