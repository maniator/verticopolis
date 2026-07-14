import { html, nothing, type TemplateResult } from "lit-html";

/** One per-floor row in the stops dialog. */
export interface StopFloor {
  floor: number;
  stop: boolean;
  lobby: boolean;
}

/**
 * The per-floor elevator stops dialog body. Authored to match `stopsHtml`
 * structurally (proven by the transitional `assertDomEquivalent` test): the
 * title line, the express-service explainer, one `.stop-row` label per floor
 * (with its `data-floor`, checked state, floor/basement label, and the lobby
 * tag), and the Done button. Rows are nested `TemplateResult`s (not a joined
 * string), and the title interpolates as auto-escaped text (no `escapeHtml`).
 *
 * Unlike the legacy string body, each checkbox binds its toggle inline via
 * `@change` (passing the floor from the row's closure), so the controller
 * (`showStopsDialog`) no longer walks `[data-floor]` to attach listeners; it only
 * wires the Done action. `data-floor` stays on each input for structural parity
 * with the legacy body (it feeds the equivalence guard) and as a debugging hook.
 */
export function stopsTemplate(
  title: string,
  floors: StopFloor[],
  onToggle: (floor: number, stop: boolean) => void,
): TemplateResult {
  return html`
      <h2>${title}: Stops</h2>
      <p style="color:var(--muted);font-size:12px">Untick a floor to make the car skip it (express service). The top and bottom stay connected.</p>
      <div class="stop-list well">${floors.map((fl) => stopRow(fl, onToggle))}</div>
      <div class="modal-actions"><button class="btn primary" data-act="close">Done</button></div>`;
}

function stopRow(fl: StopFloor, onToggle: (floor: number, stop: boolean) => void): TemplateResult {
  const label = fl.floor > 0 ? `Floor ${fl.floor}` : `B${-fl.floor}`;
  const tag = fl.lobby ? html` <span class="stop-lobby">lobby</span>` : nothing;
  return html`<label class="stop-row"><input type="checkbox" data-floor="${fl.floor}" ?checked=${fl.stop} @change=${(e: Event) => onToggle(fl.floor, (e.target as HTMLInputElement).checked)} /> <span>${label}${tag}</span></label>`;
}
